import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import type { PromptCollection } from '../../models/collection.model';
import {
  AdminEmailService,
  type EmailAudience,
  type EmailAudienceSummary,
  type EmailCampaignMode
} from '../../services/admin-email.service';
import { CollectionService } from '../../services/collection.service';

interface AudienceOption {
  readonly id: EmailAudience;
  readonly label: string;
  readonly description: string;
}

@Component({
  selector: 'app-admin-email-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-email-management.component.html'
})
export class AdminEmailManagementComponent {
  private readonly emailService = inject(AdminEmailService);
  private readonly collectionService = inject(CollectionService);
  readonly router = inject(Router);

  readonly audienceOptions: readonly AudienceOption[] = [
    { id: 'all', label: 'Everyone', description: 'Every eligible user with an email address' },
    { id: 'paying', label: 'Paying customers', description: 'Plus, Pro, and Team customers' },
    { id: 'free', label: 'Free customers', description: 'Users without a paid plan' },
    { id: 'no-prompts', label: 'No posts yet', description: 'Users who have not posted a prompt' },
    { id: 'with-prompts', label: 'Has posted', description: 'Users who have posted at least one prompt' }
  ];

  readonly mode = signal<EmailCampaignMode>('collection');
  readonly subject = signal('Discover a new collection on RocketPrompt');
  readonly message = signal('We found a collection we think you will enjoy. Take a look and find your next great prompt.');
  readonly collectionUrl = signal('');
  readonly loadedCollection = signal<PromptCollection | null>(null);
  readonly canonicalCollectionUrl = signal('');
  readonly customHtml = signal(this.defaultCustomHtml());
  readonly selectedAudience = signal<EmailAudience>('all');
  readonly audienceSummary = signal<EmailAudienceSummary | null>(null);
  readonly audienceLoading = signal(true);
  readonly collectionLoading = signal(false);
  readonly sending = signal(false);
  readonly confirmed = signal(false);
  readonly error = signal<string | null>(null);
  readonly success = signal<string | null>(null);

  readonly recipientCount = computed(() => {
    const summary = this.audienceSummary();
    if (!summary) {
      return 0;
    }

    switch (this.selectedAudience()) {
      case 'paying': return summary.paying;
      case 'free': return summary.free;
      case 'no-prompts': return summary.noPrompts;
      case 'with-prompts': return summary.withPrompts;
      default: return summary.all;
    }
  });

  readonly selectedAudienceLabel = computed(() =>
    this.audienceOptions.find(option => option.id === this.selectedAudience())?.label ?? 'Everyone'
  );

  constructor() {
    void this.refreshAudienceSummary();
  }

  setMode(mode: EmailCampaignMode): void {
    this.mode.set(mode);
    this.error.set(null);
    this.success.set(null);
    this.confirmed.set(false);
  }

  selectAudience(audience: EmailAudience): void {
    this.selectedAudience.set(audience);
    this.confirmed.set(false);
    this.success.set(null);
  }

  async refreshAudienceSummary(): Promise<void> {
    this.audienceLoading.set(true);
    this.error.set(null);
    try {
      this.audienceSummary.set(await this.emailService.getAudienceSummary());
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

      this.loadedCollection.set(collection);
      this.canonicalCollectionUrl.set(publicUrl);
      this.subject.set(`Discover ${collection.name} on RocketPrompt`);
      this.confirmed.set(false);
    } catch (error) {
      this.error.set(this.errorMessage(error, 'Could not load that collection.'));
    } finally {
      this.collectionLoading.set(false);
    }
  }

  previewHtml(): string {
    return this.mode() === 'custom' ? this.customHtml() : this.collectionEmailHtml();
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
    if (!testOnly && (!this.confirmed() || this.recipientCount() === 0)) {
      this.error.set('Confirm the audience and make sure it contains at least one recipient.');
      return;
    }

    if (!testOnly) {
      const accepted = window.confirm(
        `Send this email to ${this.recipientCount().toLocaleString()} ${this.selectedAudienceLabel().toLowerCase()} recipient(s)? This cannot be undone.`
      );
      if (!accepted) {
        return;
      }
    }

    this.sending.set(true);
    try {
      const result = await this.emailService.sendCampaign({
        audience: this.selectedAudience(),
        subject,
        html,
        text: this.plainTextFromHtml(html),
        mode: this.mode(),
        collectionUrl: this.mode() === 'collection' ? this.canonicalCollectionUrl() : undefined,
        testOnly,
        expectedRecipientCount: this.recipientCount()
      });

      this.success.set(testOnly
        ? 'Test email sent to your signed-in admin email address.'
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
      : `<div style="height:220px;background:linear-gradient(135deg,#111827 0%,#dc2626 100%);display:flex;align-items:center;justify-content:center;color:#fff;font-size:54px;">🚀</div>`;

    return `<!doctype html>
<html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <div style="padding:32px 16px;">
    <div style="max-width:640px;margin:0 auto;">
      <div style="padding:0 0 18px;text-align:center;font-size:20px;font-weight:800;letter-spacing:-0.02em;">🚀 RocketPrompt</div>
      <div style="overflow:hidden;border:1px solid #e2e8f0;border-radius:20px;background:#ffffff;box-shadow:0 12px 30px rgba(15,23,42,.08);">
        ${image}
        <div style="padding:32px;">
          <div style="margin-bottom:12px;color:#dc2626;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;">${tag}</div>
          <h1 style="margin:0 0 14px;font-size:30px;line-height:1.15;letter-spacing:-.03em;">${name}</h1>
          <p style="margin:0 0 12px;color:#475569;font-size:16px;line-height:1.7;">${blurb}</p>
          <p style="margin:0 0 26px;color:#475569;font-size:16px;line-height:1.7;">${message}</p>
          <a href="${url}" style="display:inline-block;border-radius:12px;background:#dc2626;padding:14px 22px;color:#ffffff;font-size:15px;font-weight:800;text-decoration:none;">Explore the collection →</a>
          <div style="margin-top:22px;color:#94a3b8;font-size:12px;">${collection?.promptIds.length ?? 0} prompt${(collection?.promptIds.length ?? 0) === 1 ? '' : 's'} in this collection</div>
        </div>
      </div>
      <div style="padding:20px;text-align:center;color:#94a3b8;font-size:12px;line-height:1.6;">RocketPrompt · Put the right prompt within reach.</div>
    </div>
  </div>
</body></html>`;
  }

  private defaultCustomHtml(): string {
    return `<!doctype html>
<html>
  <body style="margin:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <div style="max-width:640px;margin:0 auto;padding:40px 20px;">
      <h1 style="font-size:30px;">Your RocketPrompt update 🚀</h1>
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
}
