import { CommonModule } from '@angular/common';
import { Component, DestroyRef, HostListener, computed, inject, signal, effect } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { PromptService } from '../../services/prompt.service';
import { HomeContentService } from '../../services/home-content.service';
import { OrganizationService } from '../../services/organization.service';
import { NavbarComponent } from '../../components/navbar/navbar.component';
import type { Prompt, CreatePromptInput, UpdatePromptInput } from '../../models/prompt.model';
import type { UserProfile } from '../../models/user-profile.model';
import type { Organization } from '../../models/organization.model';
import type { DailyTip } from '../../models/home-content.model';

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
  readonly launchGpt: number;
  readonly launchGemini: number;
  readonly launchClaude: number;
  readonly copied: number;
  readonly totalLaunch: number;
  readonly createdAt?: Date;
  readonly updatedAt?: Date;
  readonly authorProfile?: UserProfile;
  // Organization-related fields
  readonly organizationId?: string;
  readonly organizationProfile?: Organization;
  // Fork-related fields
  readonly forkedFromPromptId?: string;
  readonly forkedFromAuthorId?: string;
  readonly forkedFromTitle?: string;
  readonly forkedFromCustomUrl?: string;
  readonly forkCount?: number;
  readonly isPrivate?: boolean;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, NavbarComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css'
})
export class HomeComponent {
  private readonly authService = inject(AuthService);
  private readonly promptService = inject(PromptService);
  private readonly homeContentService = inject(HomeContentService);
  private readonly organizationService = inject(OrganizationService);
  readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  private readonly createPromptDefaults = {
    title: '',
    tag: '',
    customUrl: '',
    content: '',
    isPrivate: false
  } as const;

  readonly currentUser$ = this.authService.currentUser$;
  readonly profile$ = this.currentUser$.pipe(
    switchMap(user => {
      if (!user) {
        return of<UserProfile | undefined>(undefined);
      }

      return this.authService.userProfile$(user.uid);
    }),
    map(profile => {
      if (profile) {
        // Debug logging to help troubleshoot
        console.log('Profile loaded:', profile);
        console.log('Role:', profile.role);
        console.log('Admin:', profile.admin);
        console.log('Is admin?', profile.role === 'admin' || profile.admin);
      }
      return profile ? profile : undefined;
    })
  );

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
  readonly authorProfiles = signal<Map<string, UserProfile>>(new Map());
  readonly organizations = signal<Map<string, Organization>>(new Map());

  readonly searchTerm = signal('');
  readonly selectedCategory = signal<PromptCategory['value']>('all');
  readonly newPromptModalOpen = signal(false);
  readonly shareModalOpen = signal(false);
  readonly sharePrompt = signal<PromptCard | null>(null);
  readonly isEditingPrompt = signal(false);
  readonly editingPromptId = signal<string | null>(null);
  readonly isSavingPrompt = signal(false);
  readonly promptFormError = signal<string | null>(null);
  readonly isLoadingPrompts = signal(true);
  readonly loadPromptsError = signal<string | null>(null);
  readonly deleteError = signal<string | null>(null);
  readonly deletingPromptId = signal<string | null>(null);
  // Track prompt ids that were recently copied so we can show a check icon on the card
  readonly recentlyCopied = signal<Set<string>>(new Set());
  // Track prompt ids that were recently copied (for URL copying)
  readonly recentlyCopiedUrl = signal<Set<string>>(new Set());
  // Fork-related state
  readonly forkingPromptId = signal<string | null>(null);

  // Home content (daily tip and prompt of the day)
  readonly dailyTip = signal<DailyTip | null>(null);
  readonly promptOfTheDayId = signal<string | null>(null);
  readonly promptOfTheDay = signal<PromptCard | null>(null);

  // Map of timers for each copied prompt so we can clear them if the user copies again
  private readonly copyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly copyUrlTimers = new Map<string, ReturnType<typeof setTimeout>>();

