import { CommonModule } from '@angular/common';
import { Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { PromptService } from '../../services/prompt.service';
import type { Prompt } from '../../models/prompt.model';
import type { UserProfile } from '../../models/user-profile.model';

interface PromptCategory {
  readonly label: string;
  readonly value: string;
}

interface PromptCard {
  readonly id: string;
  readonly authorId: string;
  readonly title: string;
  readonly content: string;
  readonly preview: string;
  readonly tag: string;
  readonly tagLabel: string;
  readonly customUrl?: string;
  readonly views: number;
  readonly likes: number;
  readonly createdAt?: Date;
  readonly updatedAt?: Date;
}

@Component({
  selector: 'app-profile-page',
  standalone: true,
  imports: [CommonModule, RouterLink, ReactiveFormsModule],
  templateUrl: './profile-page.component.html',
  styleUrl: './profile-page.component.css'
})
export class ProfilePageComponent {
  private readonly authService = inject(AuthService);
  private readonly promptService = inject(PromptService);
  readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);

  private readonly baseCategories: PromptCategory[] = [
    { label: 'All', value: 'all' },
    { label: 'Creative', value: 'creative' },
    { label: 'Development', value: 'development' },
    { label: 'Marketing', value: 'marketing' },
    { label: 'Analysis', value: 'analysis' },
    { label: 'Productivity', value: 'productivity' }
  ];

  private readonly baseCategoryValues = new Set(this.baseCategories.map(category => category.value));

  readonly categories = signal<PromptCategory[]>([...this.baseCategories]);
  readonly hiddenCategories = signal<Set<string>>(new Set());

  readonly prompts = signal<PromptCard[]>([]);

  readonly searchTerm = signal('');
  readonly selectedCategory = signal<PromptCategory['value']>('all');
  readonly menuOpen = signal(false);
  readonly isLoadingPrompts = signal(true);
  readonly loadPromptsError = signal<string | null>(null);
  readonly recentlyCopied = signal<Set<string>>(new Set());
  readonly recentlyCopiedUrl = signal<Set<string>>(new Set());
  readonly newPromptModalOpen = signal(false);
  readonly isEditingPrompt = signal(false);
  readonly editingPromptId = signal<string | null>(null);
  readonly isSavingPrompt = signal(false);
  readonly promptFormError = signal<string | null>(null);
  readonly deleteError = signal<string | null>(null);
  readonly deletingPromptId = signal<string | null>(null);

  private readonly copyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly copyUrlTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private readonly createPromptDefaults = {
    title: '',
    tag: '',
    customUrl: '',
    content: ''
  } as const;

  readonly createPromptForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(3)]],
    tag: ['', [Validators.required]],
    customUrl: [''],
    content: ['', [Validators.required, Validators.minLength(10)]]
  });

  readonly tagQuery = signal('');
  readonly tagQueryDebounced = signal('');
  private tagQueryTimer: ReturnType<typeof setTimeout> | null = null;

  readonly customUrlError = signal<string | null>(null);
  readonly isCheckingCustomUrl = signal(false);
  private customUrlTimer: ReturnType<typeof setTimeout> | null = null;

  readonly currentUser$ = this.authService.currentUser$;
  readonly viewingUserId = signal<string | null>(null);
  readonly isViewingOwnProfile = computed(() => {
    const currentUser = this.authService.currentUser;
    const viewingId = this.viewingUserId();
    return currentUser && (viewingId === null || viewingId === currentUser.uid);
  });

  readonly profile$ = this.route.queryParams.pipe(
    switchMap(params => {
      const userId = params['userId'];
      this.viewingUserId.set(userId || null);
      if (userId) {
        // Viewing another user's profile
        return this.authService.userProfile$(userId);
      }
      // Viewing own profile
      return this.currentUser$.pipe(
        switchMap(user => {
          if (!user) {
            return of<UserProfile | undefined>(undefined);
          }
          return this.authService.userProfile$(user.uid);
        })
      );
    }),
    map(profile => profile ? profile : undefined)
  );

  readonly filteredPrompts = computed(() => {
    const prompts = this.prompts();
    const term = this.searchTerm().trim().toLowerCase();
    const category = this.selectedCategory();

    return prompts.filter(prompt => {
      const matchesCategory = category === 'all' || prompt.tag === category;

      if (!matchesCategory) {
        return false;
      }

      if (!term) {
        return true;
      }

      const haystack = [
        prompt.title,
        prompt.content,
        prompt.tag,
        prompt.customUrl ?? ''
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(term);
    });
  });

  readonly userPromptCount = computed(() => {
    return this.prompts().length;
  });

  readonly tagSuggestions = computed(() => {
    const term = String(this.tagQueryDebounced()).trim().toLowerCase();

    if (!term) {
      return [];
    }

    const termLetters = term.replace(/[^a-z]/gi, '');

    if (!termLetters) {
      return [];
    }

    return this.categories().filter(c => {
      if (c.value === 'all') return false;
      const candidate = String(c.value).toLowerCase().replace(/[^a-z]/gi, '');

      if (candidate.includes(termLetters)) return true;

      const distance = this.levenshteinDistance(termLetters, candidate);
      const threshold = Math.max(1, Math.floor(candidate.length * 0.35));
      return distance <= threshold;
    });
  });

  private levenshteinDistance(a: string, b: string) {
    if (a === b) return 0;
    const al = a.length;
    const bl = b.length;
    if (al === 0) return bl;
    if (bl === 0) return al;

    const v0 = new Array(bl + 1).fill(0);
    const v1 = new Array(bl + 1).fill(0);

    for (let j = 0; j <= bl; j++) {
      v0[j] = j;
    }

    for (let i = 0; i < al; i++) {
      v1[0] = i + 1;
      for (let j = 0; j < bl; j++) {
        const cost = a.charAt(i) === b.charAt(j) ? 0 : 1;
        v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
      }
      for (let j = 0; j <= bl; j++) v0[j] = v1[j];
    }

    return v1[bl];
  }

  constructor() {
    this.observePrompts();
  }

  async copyPromptUrl(prompt: PromptCard) {
    if (!prompt) return;

    const short = prompt.id ? prompt.id.slice(0, 8) : '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const url = prompt.customUrl ? `${origin}/${prompt.customUrl}` : `${origin}/prompt/${short}`;

    try {
      await navigator.clipboard.writeText(url);
      this.showCopyMessage('Prompt URL copied!');
      this.markPromptUrlAsCopied(prompt.id);
    } catch (e) {
      this.fallbackCopyTextToClipboard(url);
      this.showCopyMessage('Prompt URL copied!');
      this.markPromptUrlAsCopied(prompt.id);
    }
  }

  private markPromptUrlAsCopied(id: string) {
    if (!id) return;

    this.recentlyCopiedUrl.update(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

    const existing = this.copyUrlTimers.get(id);
    if (existing) {
      clearTimeout(existing);
    }

    const DURATION = 2500;

    const timer = setTimeout(() => {
      this.recentlyCopiedUrl.update(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      this.copyUrlTimers.delete(id);
    }, DURATION);

    this.copyUrlTimers.set(id, timer);
  }

  async copyPrompt(prompt: PromptCard) {
    if (!prompt) return;

    const text = prompt.content ?? '';

    try {
      await navigator.clipboard.writeText(text);
      this.showCopyMessage('Prompt copied!');
      this.markPromptAsCopied(prompt.id);
    } catch (e) {
      this.fallbackCopyTextToClipboard(text);
      this.showCopyMessage('Prompt copied!');
      this.markPromptAsCopied(prompt.id);
    }
  }

  private markPromptAsCopied(id: string) {
    if (!id) return;

    this.recentlyCopied.update(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

    const existing = this.copyTimers.get(id);
    if (existing) {
      clearTimeout(existing);
    }

    const DURATION = 2500;

    const timer = setTimeout(() => {
      this.recentlyCopied.update(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      this.copyTimers.delete(id);
    }, DURATION);

    this.copyTimers.set(id, timer);
  }

  private showCopyMessage(messageText: string) {
    const message = document.createElement('div');
    message.className = 'fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 transition-all';
    message.textContent = messageText;

    document.body.appendChild(message);

    setTimeout(() => {
      message.remove();
    }, 3000);
  }

  private fallbackCopyTextToClipboard(text: string) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
  }

  async signOut() {
    this.closeMenu();
    await this.authService.signOut();
    await this.router.navigate(['/']);
  }

  selectCategory(category: PromptCategory['value']) {
    this.selectedCategory.set(category);
  }

  onSearch(term: string) {
    this.searchTerm.set(term);
  }

  trackPromptById(_: number, prompt: PromptCard) {
    return prompt.id;
  }

  toggleMenu() {
    this.menuOpen.update(open => !open);
  }

  closeMenu() {
    this.menuOpen.set(false);
  }

  profileInitials(profile: UserProfile | undefined) {
    if (!profile) {
      return 'RP';
    }

    const firstInitial = profile.firstName?.charAt(0)?.toUpperCase() ?? '';
    const lastInitial = profile.lastName?.charAt(0)?.toUpperCase() ?? '';
    const initials = `${firstInitial}${lastInitial}`.trim();

    return initials || (profile.email?.charAt(0)?.toUpperCase() ?? 'R');
  }

  openPrompt(prompt: PromptCard) {
    if (prompt.customUrl) {
      void this.router.navigate([`/${prompt.customUrl}`]);
    } else {
      const short = (prompt?.id ?? '').slice(0, 8);
      if (!short) return;
      void this.router.navigate(['/prompt', short]);
    }
  }

  getPromptUrl(prompt: PromptCard): string {
    const short = prompt.id ? prompt.id.slice(0, 8) : '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return prompt.customUrl ? `${origin}/${prompt.customUrl}` : `${origin}/prompt/${short}`;
  }

  getPromptDisplayUrl(prompt: PromptCard): string {
    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'rocketprompt.io';
    const short = prompt.id ? prompt.id.slice(0, 8) : '';
    return prompt.customUrl ? `${hostname}/${prompt.customUrl}` : `${hostname}/prompt/${short}`;
  }

  @HostListener('document:click', ['$event'])
  handleDocumentClick(event: Event) {
    if (!this.menuOpen()) {
      return;
    }

    const target = event.target as HTMLElement | null;

    if (!target?.closest('[data-user-menu]')) {
      this.closeMenu();
    }
  }

  canEditPrompt(prompt: PromptCard): boolean {
    const currentUser = this.authService.currentUser;
    if (!currentUser) {
      return false;
    }
    return !prompt.authorId || prompt.authorId === currentUser.uid;
  }

  openEditPromptModal(prompt: PromptCard) {
    const currentUser = this.authService.currentUser;
    if (!currentUser) {
      this.promptFormError.set('You must be signed in to edit a prompt.');
      return;
    }

    if (prompt.authorId && prompt.authorId !== currentUser.uid) {
      this.promptFormError.set('You do not have permission to edit this prompt. Only the author can edit it.');
      return;
    }

    this.closeMenu();
    this.promptFormError.set(null);
    this.customUrlError.set(null);
    this.clearCustomUrlDebounce();
    this.isEditingPrompt.set(true);
    this.editingPromptId.set(prompt.id);
    this.createPromptForm.setValue({
      title: prompt.title,
      tag: prompt.tag,
      customUrl: prompt.customUrl ?? '',
      content: prompt.content
    });
    this.createPromptForm.markAsPristine();
    this.createPromptForm.markAsUntouched();
    this.tagQuery.set('');
    this.newPromptModalOpen.set(true);
  }

  async onDeletePrompt(prompt: PromptCard) {
    if (this.deletingPromptId() === prompt.id) {
      return;
    }

    const currentUser = this.authService.currentUser;
    if (!currentUser) {
      this.deleteError.set('You must be signed in to delete a prompt.');
      return;
    }

    if (prompt.authorId && prompt.authorId !== currentUser.uid) {
      this.deleteError.set('You do not have permission to delete this prompt. Only the author can delete it.');
      return;
    }

    const confirmed = window.confirm(`Delete "${prompt.title}"? This action cannot be undone.`);

    if (!confirmed) {
      return;
    }

    this.deletingPromptId.set(prompt.id);
    this.deleteError.set(null);

    try {
      await this.promptService.deletePrompt(prompt.id, currentUser.uid);
    } catch (error) {
      console.error('Failed to delete prompt', error);
      this.deleteError.set(
        error instanceof Error ? error.message : 'Could not delete the prompt. Please try again.'
      );
    } finally {
      this.deletingPromptId.set(null);
    }
  }

  closeCreatePromptModal() {
    if (this.isSavingPrompt()) {
      return;
    }

    this.newPromptModalOpen.set(false);
    this.isEditingPrompt.set(false);
    this.editingPromptId.set(null);
    this.promptFormError.set(null);
    this.customUrlError.set(null);
    this.clearCustomUrlDebounce();
  }

  async submitPromptForm() {
    if (this.createPromptForm.invalid) {
      this.createPromptForm.markAllAsTouched();
      return;
    }

    const { title, tag, customUrl, content } = this.createPromptForm.getRawValue();
    const trimmedCustomUrl = (customUrl ?? '').trim();

    if (trimmedCustomUrl) {
      const urlPattern = /^[a-z0-9-]+$/i;
      if (!urlPattern.test(trimmedCustomUrl)) {
        this.customUrlError.set('Custom URL can only contain letters, numbers, and hyphens.');
        return;
      }

      const reservedPaths = ['home', 'auth', 'prompt', 'prompts', 'collections', 'admin', 'verify-email', 'community-guidelines', 'profile'];
      if (reservedPaths.includes(trimmedCustomUrl.toLowerCase())) {
        this.customUrlError.set('This URL is reserved. Please choose a different one.');
        return;
      }

      try {
        const isTaken = await this.promptService.isCustomUrlTaken(trimmedCustomUrl, this.editingPromptId());
        if (isTaken) {
          this.customUrlError.set('This custom URL is already taken. Please choose a different one.');
          return;
        }
      } catch (error) {
        console.error('Failed to verify custom URL', error);
        this.promptFormError.set('Unable to verify custom URL availability. Please try again.');
        return;
      }
    }

    this.isSavingPrompt.set(true);
    this.promptFormError.set(null);
    this.customUrlError.set(null);

    try {
      const currentUser = this.authService.currentUser;
      if (!currentUser) {
        throw new Error('You must be signed in to update a prompt.');
      }

      if (this.isEditingPrompt() && this.editingPromptId()) {
        await this.promptService.updatePrompt(this.editingPromptId()!, {
          title,
          content,
          tag,
          customUrl: trimmedCustomUrl
        }, currentUser.uid);
      }

      const trimmedTag = (tag ?? '').trim();
      if (trimmedTag && !this.categories().some(c => c.value === trimmedTag) && !this.baseCategoryValues.has(trimmedTag)) {
        const next = [...this.categories(), { label: this.formatTagLabel(trimmedTag), value: trimmedTag }];
        next.sort((a, b) => a.label.localeCompare(b.label));
        this.categories.set(next);
      }

      this.resetCreatePromptForm();
      this.isEditingPrompt.set(false);
      this.editingPromptId.set(null);
      this.newPromptModalOpen.set(false);
    } catch (error) {
      console.error('Failed to save prompt', error);
      this.promptFormError.set(error instanceof Error ? error.message : 'Could not save the prompt. Please try again.');
    } finally {
      this.isSavingPrompt.set(false);
    }
  }

  onTagInput(value: string) {
    const raw = String(value ?? '');
    this.tagQuery.set(raw);
    this.clearDebounce();
    this.tagQueryTimer = setTimeout(() => {
      this.tagQueryDebounced.set(raw);
      this.tagQueryTimer = null;
    }, 180);
  }

  private clearDebounce() {
    if (this.tagQueryTimer) {
      clearTimeout(this.tagQueryTimer);
      this.tagQueryTimer = null;
    }
  }

  selectTagSuggestion(value: string) {
    this.createPromptForm.controls.tag.setValue(value);
    this.tagQuery.set('');
    this.clearDebounce();
    this.tagQueryDebounced.set('');
  }

  onCustomUrlInput(value: string) {
    const trimmed = String(value ?? '').trim();
    this.createPromptForm.controls.customUrl.setValue(trimmed, { emitEvent: false });
    
    if (this.customUrlTimer) {
      clearTimeout(this.customUrlTimer);
    }

    if (!trimmed) {
      this.customUrlError.set(null);
      this.isCheckingCustomUrl.set(false);
      return;
    }

    const urlPattern = /^[a-z0-9-]+$/i;
    if (!urlPattern.test(trimmed)) {
      this.customUrlError.set('Custom URL can only contain letters, numbers, and hyphens.');
      this.isCheckingCustomUrl.set(false);
      return;
    }

    const reservedPaths = ['home', 'auth', 'prompt', 'prompts', 'collections', 'admin', 'verify-email', 'community-guidelines', 'profile'];
    if (reservedPaths.includes(trimmed.toLowerCase())) {
      this.customUrlError.set('This URL is reserved. Please choose a different one.');
      this.isCheckingCustomUrl.set(false);
      return;
    }

    this.isCheckingCustomUrl.set(true);
    this.customUrlError.set(null);
    
    this.customUrlTimer = setTimeout(async () => {
      try {
        const isTaken = await this.promptService.isCustomUrlTaken(trimmed, this.editingPromptId());
        if (isTaken) {
          this.customUrlError.set('This custom URL is already taken. Please choose a different one.');
        } else {
          this.customUrlError.set(null);
        }
      } catch (error) {
        console.error('Failed to check custom URL', error);
        this.customUrlError.set('Unable to verify custom URL availability. Please try again.');
      } finally {
        this.isCheckingCustomUrl.set(false);
      }
    }, 500);
  }

  private clearCustomUrlDebounce() {
    if (this.customUrlTimer) {
      clearTimeout(this.customUrlTimer);
      this.customUrlTimer = null;
    }
  }

  private resetCreatePromptForm() {
    this.createPromptForm.reset({ ...this.createPromptDefaults });
    this.promptFormError.set(null);
    this.customUrlError.set(null);
    this.clearCustomUrlDebounce();
    this.createPromptForm.markAsPristine();
    this.createPromptForm.markAsUntouched();
  }

  @HostListener('document:keydown.escape')
  handleEscape() {
    if (this.newPromptModalOpen()) {
      this.closeCreatePromptModal();
      return;
    }

    if (this.menuOpen()) {
      this.closeMenu();
    }
  }

  private observePrompts() {
    this.route.queryParams.pipe(
      switchMap(params => {
        const userId = params['userId'];
        if (userId) {
          // Viewing another user's profile - show their prompts
          return this.promptService.promptsByAuthor$(userId);
        }
        // Viewing own profile - show own prompts
        return this.currentUser$.pipe(
          switchMap(user => {
            if (!user) {
              this.isLoadingPrompts.set(false);
              return of<Prompt[]>([]);
            }
            return this.promptService.promptsByAuthor$(user.uid);
          })
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: prompts => {
        const cards = prompts.map(prompt => this.mapPromptToCard(prompt));

        const hidden = this.hiddenCategories();
        if (hidden.size) {
          const nextHidden = new Set(hidden);
          let hiddenChanged = false;

          hidden.forEach(value => {
            const stillUsed = prompts.some(prompt => prompt.tag?.trim() === value);
            if (!stillUsed) {
              nextHidden.delete(value);
              hiddenChanged = true;
            }
          });

          if (hiddenChanged) {
            this.hiddenCategories.set(nextHidden);
          }
        }

        this.prompts.set(cards);
        this.syncCategories(prompts);
        this.isLoadingPrompts.set(false);
        this.loadPromptsError.set(null);
        if (this.promptFormError()) {
          this.promptFormError.set(null);
        }
        if (this.deleteError()) {
          this.deleteError.set(null);
        }
      },
      error: error => {
        console.error('Failed to load prompts', error);
        this.isLoadingPrompts.set(false);
        this.loadPromptsError.set('We could not load your prompts. Please try again.');
      }
    });
  }

  private mapPromptToCard(prompt: Prompt): PromptCard {
    const tag = prompt.tag || 'general';

    return {
      id: prompt.id,
      authorId: prompt.authorId,
      title: prompt.title,
      content: prompt.content,
      preview: this.buildPreview(prompt.content),
      tag,
      tagLabel: this.formatTagLabel(tag),
      customUrl: prompt.customUrl,
      views: prompt.views ?? 0,
      likes: prompt.likes ?? 0,
      createdAt: prompt.createdAt,
      updatedAt: prompt.updatedAt
    };
  }

  private buildPreview(content: string) {
    const normalized = content?.trim() ?? '';

    if (normalized.length <= 240) {
      return normalized;
    }

    return `${normalized.slice(0, 240).trimEnd()}…`;
  }

  private formatTagLabel(tag: string) {
    if (!tag) {
      return 'General';
    }

    return tag
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private syncCategories(prompts: readonly Prompt[]) {
    const existing = this.categories();
    const existingValues = new Set(existing.map(category => category.value));
    const hiddenValues = this.hiddenCategories();
    const additions: PromptCategory[] = [];

    prompts.forEach(prompt => {
      const tag = prompt.tag?.trim();

      if (!tag || tag === 'all' || existingValues.has(tag) || hiddenValues.has(tag)) {
        return;
      }

      existingValues.add(tag);
      additions.push({
        label: this.formatTagLabel(tag),
        value: tag
      });
    });

    if (additions.length) {
      additions.sort((a, b) => a.label.localeCompare(b.label));
      this.categories.set([...existing, ...additions]);
    }
  }
}

