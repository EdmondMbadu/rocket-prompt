import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import type { PromptCollection } from '../../models/collection.model';
import {
  AdminEmailService,
  type EmailActivityFilter,
  type EmailAudienceSummary,
  type EmailCampaignMode,
  type EmailDirectoryUser,
  type EmailPlanFilter,
  type EmailRecipientScope
} from '../../services/admin-email.service';
import { CollectionService } from '../../services/collection.service';

@Component({
  selector: 'app-admin-email-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-email-management.component.html'
})
export class AdminEmailManagementComponent {
  private readonly emailService = inject(AdminEmailService);
  private readonly collectionService = inject(CollectionService);
  private readonly destroyRef = inject(DestroyRef);
  readonly router = inject(Router);

  readonly mode = signal<EmailCampaignMode>('collection');
  readonly subject = signal('Discover a new collection on RocketPrompt');
  readonly message = signal('Take a look at this featured collection and explore the prompts inside.');
  readonly collections = signal<PromptCollection[]>([]);
  readonly collectionsLoading = signal(true);
  readonly collectionUrl = signal('');
  readonly loadedCollection = signal<PromptCollection | null>(null);
  readonly canonicalCollectionUrl = signal('');
  readonly customHtml = signal(this.defaultCustomHtml());
  readonly audienceSummary = signal<EmailAudienceSummary | null>(null);
  readonly users = signal<EmailDirectoryUser[]>([]);
  readonly userSearch = signal('');
  readonly recipientScope = signal<EmailRecipientScope>('real');
  readonly planFilter = signal<EmailPlanFilter>('all');
  readonly activityFilter = signal<EmailActivityFilter>('all');
  readonly excludedRecipientIds = signal<Set<string>>(new Set());
  readonly testEmail = signal('');
  readonly audienceLoading = signal(true);
  readonly collectionLoading = signal(false);
  readonly sending = signal(false);
  readonly confirmed = signal(false);
  readonly error = signal<string | null>(null);
  readonly success = signal<string | null>(null);

  readonly matchingRecipients = computed(() => {
    const scope = this.recipientScope();
    const plan = this.planFilter();
    const activity = this.activityFilter();
    return this.users().filter(user => {
      if (!user.eligible) return false;
      if (scope === 'real' && !user.isRealUser) return false;
      if (plan === 'paying' && !user.isPaying) return false;
      if (plan === 'free' && user.isPaying) return false;
      if (activity === 'with-prompts' && !user.hasPrompts) return false;
      if (activity === 'no-prompts' && user.hasPrompts) return false;
      return true;
    });
  });

  readonly selectedRecipients = computed(() => {
    const excluded = this.excludedRecipientIds();
    return this.matchingRecipients().filter(user => !excluded.has(user.id));
  });

  readonly visibleRecipients = computed(() => {
    const search = this.userSearch().trim().toLowerCase();
    if (!search) {
      return this.matchingRecipients();
    }
    return this.matchingRecipients().filter(user =>
      user.email.toLowerCase().includes(search) ||
      user.name.toLowerCase().includes(search)
    );
  });

  readonly recipientCount = computed(() => this.selectedRecipients().length);
  readonly realUserCount = computed(() => this.audienceSummary()?.real ?? 0);
  readonly possibleBotCount = computed(() => this.users().filter(user => user.eligible && !user.isRealUser).length);