  readonly createPromptForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(3)]],
    tag: ['', [Validators.required]],
    customUrl: [''],
    content: ['', [Validators.required, Validators.minLength(10)]],
    isPrivate: [false]
  });

  // Current tag input text mirrored as a signal so suggestions recompute on every keystroke.
  readonly tagQuery = signal('');
  // Debounced version of the tag query to avoid rapid recomputation and UI flicker.
  readonly tagQueryDebounced = signal('');
  private tagQueryTimer: ReturnType<typeof setTimeout> | null = null;

  // Custom URL validation
  readonly customUrlError = signal<string | null>(null);
  readonly isCheckingCustomUrl = signal(false);
  private customUrlTimer: ReturnType<typeof setTimeout> | null = null;

  // Suggestions for tag input based on existing categories (excluding base 'all')
  readonly tagSuggestions = computed(() => {

  // Use the debounced tagQuery to avoid flicker during rapid typing.
  const term = String(this.tagQueryDebounced()).trim().toLowerCase();

    if (!term) {
      return [];
    }

    // Normalize to letters only for matching (ignore spaces, hyphens, numbers etc.)
    const termLetters = term.replace(/[^a-z]/gi, '');

    if (!termLetters) {
      return [];
    }

    // Use a small fuzzy filter: accept if the letters-only candidate contains the typed letters
    // or the Levenshtein distance is reasonably small (to allow short fuzzy matches but
    // exclude long unrelated typed strings).
    return this.categories().filter(c => {
      if (c.value === 'all') return false;
      const candidate = String(c.value).toLowerCase().replace(/[^a-z]/gi, '');

      if (candidate.includes(termLetters)) return true;

      // allow short fuzzy matches: compute distance and accept if small relative to candidate length
      const distance = this.levenshteinDistance(termLetters, candidate);
      const threshold = Math.max(1, Math.floor(candidate.length * 0.35));
      return distance <= threshold;
    });
  });

  // Simple iterative Levenshtein distance (small inputs only, acceptable here)
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

  constructor() {
    this.observePrompts();
    this.observeHomeContent();
  }

  openShareModal(prompt: PromptCard) {
    this.sharePrompt.set(prompt);
    this.shareModalOpen.set(true);
  }

  closeShareModal() {
    this.shareModalOpen.set(false);
    this.sharePrompt.set(null);
  }

  createChatGPTUrl(prompt: string): string {
    const encodedPrompt = encodeURIComponent(prompt);
    const timestamp = Date.now();
    return `https://chat.openai.com/?q=${encodedPrompt}&t=${timestamp}`;
  }

  createGeminiUrl(prompt: string): string {
    // Gemini doesn't support URL parameters, so we just return the base URL
    // The prompt will be copied to clipboard before opening
    return 'https://gemini.google.com/app';
  }

  createClaudeUrl(prompt: string): string {
    const encodedPrompt = encodeURIComponent(prompt);
    return `https://claude.ai/?prompt=${encodedPrompt}`;
  }

  async openChatbot(url: string, chatbotName: string) {
    // ChatGPT supports URL parameters for pre-filling prompts
    // For other providers (Gemini, Claude), copy the prompt text first so paste inserts the prompt
    if (chatbotName === 'ChatGPT') {
      // ChatGPT: open directly (it accepts query param)
      window.open(url, '_blank');
      return;
    }

    // Gemini and other providers: copy to clipboard first
    const promptText = this.extractPromptFromUrl(url);

    try {
      if (promptText) {
        await navigator.clipboard.writeText(promptText);
        this.showCopyMessage(`${chatbotName} prompt copied!`);
      }
    } catch (e) {
      // Fallback to older copy method if clipboard API fails
      if (promptText) {
        this.fallbackCopyTextToClipboard(promptText);
        this.showCopyMessage(`${chatbotName} prompt copied!`);
      }
    }

    // open after copying
    window.open(url, '_blank');
  }

  copyPromptPageUrl() {
    const prompt = this.sharePrompt();
    if (!prompt) return;

    const short = (prompt.id ?? '').slice(0, 8);
    const origin = typeof window !== 'undefined' ? window.location.origin : '';

    const url = prompt.customUrl ? `${origin}/${prompt.customUrl}` : `${origin}/prompt/${short}`;

    navigator.clipboard.writeText(url).then(() => {
      this.showCopyMessage('Prompt URL copied!');
    }).catch(() => {
      this.fallbackCopyTextToClipboard(url);
      this.showCopyMessage('Prompt URL copied!');
    });
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

    // add to set (create new instance to trigger signal change)
    this.recentlyCopiedUrl.update(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

    // clear any existing timer for this id
    const existing = this.copyUrlTimers.get(id);
    if (existing) {
      clearTimeout(existing);
    }

    const DURATION = 2500; // ms

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
      // Fallback for older browsers
      this.fallbackCopyTextToClipboard(text);
      this.showCopyMessage('Prompt copied!');
      this.markPromptAsCopied(prompt.id);
    }
  }

  private markPromptAsCopied(id: string) {
    if (!id) return;

    // add to set (create new instance to trigger signal change)
    this.recentlyCopied.update(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

    // clear any existing timer for this id
    const existing = this.copyTimers.get(id);
    if (existing) {
      clearTimeout(existing);
    }

    const DURATION = 2500; // ms

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

  private extractPromptFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const searchParams = urlObj.searchParams;

      const encodedPrompt = searchParams.get('q') || searchParams.get('prompt') || '';
      return decodeURIComponent(encodedPrompt);
    } catch (e) {
      return '';
    }
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


  selectCategory(category: PromptCategory['value']) {
    this.selectedCategory.set(category);
  }

  isInitialCategory(value: string) {
    return this.baseCategoryValues.has(value);
  }

  removeCustomCategory(value: string, event: Event) {
    event.stopPropagation();

    if (this.isInitialCategory(value)) {
      return;
    }

    const hidden = new Set(this.hiddenCategories());
    hidden.add(value);
    this.hiddenCategories.set(hidden);

    this.categories.set(this.categories().filter(category => category.value !== value));

    if (this.selectedCategory() === value) {
      this.selectedCategory.set('all');
    }
  }

  onSearch(term: string) {
    this.searchTerm.set(term);
  }

  trackPromptById(_: number, prompt: PromptCard) {
    return prompt.id;
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

  getAuthorProfile(authorId: string): UserProfile | undefined {
    return this.authorProfiles().get(authorId);
  }

  getAuthorInitials(authorId: string): string {
    const profile = this.getAuthorProfile(authorId);
    return this.profileInitials(profile);
  }

  getOrganization(organizationId: string): Organization | undefined {
    return this.organizations().get(organizationId);
  }

  getOrganizationInitials(organization: Organization | undefined): string {
    if (!organization) {
      return 'ORG';
    }
    const name = organization.name || '';
    const words = name.trim().split(/\s+/);
    if (words.length >= 2) {
      return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
    }
    if (name.length >= 2) {
      return name.substring(0, 2).toUpperCase();
    }
    return name.charAt(0).toUpperCase() || 'ORG';
  }

  async navigateToAuthorProfile(authorId: string, event: Event) {
    event.stopPropagation();
    if (authorId) {
      // Try to get the profile to get the username
      const profile = await this.authService.fetchUserProfile(authorId);
      if (profile?.username) {
        void this.router.navigate(['/profile', profile.username]);
      } else {
        // Fallback to userId if username not available
        void this.router.navigate(['/profile'], { queryParams: { userId: authorId } });
      }
    }
  }

  navigateToOrganization(organizationId: string, event: Event) {
    event.stopPropagation();
    if (organizationId) {
      const organization = this.getOrganization(organizationId);
      if (organization?.username) {
        void this.router.navigate(['/organizations', organization.username]);
      } else {
        void this.router.navigate(['/organizations', organizationId]);
      }
    }
  }

  openCreatePromptModal() {
    this.isEditingPrompt.set(false);
    this.editingPromptId.set(null);
    this.forkingPromptId.set(null);
    this.promptFormError.set(null);
    this.customUrlError.set(null);
    this.clearCustomUrlDebounce();
    this.resetCreatePromptForm();
    this.tagQuery.set('');
    this.newPromptModalOpen.set(true);
  }

  openForkPromptModal(prompt: PromptCard) {
    const currentUser = this.authService.currentUser;
    if (!currentUser) {
      this.promptFormError.set('You must be signed in to fork a prompt.');
      return;
    }

    this.isEditingPrompt.set(false);
    this.editingPromptId.set(null);
    this.forkingPromptId.set(prompt.id);
    this.promptFormError.set(null);
    this.customUrlError.set(null);
    this.clearCustomUrlDebounce();
    
    // Pre-fill form with prompt data (but clear customUrl - forks need unique URLs)
    this.createPromptForm.setValue({
      title: prompt.title,
      tag: prompt.tag,
      customUrl: '',
      content: prompt.content,
      isPrivate: false // Forks are not private by default
    });
    this.createPromptForm.markAsPristine();
    this.createPromptForm.markAsUntouched();
    this.tagQuery.set('');
    this.newPromptModalOpen.set(true);
  }

  openEditPromptModal(prompt: PromptCard) {
    const currentUser = this.authService.currentUser;
    if (!currentUser) {
      this.promptFormError.set('You must be signed in to edit a prompt.');
      return;
    }

    // Check if user is the author
    if (prompt.authorId && prompt.authorId !== currentUser.uid) {
      this.promptFormError.set('You do not have permission to edit this prompt. Only the author can edit it.');
      return;
    }

    this.promptFormError.set(null);
    this.customUrlError.set(null);
    this.clearCustomUrlDebounce();
    this.isEditingPrompt.set(true);
    this.editingPromptId.set(prompt.id);
    this.createPromptForm.setValue({
      title: prompt.title,
      tag: prompt.tag,
      customUrl: prompt.customUrl ?? '',
      content: prompt.content,
      isPrivate: prompt.isPrivate ?? false
    });
    this.createPromptForm.markAsPristine();
    this.createPromptForm.markAsUntouched();
    // Do not enable suggestions immediately when editing a prompt; wait for the user to type
    this.tagQuery.set('');
    this.newPromptModalOpen.set(true);
  }

  /**
   * Check if the current user can edit a prompt (must be the author).
   */
  canEditPrompt(prompt: PromptCard): boolean {
    const currentUser = this.authService.currentUser;
    if (!currentUser) {
      return false;
    }
    // If prompt has no authorId, allow edit (for backward compatibility with old prompts)
    // If prompt has authorId, only allow if current user is the author
    return !prompt.authorId || prompt.authorId === currentUser.uid;
  }

  /**
   * Open a prompt using the custom URL if available, otherwise the short id (first 8 chars).
   */
  openPrompt(prompt: PromptCard) {
    if (prompt.customUrl) {
      void this.router.navigate([`/${prompt.customUrl}`]);
    } else {
      const short = (prompt?.id ?? '').slice(0, 8);
      if (!short) return;
      void this.router.navigate(['/prompt', short]);
    }
  }

  closeCreatePromptModal() {
    if (this.isSavingPrompt()) {
      return;
    }

    this.newPromptModalOpen.set(false);
    this.isEditingPrompt.set(false);
    this.editingPromptId.set(null);
    this.forkingPromptId.set(null);
    this.promptFormError.set(null);
    this.customUrlError.set(null);
    this.clearCustomUrlDebounce();
  }

  async submitPromptForm() {
    if (this.createPromptForm.invalid) {
      this.createPromptForm.markAllAsTouched();
      return;
    }

    const { title, tag, customUrl, content, isPrivate } = this.createPromptForm.getRawValue();
    const trimmedCustomUrl = (customUrl ?? '').trim();

    // Validate custom URL if provided
    if (trimmedCustomUrl) {
      // Check format
      const urlPattern = /^[a-z0-9-]+$/i;
      if (!urlPattern.test(trimmedCustomUrl)) {
        this.customUrlError.set('Custom URL can only contain letters, numbers, and hyphens.');
        return;
      }

      // Check reserved paths
      const reservedPaths = ['home', 'auth', 'prompt', 'prompts', 'collections', 'admin', 'verify-email', 'community-guidelines'];
      if (reservedPaths.includes(trimmedCustomUrl.toLowerCase())) {
        this.customUrlError.set('This URL is reserved. Please choose a different one.');
        return;
      }

      // Final uniqueness check before submitting
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
        throw new Error('You must be signed in to create a prompt.');
      }

      // Check if user is admin
      const profile = await this.authService.fetchUserProfile(currentUser.uid);
      const isAdmin = profile && (profile.role === 'admin' || profile.admin);

      if (this.isEditingPrompt() && this.editingPromptId()) {
        const updateInput: UpdatePromptInput = {
          title,
          content,
          tag,
          customUrl: trimmedCustomUrl,
          ...(isAdmin && typeof isPrivate === 'boolean' ? { isPrivate } : {})
        };
        await this.promptService.updatePrompt(this.editingPromptId()!, updateInput, currentUser.uid);
      } else if (this.forkingPromptId()) {
        // Forking a prompt
        const originalPrompt = this.prompts().find(p => p.id === this.forkingPromptId());
        if (originalPrompt) {
          const createInput: CreatePromptInput = {
            authorId: currentUser.uid,
            title,
            content,
            tag,
            customUrl: trimmedCustomUrl || undefined,
            forkedFromPromptId: originalPrompt.id,
            forkedFromAuthorId: originalPrompt.authorId,
            forkedFromTitle: originalPrompt.title,
            forkedFromCustomUrl: originalPrompt.customUrl,
            ...(isAdmin && typeof isPrivate === 'boolean' ? { isPrivate } : {})
          };
          await this.promptService.createPrompt(createInput);
        } else {
          throw new Error('Original prompt not found.');
        }
      } else {
        const createInput: CreatePromptInput = {
          authorId: currentUser.uid,
          title,
          content,
          tag,
          customUrl: trimmedCustomUrl || undefined,
          ...(isAdmin && typeof isPrivate === 'boolean' ? { isPrivate } : {})
        };
        await this.promptService.createPrompt(createInput);
      }

      // If the user entered a new tag that isn't already in categories, add it locally
      const trimmedTag = (tag ?? '').trim();
      if (trimmedTag && !this.categories().some(c => c.value === trimmedTag) && !this.baseCategoryValues.has(trimmedTag)) {
        const next = [...this.categories(), { label: this.formatTagLabel(trimmedTag), value: trimmedTag }];
        next.sort((a, b) => a.label.localeCompare(b.label));
        this.categories.set(next);
      }

      this.resetCreatePromptForm();
      this.isEditingPrompt.set(false);
      this.editingPromptId.set(null);
      this.forkingPromptId.set(null);
      this.newPromptModalOpen.set(false);
    } catch (error) {
      console.error('Failed to save prompt', error);
      this.promptFormError.set(error instanceof Error ? error.message : 'Could not save the prompt. Please try again.');
    } finally {
      this.isSavingPrompt.set(false);
    }
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

    // Check if user is the author
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


  @HostListener('document:keydown.escape')
  handleEscape() {
    if (this.newPromptModalOpen()) {
      this.closeCreatePromptModal();
      return;
    }

    // Menu handling moved to NavbarComponent
  }

  private observePrompts() {
    this.promptService
      .prompts$()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
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
          this.loadAuthorProfiles(prompts);
          this.loadOrganizations(prompts);
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

  private loadAuthorProfiles(prompts: readonly Prompt[]) {
    const uniqueAuthorIds = new Set<string>();
    prompts.forEach(prompt => {
      if (prompt.authorId) {
        uniqueAuthorIds.add(prompt.authorId);
      }
    });

    const profilesMap = new Map(this.authorProfiles());
    const profilesToLoad: string[] = [];

    uniqueAuthorIds.forEach(authorId => {
      if (!profilesMap.has(authorId)) {
        profilesToLoad.push(authorId);
      }
    });

    if (profilesToLoad.length === 0) {
      return;
    }

    // Load profiles in parallel
    Promise.all(
      profilesToLoad.map(authorId =>
        this.authService.fetchUserProfile(authorId).then(profile => ({
          authorId,
          profile
        }))
      )
    ).then(results => {
      const updatedMap = new Map(profilesMap);
      results.forEach(({ authorId, profile }) => {
        if (profile) {
          updatedMap.set(authorId, profile);
        }
      });
      this.authorProfiles.set(updatedMap);
      
      // Update prompt cards with author profiles
      const updatedCards = this.prompts().map(card => ({
        ...card,
        authorProfile: card.authorId ? updatedMap.get(card.authorId) : undefined
      }));
      this.prompts.set(updatedCards);
    });
  }

  private loadOrganizations(prompts: readonly Prompt[]) {
    const uniqueOrganizationIds = new Set<string>();
    prompts.forEach(prompt => {
      if (prompt.organizationId) {
        uniqueOrganizationIds.add(prompt.organizationId);
      }
    });

    const organizationsMap = new Map(this.organizations());
    const organizationsToLoad: string[] = [];

    uniqueOrganizationIds.forEach(organizationId => {
      if (!organizationsMap.has(organizationId)) {
        organizationsToLoad.push(organizationId);
      }
    });

    if (organizationsToLoad.length === 0) {
      return;
    }

    // Load organizations in parallel
    Promise.all(
      organizationsToLoad.map(organizationId =>
        this.organizationService.fetchOrganization(organizationId).then(organization => ({
          organizationId,
          organization
        }))
      )
    ).then(results => {
      const updatedMap = new Map(organizationsMap);
      results.forEach(({ organizationId, organization }) => {
        if (organization) {
          updatedMap.set(organizationId, organization);
        }
      });
      this.organizations.set(updatedMap);
      
      // Update prompt cards with organization profiles
      const updatedCards = this.prompts().map(card => ({
        ...card,
        organizationProfile: card.organizationId ? updatedMap.get(card.organizationId) : undefined
      }));
      this.prompts.set(updatedCards);
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
      launchGpt: prompt.launchGpt ?? 0,
      launchGemini: prompt.launchGemini ?? 0,
      launchClaude: prompt.launchClaude ?? 0,
      copied: prompt.copied ?? 0,
      totalLaunch: prompt.totalLaunch ?? 0,
      createdAt: prompt.createdAt,
      updatedAt: prompt.updatedAt,
      authorProfile: prompt.authorId ? this.authorProfiles().get(prompt.authorId) : undefined,
      organizationId: prompt.organizationId,
      organizationProfile: prompt.organizationId ? this.organizations().get(prompt.organizationId) : undefined,
      forkedFromPromptId: prompt.forkedFromPromptId,
      forkedFromAuthorId: prompt.forkedFromAuthorId,
      forkedFromTitle: prompt.forkedFromTitle,
      forkedFromCustomUrl: prompt.forkedFromCustomUrl,
      forkCount: prompt.forkCount,
      isPrivate: prompt.isPrivate
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

  private resetCreatePromptForm() {
    this.createPromptForm.reset({ ...this.createPromptDefaults });
    this.promptFormError.set(null);
    this.customUrlError.set(null);
    this.clearCustomUrlDebounce();
    this.createPromptForm.markAsPristine();
    this.createPromptForm.markAsUntouched();
  }

  selectTagSuggestion(value: string) {
    this.createPromptForm.controls.tag.setValue(value);
    // hide suggestions after selecting
    this.tagQuery.set('');
    this.clearDebounce();
    this.tagQueryDebounced.set('');
  }

  onTagInput(value: string) {
    const raw = String(value ?? '');
    this.tagQuery.set(raw);
    // debounce updating the debounced signal
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

  onCustomUrlInput(value: string) {
    const trimmed = String(value ?? '').trim();
    this.createPromptForm.controls.customUrl.setValue(trimmed, { emitEvent: false });
    
    // Clear any existing timer
    if (this.customUrlTimer) {
      clearTimeout(this.customUrlTimer);
    }

    // Clear error if empty
    if (!trimmed) {
      this.customUrlError.set(null);
      this.isCheckingCustomUrl.set(false);
      return;
    }

    // Validate format first
    const urlPattern = /^[a-z0-9-]+$/i;
    if (!urlPattern.test(trimmed)) {
      this.customUrlError.set('Custom URL can only contain letters, numbers, and hyphens.');
      this.isCheckingCustomUrl.set(false);
      return;
    }

    // Check for reserved paths
    const reservedPaths = ['home', 'auth', 'prompt', 'prompts', 'collections', 'admin', 'verify-email', 'community-guidelines'];
    if (reservedPaths.includes(trimmed.toLowerCase())) {
      this.customUrlError.set('This URL is reserved. Please choose a different one.');
      this.isCheckingCustomUrl.set(false);
      return;
    }

    // Debounce the uniqueness check
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
    }, 500); // 500ms debounce
  }

  private clearCustomUrlDebounce() {
    if (this.customUrlTimer) {
      clearTimeout(this.customUrlTimer);
      this.customUrlTimer = null;
    }
  }

  private observeHomeContent() {
    this.homeContentService
      .homeContent$()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: async (content) => {
          if (content?.dailyTip) {
            // Get today's tip or previous one
            const tip = await this.homeContentService.getDailyTip();
            this.dailyTip.set(tip);
          } else {
            this.dailyTip.set(null);
          }

          if (content?.promptOfTheDayId) {
            // Get today's prompt or previous one
            const promptId = await this.homeContentService.getPromptOfTheDay();
            this.promptOfTheDayId.set(promptId);

            // Find the prompt card
            if (promptId) {
              const prompt = this.prompts().find(p => p.id === promptId || p.id.startsWith(promptId));
              this.promptOfTheDay.set(prompt || null);
            } else {
              this.promptOfTheDay.set(null);
            }
          } else {
            this.promptOfTheDayId.set(null);
            this.promptOfTheDay.set(null);
          }
        },
        error: (error) => {
          console.error('Failed to observe home content', error);
        }
      });

    // Also watch prompts to update prompt of the day when prompts change
    effect(() => {
      const promptId = this.promptOfTheDayId();
      const prompts = this.prompts(); // Read the signal to track changes
      if (promptId) {
        const prompt = prompts.find(p => p.id === promptId || p.id.startsWith(promptId));
        this.promptOfTheDay.set(prompt || null);
      }
    });
  }

  getGreeting(profile: UserProfile | undefined): string {
    if (!profile) {
      return 'Welcome!';
    }

    const hour = new Date().getHours();
    let timeGreeting = 'Welcome';
    
    if (hour < 12) {
      timeGreeting = 'Good morning';
    } else if (hour < 17) {
      timeGreeting = 'Good afternoon';
    } else {
      timeGreeting = 'Good evening';
    }

    return `${timeGreeting}, ${profile.firstName}!`;
  }

  getTodayDateString(): string {
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    return now.toLocaleDateString('en-US', options);
  }

  getOriginalPromptUrl(prompt: PromptCard): string | null {
    if (!prompt.forkedFromPromptId) {
      return null;
    }
    
    if (prompt.forkedFromCustomUrl) {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      return `${origin}/${prompt.forkedFromCustomUrl}`;
    }
    
    if (prompt.forkedFromPromptId) {
      const short = prompt.forkedFromPromptId.slice(0, 8);
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      return `${origin}/prompt/${short}`;
    }
    
    return null;
  }

  navigateToOriginalPrompt(prompt: PromptCard, event: Event) {
    event.stopPropagation();
    const url = this.getOriginalPromptUrl(prompt);
    if (url) {
      void this.router.navigateByUrl(url.replace(window.location.origin, ''));
    }
  }

  getForkingPromptTitle(): string {
    const forkingId = this.forkingPromptId();
    if (!forkingId) {
      return 'Original prompt';
    }
    const prompt = this.prompts().find(p => p.id === forkingId);
    return prompt?.title || 'Original prompt';
  }

  async navigateToHomeOrLanding() {
    const user = this.authService.currentUser;
    if (user) {
      await this.router.navigate(['/home']);
    } else {
      await this.router.navigate(['/']);
    }
  }
}