  constructor() {
    void this.refreshAudienceSummary();
    this.collectionService.collections$()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: collections => {
          this.collections.set(collections);
          this.collectionsLoading.set(false);
          if (!this.loadedCollection() && collections.length > 0) {
            this.applyCollection(collections[0]);
          }
        },
        error: () => this.collectionsLoading.set(false)
      });
  }

  setMode(mode: EmailCampaignMode): void {
    this.mode.set(mode);
    this.error.set(null);
    this.success.set(null);
    this.confirmed.set(false);
  }

  updateRecipientScope(scope: EmailRecipientScope): void {
    this.recipientScope.set(scope);
    this.resetManualRecipientSelection();
  }

  updatePlanFilter(filter: EmailPlanFilter): void {
    this.planFilter.set(filter);
    this.resetManualRecipientSelection();
  }

  updateActivityFilter(filter: EmailActivityFilter): void {
    this.activityFilter.set(filter);
    this.resetManualRecipientSelection();
  }

  toggleRecipient(userId: string, selected: boolean): void {
    const next = new Set(this.excludedRecipientIds());
    if (selected) {
      next.delete(userId);
    } else {
      next.add(userId);
    }
    this.excludedRecipientIds.set(next);
    this.confirmed.set(false);
  }

  selectAllMatching(): void {
    this.excludedRecipientIds.set(new Set());
    this.confirmed.set(false);
  }

  clearAllMatching(): void {
    this.excludedRecipientIds.set(new Set(this.matchingRecipients().map(user => user.id)));
    this.confirmed.set(false);
  }

  recipientIsSelected(userId: string): boolean {
    return !this.excludedRecipientIds().has(userId);
  }

  async refreshAudienceSummary(): Promise<void> {
    this.audienceLoading.set(true);
    this.error.set(null);
    try {
      const data = await this.withTimeout(
        this.emailService.getManagementData(),
        20_000,
        'User loading took too long. Confirm the latest email functions are deployed, then try Refresh.'
      );
      if (!data?.summary || !Array.isArray(data.users)) {
        throw new Error('The deployed email function is out of date. Deploy the latest functions and refresh this page.');
      }
      this.audienceSummary.set(data.summary);
      const realUserIds = new Set(data.realUserIds ?? []);
      this.users.set(data.users.map(user => ({
        ...user,
        isRealUser: realUserIds.has(user.id)
      })));
      this.excludedRecipientIds.set(new Set());
      if (!this.testEmail().trim()) {
        this.testEmail.set(data.adminEmail);
      }
    } catch (error) {
      this.error.set(this.errorMessage(error, 'Could not load the email audience.'));
    } finally {
      this.audienceLoading.set(false);
    }
  }

  async loadCollection(): Promise<void> {
    const rawUrl = this.collectionUrl().trim();
    if (!rawUrl) {
      this.error.set('Paste a RocketPrompt collection link first.');
      return;
    }

    this.collectionLoading.set(true);
    this.error.set(null);
    this.success.set(null);
    this.loadedCollection.set(null);
    this.canonicalCollectionUrl.set('');

    try {
      const target = this.parseCollectionTarget(rawUrl);
      const collection = target.type === 'custom'
        ? await this.collectionService.getCollectionByCustomUrl(target.value)
        : await firstValueFrom(this.collectionService.collection$(target.value).pipe(take(1)));

      if (!collection) {
        throw new Error('Collection not found. Check the link and try again.');
      }
      if (collection.isPrivate) {
        throw new Error('Private collections cannot be included in a bulk email.');
      }

      const publicUrl = collection.customUrl
        ? `https://rocketprompt.io/collection/${encodeURIComponent(collection.customUrl)}`
        : `https://rocketprompt.io/collections/${encodeURIComponent(collection.id)}`;

      this.applyCollection(collection, publicUrl);
    } catch (error) {
      this.error.set(this.errorMessage(error, 'Could not load that collection.'));
    } finally {
      this.collectionLoading.set(false);
    }
  }

  loadCollectionIfNeeded(): void {
    if (this.collectionUrl().trim() && !this.collectionLoading()) {
      void this.loadCollection();
    }
  }

  selectCollection(collectionId: string): void {
    const collection = this.collections().find(item => item.id === collectionId);
    if (collection) {
      this.applyCollection(collection);
    }
  }

  previewHtml(): string {
    return this.mode() === 'custom' ? this.customHtml() : this.collectionEmailHtml();
  }

  renderedPreviewHtml(): string {
    return this.previewHtml().replace(/\{\{\s*first[_\s-]*name\s*\}\}/gi, 'Alex');
  }

  openFullPreview(): void {
    this.error.set(null);
    const safeHtml = this.sanitizePreviewHtml(this.renderedPreviewHtml());
    const blob = new Blob([safeHtml], { type: 'text/html;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const previewWindow = window.open(blobUrl, '_blank');
    if (!previewWindow) {
      URL.revokeObjectURL(blobUrl);
      this.error.set('Your browser blocked the preview tab. Allow pop-ups for this site and try again.');
      return;
    }
    previewWindow.opener = null;
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  }

  isTestEmailValid(): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.testEmail().trim());
  }

  async send(testOnly: boolean): Promise<void> {
    this.error.set(null);
    this.success.set(null);

    const subject = this.subject().trim();
    const html = this.previewHtml().trim();
    if (!subject) {
      this.error.set('Add an email subject before sending.');
      return;
    }
    if (!html) {
      this.error.set('Add email HTML before sending.');
      return;
    }
    if (this.mode() === 'collection' && !this.loadedCollection()) {
      this.error.set('Load a public collection before sending this campaign.');
      return;
    }
    if (testOnly && !this.isTestEmailValid()) {
      this.error.set('Enter a valid test email address.');
      return;
    }
    if (!testOnly && (!this.confirmed() || this.recipientCount() === 0)) {
      this.error.set('Confirm the audience and make sure it contains at least one recipient.');
      return;
    }

    if (!testOnly) {
      const accepted = window.confirm(
        `Send this email to the ${this.recipientCount().toLocaleString()} selected recipient(s)? This cannot be undone.`
      );
      if (!accepted) {
        return;
      }
    }

    this.sending.set(true);
    try {
      const result = await this.emailService.sendCampaign({
        recipientIds: this.selectedRecipients().map(user => user.id),
        subject,
        html,
        text: this.plainTextFromHtml(html),
        mode: this.mode(),
        collectionUrl: this.mode() === 'collection' ? this.canonicalCollectionUrl() : undefined,
        testOnly,
        expectedRecipientCount: this.recipientCount(),
        testEmail: testOnly ? this.testEmail().trim() : undefined,
        recipientFilters: {
          scope: this.recipientScope(),
          plan: this.planFilter(),
          activity: this.activityFilter()
        }
      });

      this.success.set(testOnly
        ? `Test email sent to ${this.testEmail().trim()}.`
        : `Campaign sent to ${result.recipientCount.toLocaleString()} recipient(s).`
      );
      if (!testOnly) {
        this.confirmed.set(false);
        await this.refreshAudienceSummary();
      }
    } catch (error) {
      this.error.set(this.errorMessage(error, 'The email could not be sent.'));
    } finally {
      this.sending.set(false);
    }
  }

  private applyCollection(collection: PromptCollection, suppliedUrl?: string): void {
    const publicUrl = suppliedUrl || (collection.customUrl
      ? `https://rocketprompt.io/collection/${encodeURIComponent(collection.customUrl)}`
      : `https://rocketprompt.io/collections/${encodeURIComponent(collection.id)}`);
    this.loadedCollection.set(collection);
    this.canonicalCollectionUrl.set(publicUrl);
    this.collectionUrl.set(publicUrl);
    this.subject.set(`Discover ${collection.name} on RocketPrompt`);
    this.confirmed.set(false);
  }

  private resetManualRecipientSelection(): void {
    this.excludedRecipientIds.set(new Set());
    this.confirmed.set(false);
    this.success.set(null);
  }

  private parseCollectionTarget(rawValue: string): { type: 'custom' | 'id'; value: string } {
    let path = rawValue;
    try {
      path = new URL(rawValue, window.location.origin).pathname;
    } catch {
      // Treat a plain value as a collection slug.
    }

    const parts = path.split('/').filter(Boolean).map(part => decodeURIComponent(part));
    if (parts[0] === 'collections' && parts[1]) {
      return { type: 'id', value: parts[1] };
    }
    if (parts[0] === 'collection' && parts[1]) {
      return { type: 'custom', value: parts[1] };
    }
    if (parts.length === 1) {
      return { type: 'custom', value: parts[0] };
    }
    throw new Error('Use a link like rocketprompt.io/collection/collection-name.');
  }

  private collectionEmailHtml(): string {
    const collection = this.loadedCollection();
    const name = this.escapeHtml(collection?.name ?? 'Featured Collection');
    const tag = this.escapeHtml(collection?.tag ?? 'Curated prompts');
    const blurb = this.escapeHtml(collection?.blurb ?? 'A hand-picked collection created to help you get more from AI.');
    const message = this.escapeHtml(this.message().trim());
    const url = this.escapeAttribute(this.canonicalCollectionUrl() || 'https://rocketprompt.io/collections');
    const image = collection?.heroImageUrl
      ? `<img src="${this.escapeAttribute(collection.heroImageUrl)}" alt="" style="display:block;width:100%;height:260px;object-fit:cover;">`
      : `<div style="height:220px;background:linear-gradient(135deg,#111827 0%,#dc2626 100%);display:flex;align-items:center;justify-content:center;color:#fff;font-size:34px;font-weight:800;">RocketPrompt</div>`;

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RocketPrompt collection</title></head><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <div style="padding:32px 16px;">
    <div style="max-width:640px;margin:0 auto;">
      <div style="padding:0 0 18px;text-align:center;font-size:20px;font-weight:800;letter-spacing:-0.02em;">RocketPrompt</div>
      <div style="overflow:hidden;border:1px solid #e2e8f0;border-radius:20px;background:#ffffff;box-shadow:0 12px 30px rgba(15,23,42,.08);">
        ${image}
        <div style="padding:32px;">
          <div style="margin-bottom:12px;color:#dc2626;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;">${tag}</div>
          <p style="margin:0 0 16px;color:#334155;font-size:16px;line-height:1.6;">Hello {{firstName}},</p>
          <h1 style="margin:0 0 14px;font-size:30px;line-height:1.15;letter-spacing:-.03em;">${name}</h1>
          <p style="margin:0 0 12px;color:#475569;font-size:16px;line-height:1.7;">${blurb}</p>
          <p style="margin:0 0 26px;color:#475569;font-size:16px;line-height:1.7;">${message}</p>
          <a href="${url}" style="display:inline-block;border-radius:12px;background:#dc2626;padding:14px 22px;color:#ffffff;font-size:15px;font-weight:800;text-decoration:none;">Check out this collection &rarr;</a>
          <div style="margin-top:22px;color:#94a3b8;font-size:12px;">${collection?.promptIds.length ?? 0} prompt${(collection?.promptIds.length ?? 0) === 1 ? '' : 's'} in this collection</div>
          <p style="margin:22px 0 0;color:#64748b;font-size:13px;line-height:1.6;">Want to explore something else? <a href="https://rocketprompt.io/collections" style="color:#dc2626;font-weight:700;">Browse all RocketPrompt collections here.</a></p>
        </div>
      </div>
      <div style="padding:20px;text-align:center;color:#94a3b8;font-size:12px;line-height:1.6;">RocketPrompt &middot; Put the right prompt within reach.</div>
    </div>
  </div>
</body></html>`;
  }

  private defaultCustomHtml(): string {
    return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RocketPrompt email</title></head>
  <body style="margin:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <div style="max-width:640px;margin:0 auto;padding:40px 20px;">
      <p style="font-size:16px;line-height:1.7;color:#334155;">Hello {{firstName}},</p>
      <h1 style="font-size:30px;">Your RocketPrompt update</h1>
      <p style="font-size:16px;line-height:1.7;color:#475569;">Replace this content with your own HTML email.</p>
      <a href="https://rocketprompt.io" style="display:inline-block;background:#dc2626;color:#fff;padding:14px 22px;border-radius:10px;text-decoration:none;font-weight:700;">Visit RocketPrompt</a>
    </div>
  </body>
</html>`;
  }

  private plainTextFromHtml(html: string): string {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private sanitizePreviewHtml(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
      .replace(/<object[\s\S]*?<\/object>/gi, '')
      .replace(/<form[\s\S]*?<\/form>/gi, '')
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '');
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private escapeAttribute(value: string): string {
    return this.escapeHtml(value).replace(/`/g, '&#096;');
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return fallback;
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs);
      promise.then(
        value => {
          window.clearTimeout(timeout);
          resolve(value);
        },
        error => {
          window.clearTimeout(timeout);
          reject(error);
        }
      );
    });
  }
}
