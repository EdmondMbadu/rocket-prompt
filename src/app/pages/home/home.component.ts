import { CommonModule } from '@angular/common';
import { Component, DestroyRef, HostListener, computed, inject, signal, effect } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { PromptService } from '../../services/prompt.service';
import { HomeContentService } from '../../services/home-content.service';
import { OrganizationService } from '../../services/organization.service';
import { NavbarComponent } from '../../components/navbar/navbar.component';
import type { Prompt, CreatePromptInput, UpdatePromptInput } from '../../models/prompt.model';
import type { UserProfile, DirectLaunchTarget } from '../../models/user-profile.model';
import type { Organization } from '../../models/organization.model';
import type { DailyTip } from '../../models/home-content.model';
import type { PromptCard } from '../../models/prompt-card.model';
import { PromptCardComponent } from '../../components/prompt-card/prompt-card.component';
import { ShareModalComponent } from '../../components/share-modal/share-modal.component';
import { shouldShowUpgradeBanner, getUpgradeBannerConfig } from '../../utils/subscription.util';
import { RocketGoalsLaunchService } from '../../services/rocket-goals-launch.service';
import {
  BULK_UPLOAD_INSTRUCTIONS_URL,
  type BulkUploadProgressState,
  canUseBulkUploadFeature,
  createEmptyBulkProgress,
  parseCsv,
  parseCsvBoolean,
  parseCsvNumber
} from '../../utils/bulk-upload.util';
import type { QueryDocumentSnapshot } from 'firebase/firestore';

interface PromptCategory {
  readonly label: string;
  readonly value: string;
}

interface ChatbotOption {
  readonly id: DirectLaunchTarget;
  readonly label: string;
  readonly description: string;
  readonly icon: string;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, NavbarComponent, PromptCardComponent, ShareModalComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css'
})
export class HomeComponent {
  private readonly authService = inject(AuthService);
  private readonly promptService = inject(PromptService);
  private readonly homeContentService = inject(HomeContentService);
  private readonly organizationService = inject(OrganizationService);
  private readonly rocketGoalsLaunchService = inject(RocketGoalsLaunchService);
  readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  private readonly createPromptDefaults = {
    title: '',
    tag: '',
    customUrl: '',
    content: '',
    isPrivate: false
  } as const;

  onPromptImageSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      this.imageError.set('Only image files are allowed.');
      input.value = '';
      return;
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      this.imageError.set('Image size must be less than 10MB.');
      input.value = '';
      return;
    }

    this.imageError.set(null);
    this.promptImageFile.set(file);

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      this.promptImagePreview.set(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  }

  removePromptImage() {
    this.promptImageFile.set(null);
    this.promptImagePreview.set(null);
    this.imageError.set(null);
  }

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
  // Pagination state for infinite scroll
  readonly isLoadingMore = signal(false);
  readonly hasMorePrompts = signal(true);
  private lastPromptDoc: QueryDocumentSnapshot | null = null;
  // Track prompt ids that were recently copied so we can show a check icon on the card
  readonly recentlyCopied = signal<Set<string>>(new Set());
  // Track prompt ids that were recently copied (for URL copying)
  readonly recentlyCopiedUrl = signal<Set<string>>(new Set());
  // Fork-related state
  readonly forkingPromptId = signal<string | null>(null);
  readonly checkoutNotice = signal<{ type: 'success' | 'error'; plan?: 'plus' | 'team' } | null>(null);
  readonly createPromptMode = signal<'single' | 'bulk'>('single');
  readonly showBulkUploadTab = computed(() => !this.isEditingPrompt() && !this.forkingPromptId());
  readonly bulkUploadInstructionsUrl = BULK_UPLOAD_INSTRUCTIONS_URL;
  readonly isProcessingBulkUpload = signal(false);
  readonly bulkUploadProgress = signal<BulkUploadProgressState>(createEmptyBulkProgress());
  readonly bulkUploadError = signal<string | null>(null);
  readonly bulkUploadSuccess = signal<string | null>(null);
  readonly chatbotOptions: readonly ChatbotOption[] = [
    { id: 'chatgpt', label: 'ChatGPT', description: 'Best for most prompts', icon: 'assets/gpt.png' },
    { id: 'gemini', label: 'Gemini', description: 'Google Bard successor', icon: 'assets/gemini.png' },
    { id: 'claude', label: 'Claude', description: 'Anthropic assistant', icon: 'assets/claude.jpeg' },
    { id: 'grok', label: 'Grok', description: 'xAI experimental model', icon: 'assets/grok.jpg' }
  ];
  readonly defaultChatbot = signal<DirectLaunchTarget>('chatgpt');

  // Home content (daily tip and most launched prompt)
  readonly dailyTip = signal<DailyTip | null>(null);
  readonly mostLaunchedPrompt = computed<PromptCard | null>(() => {
    const prompts = this.prompts();
    if (prompts.length === 0) {
      return null;
    }
    
    // Find the prompt with the highest totalLaunch count
    let mostLaunched = prompts[0];
    for (const prompt of prompts) {
      if ((prompt.totalLaunch || 0) > (mostLaunched.totalLaunch || 0)) {
        mostLaunched = prompt;
      }
    }
    
    // Only return if it has at least one launch
    return (mostLaunched.totalLaunch || 0) > 0 ? mostLaunched : null;
  });

  // Map of timers for each copied prompt so we can clear them if the user copies again
  private readonly copyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly copyUrlTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly defaultChatbotStorageKey = 'rocketPromptDefaultChatbot';

  constructor() {
    this.restoreDefaultChatbotPreference();
    this.observeCheckoutStatus();
    this.observePrompts();
    this.observeHomeContent();
    this.subscribeToDefaultChatbotPreference();
    this.setupScrollListener();
  }

  readonly createPromptForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(3)]],
    tag: ['', [Validators.required]],
    customUrl: [''],
    content: [''],
    isPrivate: [false]
  });

  readonly promptImageFile = signal<File | null>(null);
  readonly promptImagePreview = signal<string | null>(null);
  readonly uploadingImage = signal(false);
  readonly imageError = signal<string | null>(null);

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
    return `https://claude.ai/new?q=${encodedPrompt}`;
  }

  createGrokUrl(prompt: string): string {
    const encodedPrompt = encodeURIComponent(prompt);
    const timestamp = Date.now();
    return `https://grok.com/?q=${encodedPrompt}&t=${timestamp}`;
  }

  async handleOpenChatbot(chatbotName: 'ChatGPT' | 'Gemini' | 'Claude' | 'Grok' | 'RocketGoals'): Promise<void> {
    const prompt = this.sharePrompt();
    if (!prompt?.content) return;

    if (chatbotName === 'RocketGoals') {
      await this.launchRocketGoalsPrompt(prompt);
      return;
    }

    let url: string;
    let launchType: 'gpt' | 'gemini' | 'claude' | 'grok';
    switch (chatbotName) {
      case 'ChatGPT':
        url = this.createChatGPTUrl(prompt.content);
        launchType = 'gpt';
        break;
      case 'Gemini':
        url = this.createGeminiUrl(prompt.content);
        launchType = 'gemini';
        break;
      case 'Claude':
        url = this.createClaudeUrl(prompt.content);
        launchType = 'claude';
        break;
      case 'Grok':
        url = this.createGrokUrl(prompt.content);
        launchType = 'grok';
        break;
    }
    await this.openChatbot(url, chatbotName, prompt.content);
    await this.trackPromptLaunch(prompt, launchType);
  }

  private async launchRocketGoalsPrompt(prompt: PromptCard): Promise<void> {
    const content = prompt.content ?? '';
    if (!content) {
      this.showCopyMessage('Prompt is missing content.');
      return;
    }

    const launch = this.rocketGoalsLaunchService.prepareLaunch(content, prompt.id ?? undefined);
    if (typeof window !== 'undefined') {
      window.open(launch.url, '_blank');
    }

    if (!launch.stored) {
      this.copyTextForRocketGoals(content);
      this.showCopyMessage('Prompt copied! Paste it into Rocket AI and tap Launch to send.');
    } else {
      this.showCopyMessage('Prompt ready in Rocket AI - tap Launch to send.');
    }

    // Track launch
    if (prompt.id) {
      try {
        await this.promptService.trackLaunch(prompt.id, 'rocket');
      } catch (e) {
        console.error('Failed to track launch', e);
      }
    }
  }

  private copyTextForRocketGoals(text: string): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).catch(() => {
        this.fallbackCopyTextToClipboard(text);
      });
      return;
    }

    this.fallbackCopyTextToClipboard(text);
  }

  async openChatbot(url: string, chatbotName: string, promptText?: string) {
    // ChatGPT and Claude support URL parameters for pre-filling prompts
    if (chatbotName === 'ChatGPT' || chatbotName === 'Claude') {
      // Open directly (they accept query params)
      window.open(url, '_blank');
      return;
    }

    // Gemini and other providers: copy to clipboard first
    const textToCopy = promptText || this.extractPromptFromUrl(url);

    try {
      if (textToCopy) {
        await navigator.clipboard.writeText(textToCopy);
        this.showCopyMessage(`${chatbotName} prompt copied!`);
      }
    } catch (e) {
      // Fallback to older copy method if clipboard API fails
      if (textToCopy) {
        this.fallbackCopyTextToClipboard(textToCopy);
        this.showCopyMessage(`${chatbotName} prompt copied!`);
      }
    }

    // open after copying
    window.open(url, '_blank');
  }

  copyOneClickLink(target: 'gpt' | 'grok' | 'claude' | 'rocket') {
    const prompt = this.sharePrompt();
    if (!prompt) return;

    const url = this.buildOneShotLink(prompt, target);
    if (!url) return;

    const label = target === 'gpt'
      ? 'One Shot GPT'
      : target === 'grok'
      ? 'One Shot Grok'
      : target === 'claude'
      ? 'One Shot Claude'
      : 'One Shot Rocket';
    navigator.clipboard.writeText(url).then(() => {
      this.showCopyMessage(`${label} link copied!`);
    }).catch(() => {
      this.fallbackCopyTextToClipboard(url);
      this.showCopyMessage(`${label} link copied!`);
    });
  }

  async launchPrompt(prompt: PromptCard) {
    if (!prompt?.content) {
      this.showCopyMessage('Prompt is missing content.');
      return;
    }

    const target = this.defaultChatbot();
    const text = prompt.content;

    let url = '';
    let chatbotName: string;
    let launchType: 'gpt' | 'gemini' | 'claude' | 'grok';

    switch (target) {
      case 'gemini':
        url = this.createGeminiUrl(text);
        chatbotName = 'Gemini';
        launchType = 'gemini';
        break;
      case 'claude':
        url = this.createClaudeUrl(text);
        chatbotName = 'Claude';
        launchType = 'claude';
        break;
      case 'grok':
        url = this.createGrokUrl(text);
        chatbotName = 'Grok';
        launchType = 'grok';
        break;
      case 'chatgpt':
      default:
        url = this.createChatGPTUrl(text);
        chatbotName = 'ChatGPT';
        launchType = 'gpt';
        break;
    }

    await this.openChatbot(url, chatbotName, text);
    await this.trackPromptLaunch(prompt, launchType);
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

  copyPromptFromShare() {
    const prompt = this.sharePrompt();
    if (!prompt) return;
    this.copyPrompt(prompt);
  }

  getPromptUrl(prompt: PromptCard): string {
    const short = prompt.id ? prompt.id.slice(0, 8) : '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return prompt.customUrl ? `${origin}/${prompt.customUrl}` : `${origin}/prompt/${short}`;
  }

  private buildOneShotLink(prompt: PromptCard, target: 'gpt' | 'grok' | 'claude' | 'rocket'): string | null {
    const base = this.getPromptUrl(prompt);
    if (!base) {
      return null;
    }
    const suffix = target === 'gpt' ? 'GPT' : target === 'grok' ? 'GROK' : target === 'claude' ? 'CLAUDE' : 'ROCKET';
    return `${base}/${suffix}`;
  }

  getPromptDisplayUrl(prompt: PromptCard): string {
    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'rocketprompt.io';
    const short = prompt.id ? prompt.id.slice(0, 8) : '';
    return prompt.customUrl ? `${hostname}/${prompt.customUrl}` : `${hostname}/prompt/${short}`;
  }

  setDefaultChatbot(option: DirectLaunchTarget, persistPreference = true) {
    if (!this.isValidChatbot(option)) {
      return;
    }
    if (this.defaultChatbot() === option) {
      return;
    }
    this.defaultChatbot.set(option);
    this.persistDefaultChatbotLocally(option);
    if (persistPreference) {
      void this.saveDefaultChatbotPreference(option);
    }
  }

  getDefaultChatbotLabel(): string {
    return this.chatbotOptions.find(option => option.id === this.defaultChatbot())?.label ?? 'ChatGPT';
  }

  private subscribeToDefaultChatbotPreference() {
    this.profile$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(profile => {
        this.applyDefaultChatbotFromPreferences(profile?.preferences?.defaultChatbot);
      });
  }

  private applyDefaultChatbotFromPreferences(preference?: DirectLaunchTarget | null) {
    if (preference && this.isValidChatbot(preference)) {
      this.setDefaultChatbot(preference, false);
    }
  }

  private persistDefaultChatbotLocally(option: DirectLaunchTarget) {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(this.defaultChatbotStorageKey, option);
    } catch (e) {
      console.warn('Could not persist chatbot preference', e);
    }
  }

  private readDefaultChatbotFromStorage(): DirectLaunchTarget | null {
    if (typeof window === 'undefined') {
      return null;
    }
    try {
      const stored = window.localStorage.getItem(this.defaultChatbotStorageKey);
      if (stored && this.isValidChatbot(stored)) {
        return stored;
      }
    } catch (e) {
      console.warn('Failed to read chatbot preference', e);
    }
    return null;
  }

  private async saveDefaultChatbotPreference(option: DirectLaunchTarget) {
    const user = this.authService.currentUser;
    if (!user) {
      return;
    }
    try {
      await this.authService.updateUserPreferences(user.uid, { defaultChatbot: option });
    } catch (error) {
      console.error('Failed to save chatbot preference', error);
    }
  }

  private restoreDefaultChatbotPreference() {
    const stored = this.readDefaultChatbotFromStorage();
    if (stored && this.isValidChatbot(stored)) {
      this.setDefaultChatbot(stored, false);
    }
  }

  private isValidChatbot(option: string): option is DirectLaunchTarget {
    return this.chatbotOptions.some(bot => bot.id === option);
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

  private async trackPromptLaunch(prompt: PromptCard, launchType: 'gpt' | 'gemini' | 'claude' | 'grok') {
    if (!prompt?.id) {
      return;
    }

    try {
      const result = await this.promptService.trackLaunch(prompt.id, launchType);
      this.prompts.update(prev => prev.map(card => {
        if (card.id !== prompt.id) {
          return card;
        }
        return {
          ...card,
          launchGpt: result.launchGpt,
          launchGemini: result.launchGemini,
          launchClaude: result.launchClaude,
          launchGrok: result.launchGrok,
          copied: result.copied,
          totalLaunch: result.totalLaunch
        };
      }));
    } catch (error) {
      console.error('Failed to record launch', error);
    }
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
        void this.router.navigate(['/organization', organization.username]);
      } else {
        // Fallback: navigate to organizations list page if no username
        void this.router.navigate(['/organizations']);
      }
    }
  }

  openCreatePromptModal() {
    this.isEditingPrompt.set(false);
    this.editingPromptId.set(null);
    this.forkingPromptId.set(null);
    this.createPromptMode.set('single');
    this.resetBulkUploadState();
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
    this.createPromptMode.set('single');
    this.resetBulkUploadState();
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
    // Don't copy image when forking - user can add their own
    this.removePromptImage();
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
    this.createPromptMode.set('single');
    this.resetBulkUploadState();
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
    // Set image preview if prompt has image
    if (prompt.imageUrl) {
      this.promptImagePreview.set(prompt.imageUrl);
      this.promptImageFile.set(null); // We don't have the file, just the URL
    } else {
      this.removePromptImage();
    }
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

  canManagePrivatePrompts(profile: UserProfile | null | undefined): boolean {
    if (!profile) {
      return false;
    }

    if (profile.role === 'admin' || profile.admin) {
      return true;
    }

    const status = profile.subscriptionStatus?.toLowerCase();
    return status === 'pro' || status === 'plus';
  }

  shouldShowUpgradeBanner(profile: UserProfile | null | undefined): boolean {
    if (!profile) {
      return true;
    }
    return shouldShowUpgradeBanner(profile.subscriptionStatus, profile.subscriptionExpiresAt);
  }

  getUpgradeBannerText(profile: UserProfile | null | undefined): string {
    return getUpgradeBannerConfig(profile?.subscriptionStatus).label;
  }

  getUpgradeBannerQueryParams(profile: UserProfile | null | undefined) {
    const config = getUpgradeBannerConfig(profile?.subscriptionStatus);
    return { plan: config.plan };
  }

  redirectToPricing() {
    void this.router.navigate(['/pricing']);
  }

  closeCreatePromptModal() {
    if (this.isSavingPrompt()) {
      return;
    }

    this.newPromptModalOpen.set(false);
    this.isEditingPrompt.set(false);
    this.editingPromptId.set(null);
    this.forkingPromptId.set(null);
    this.createPromptMode.set('single');
    this.resetBulkUploadState();
    this.promptFormError.set(null);
    this.customUrlError.set(null);
    this.clearCustomUrlDebounce();
    this.removePromptImage();
  }

  switchCreatePromptMode(mode: 'single' | 'bulk') {
    const isSameMode = this.createPromptMode() === mode;
    if (isSameMode) {
      return;
    }

    if (mode === 'bulk' && !this.showBulkUploadTab()) {
      return;
    }

    if (mode === 'bulk') {
      this.resetBulkUploadState();
      this.bulkUploadError.set(null);
      this.bulkUploadSuccess.set(null);
    }

    if (mode === 'single') {
      this.bulkUploadError.set(null);
      this.bulkUploadSuccess.set(null);
    }

    this.createPromptMode.set(mode);
  }

  canUseBulkUpload(profile: UserProfile | null | undefined): boolean {
    return canUseBulkUploadFeature(profile);
  }

  async submitPromptForm() {
    if (this.createPromptForm.invalid) {
      this.createPromptForm.markAllAsTouched();
      return;
    }

    const { title, tag, customUrl, content, isPrivate } = this.createPromptForm.getRawValue();
    const trimmedContent = (content ?? '').trim();
    const trimmedCustomUrl = (customUrl ?? '').trim();
    const imageFile = this.promptImageFile();

    // Validate that either content or image is provided
    if (!trimmedContent && !imageFile) {
      this.promptFormError.set('Either prompt content or an image is required.');
      this.createPromptForm.controls.content.markAsTouched();
      return;
    }

    // Validate content length if provided
    if (trimmedContent && trimmedContent.length < 10) {
      this.promptFormError.set('Content must be at least 10 characters if provided.');
      this.createPromptForm.controls.content.markAsTouched();
      return;
    }

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

      // Check if the user can manage private prompts (admins or Plus/Pro subscribers)
      const profile = await this.authService.fetchUserProfile(currentUser.uid);
      const canSetPrivate = this.canManagePrivatePrompts(profile);

      let imageUrl: string | undefined = undefined;

      // Upload image if provided
      if (imageFile) {
        this.uploadingImage.set(true);
        try {
          if (this.isEditingPrompt() && this.editingPromptId()) {
            imageUrl = await this.promptService.uploadPromptImage(this.editingPromptId()!, imageFile, currentUser.uid);
          } else {
            // For new prompts, we'll create the prompt first, then upload the image
            // We'll handle this after prompt creation
          }
        } catch (error) {
          console.error('Failed to upload image', error);
          this.imageError.set(error instanceof Error ? error.message : 'Failed to upload image. Please try again.');
          this.isSavingPrompt.set(false);
          this.uploadingImage.set(false);
          return;
        } finally {
          this.uploadingImage.set(false);
        }
      }

      if (this.isEditingPrompt() && this.editingPromptId()) {
        const updateInput: UpdatePromptInput = {
          title,
          content: trimmedContent,
          tag,
          customUrl: trimmedCustomUrl,
          ...(imageUrl ? { imageUrl } : {}),
          ...(canSetPrivate && typeof isPrivate === 'boolean' ? { isPrivate } : {})
        };
        await this.promptService.updatePrompt(this.editingPromptId()!, updateInput, currentUser.uid);
      } else if (this.forkingPromptId()) {
        // Forking a prompt
        const originalPrompt = this.prompts().find(p => p.id === this.forkingPromptId());
        if (originalPrompt) {
          // Create prompt first
          const createInput: CreatePromptInput = {
            authorId: currentUser.uid,
            title,
            content: trimmedContent,
            tag,
            customUrl: trimmedCustomUrl || undefined,
            forkedFromPromptId: originalPrompt.id,
            forkedFromAuthorId: originalPrompt.authorId,
            forkedFromTitle: originalPrompt.title,
            forkedFromCustomUrl: originalPrompt.customUrl,
            ...(canSetPrivate && typeof isPrivate === 'boolean' ? { isPrivate } : {})
          };
          const promptId = await this.promptService.createPrompt(createInput);

          // Upload image if provided
          if (imageFile) {
            this.uploadingImage.set(true);
            try {
              imageUrl = await this.promptService.uploadPromptImage(promptId, imageFile, currentUser.uid);
              // Update prompt with imageUrl
              await this.promptService.updatePrompt(promptId, { ...createInput, imageUrl }, currentUser.uid);
            } catch (error) {
              console.error('Failed to upload image', error);
              this.imageError.set(error instanceof Error ? error.message : 'Failed to upload image. Please try again.');
            } finally {
              this.uploadingImage.set(false);
            }
          }
        } else {
          throw new Error('Original prompt not found.');
        }
      } else {
        // Create prompt first
        const createInput: CreatePromptInput = {
          authorId: currentUser.uid,
          title,
          content: trimmedContent,
          tag,
          customUrl: trimmedCustomUrl || undefined,
          ...(canSetPrivate && typeof isPrivate === 'boolean' ? { isPrivate } : {})
        };
        const promptId = await this.promptService.createPrompt(createInput);

        // Upload image if provided
        if (imageFile) {
          this.uploadingImage.set(true);
          try {
            imageUrl = await this.promptService.uploadPromptImage(promptId, imageFile, currentUser.uid);
            // Update prompt with imageUrl
            await this.promptService.updatePrompt(promptId, { ...createInput, imageUrl }, currentUser.uid);
          } catch (error) {
            console.error('Failed to upload image', error);
            this.imageError.set(error instanceof Error ? error.message : 'Failed to upload image. Please try again.');
          } finally {
            this.uploadingImage.set(false);
          }
        }
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
      this.removePromptImage();
    } catch (error) {
      console.error('Failed to save prompt', error);
      this.promptFormError.set(error instanceof Error ? error.message : 'Could not save the prompt. Please try again.');
    } finally {
      this.isSavingPrompt.set(false);
    }
  }

  async onBulkUploadCSV(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    input.value = '';

    if (this.isProcessingBulkUpload()) {
      return;
    }

    const currentUser = this.authService.currentUser;

    if (!currentUser) {
      this.bulkUploadError.set('You must be signed in to upload prompts.');
      return;
    }

    let profile: UserProfile | undefined;

    try {
      profile = await this.authService.fetchUserProfile(currentUser.uid);
    } catch (error) {
      console.error('Failed to load profile for bulk upload', error);
    }

    if (!this.canUseBulkUpload(profile)) {
      this.bulkUploadError.set('Bulk upload is available for Plus and Pro members.');
      return;
    }

    this.isProcessingBulkUpload.set(true);
    this.bulkUploadError.set(null);
    this.bulkUploadSuccess.set(null);
    this.bulkUploadProgress.set(createEmptyBulkProgress());

    try {
      const text = await file.text();
      const rows = parseCsv(text);

      if (rows.length === 0) {
        throw new Error('CSV file is empty or invalid.');
      }

      const headerRow = rows[0].map(header => header?.trim() ?? '');
      const normalizedHeaders = headerRow.map(header => header.toLowerCase());
      const requiredHeaders = ['title', 'content', 'tag'];
      const missingHeaders = requiredHeaders.filter(h => !normalizedHeaders.includes(h));

      if (missingHeaders.length > 0) {
        throw new Error(`Missing required columns: ${missingHeaders.join(', ')}. Required columns are: title, content, tag. Optional columns: customUrl, views, likes, launchGpt, launchGemini, launchClaude, launchGrok, copied, isInvisible`);
      }

      const dataRows = rows.slice(1);
      this.bulkUploadProgress.set({ processed: 0, total: dataRows.length, success: 0, failed: 0 });

      let successCount = 0;
      let failedCount = 0;
      const errors: string[] = [];

      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        if (row.every(cell => !cell?.trim())) {
          // Skip completely empty rows but still advance progress
          this.bulkUploadProgress.set({
            processed: Math.min(i + 1, dataRows.length),
            total: dataRows.length,
            success: successCount,
            failed: failedCount
          });
          continue;
        }

        const rowData: Record<string, string> = {};
        headerRow.forEach((header, index) => {
          const key = header.toLowerCase();
          if (key) {
            rowData[key] = row[index]?.trim() || '';
          }
        });

        try {
          const title = rowData['title'];
          const content = rowData['content'];
          const tag = rowData['tag'];
          const customUrl = rowData['customurl'] || rowData['custom_url'] || '';
          const views = parseCsvNumber(rowData['views'], 0);
          const likes = parseCsvNumber(rowData['likes'], 0);
          const launchGpt = parseCsvNumber(rowData['launchgpt'] || rowData['launch_gpt'], 0);
          const launchGemini = parseCsvNumber(rowData['launchgemini'] || rowData['launch_gemini'], 0);
          const launchClaude = parseCsvNumber(rowData['launchclaude'] || rowData['launch_claude'], 0);
          const launchGrok = parseCsvNumber(rowData['launchgrok'] || rowData['launch_grok'], 0);
          const copied = parseCsvNumber(rowData['copied'], 0);
          const isInvisible = parseCsvBoolean(rowData['isinvisible'] || rowData['is_invisible'], false);

          if (!title || !content || !tag) {
            throw new Error(`Row ${i + 2}: Missing required fields (title, content, or tag)`);
          }

          const promptId = await this.promptService.createPrompt({
            authorId: currentUser.uid,
            title,
            content,
            tag,
            customUrl: customUrl || undefined,
            views,
            likes,
            launchGpt,
            launchGemini,
            launchClaude,
            launchGrok,
            copied
          });

          if (isInvisible) {
            await this.promptService.bulkToggleVisibility([promptId], true);
          }

          successCount++;
        } catch (error) {
          failedCount++;
          const message = error instanceof Error ? error.message : 'Unknown error';
          errors.push(`Row ${i + 2}: ${message}`);
        }

        this.bulkUploadProgress.set({
          processed: Math.min(i + 1, dataRows.length),
          total: dataRows.length,
          success: successCount,
          failed: failedCount
        });
      }

      if (failedCount > 0) {
        this.bulkUploadError.set(
          `Upload completed with ${failedCount} error(s). ${successCount} prompt(s) created successfully. Errors: ${errors.slice(0, 5).join('; ')}${errors.length > 5 ? ` (and ${errors.length - 5} more)` : ''}`
        );
        if (successCount > 0) {
          this.bulkUploadSuccess.set(`${successCount} prompt${successCount === 1 ? '' : 's'} created successfully before errors.`);
        }
      } else {
        this.bulkUploadError.set(null);
        const successMessage =
          successCount > 0
            ? `${successCount} prompt${successCount === 1 ? '' : 's'} uploaded successfully.`
            : 'No prompts were created from this CSV.';
        this.bulkUploadSuccess.set(successMessage);
      }
    } catch (error) {
      console.error('Failed to process CSV upload', error);
      this.bulkUploadError.set(error instanceof Error ? error.message : 'Failed to process CSV file.');
    } finally {
      this.isProcessingBulkUpload.set(false);
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

  private resetBulkUploadState() {
    this.isProcessingBulkUpload.set(false);
    this.bulkUploadProgress.set(createEmptyBulkProgress());
    this.bulkUploadError.set(null);
    this.bulkUploadSuccess.set(null);
  }

  private observePrompts() {
    this.promptService
      .promptsWithPagination$()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ prompts, lastDoc }) => {
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
          
          // Store the last document for pagination (from snapshot, before filtering)
          this.lastPromptDoc = lastDoc;
          // If we got a lastDoc, there might be more prompts (even if filtered count is less than 50)
          // We check if lastDoc exists and if we got close to 50 documents from the query
          this.hasMorePrompts.set(lastDoc !== null);
          
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

  private setupScrollListener() {
    if (typeof window === 'undefined') {
      return;
    }

    let scrollTimeout: ReturnType<typeof setTimeout> | null = null;
    let isLoading = false;

    const handleScroll = () => {
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }

      scrollTimeout = setTimeout(() => {
        // Check if we're near the bottom of the page
        const scrollPosition = window.innerHeight + window.scrollY;
        const pageHeight = document.documentElement.scrollHeight;
        const threshold = 300; // Load more when 300px from bottom

        const isNearBottom = scrollPosition >= pageHeight - threshold;
        const canLoadMore = !isLoading && 
                           !this.isLoadingMore() && 
                           !this.isLoadingPrompts() && 
                           this.hasMorePrompts() &&
                           this.lastPromptDoc !== null;

        if (isNearBottom && canLoadMore) {
          isLoading = true;
          this.loadMorePrompts().finally(() => {
            isLoading = false;
          });
        }
      }, 150); // Debounce scroll events
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    // Cleanup on destroy
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('scroll', handleScroll);
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }
    });
  }

  async loadMorePrompts() {
    if (this.isLoadingMore() || !this.hasMorePrompts() || !this.lastPromptDoc) {
      return;
    }

    this.isLoadingMore.set(true);

    try {
      const result = await this.promptService.loadMorePrompts(this.lastPromptDoc, 50);
      
      if (result.prompts.length > 0) {
        const newCards = result.prompts.map(prompt => this.mapPromptToCard(prompt));
        const currentCards = this.prompts();
        
        // Append new prompts to existing ones, avoiding duplicates
        const existingIds = new Set(currentCards.map(card => card.id));
        const uniqueNewCards = newCards.filter(card => !existingIds.has(card.id));
        
        if (uniqueNewCards.length > 0) {
          this.prompts.set([...currentCards, ...uniqueNewCards]);
          this.syncCategories(result.prompts);
          this.loadAuthorProfiles(result.prompts);
          this.loadOrganizations(result.prompts);
        }
      }

      this.lastPromptDoc = result.lastDoc;
      this.hasMorePrompts.set(result.hasMore && result.lastDoc !== null);
    } catch (error) {
      console.error('Failed to load more prompts', error);
      // Don't show error to user, just stop trying to load more
      this.hasMorePrompts.set(false);
    } finally {
      this.isLoadingMore.set(false);
    }
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
      imageUrl: prompt.imageUrl,
      preview: this.buildPreview(prompt.content),
      tag,
      tagLabel: this.formatTagLabel(tag),
      customUrl: prompt.customUrl,
      views: prompt.views ?? 0,
      likes: prompt.likes ?? 0,
      launchGpt: prompt.launchGpt ?? 0,
      launchGemini: prompt.launchGemini ?? 0,
      launchClaude: prompt.launchClaude ?? 0,
      launchGrok: prompt.launchGrok ?? 0,
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
    this.removePromptImage();
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
          // Most launched prompt is computed from prompts list, no need to fetch from home content
        },
        error: (error) => {
          console.error('Failed to observe home content', error);
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
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
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

  dismissCheckoutNotice() {
    this.checkoutNotice.set(null);
  }

  private observeCheckoutStatus() {
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(params => {
        const checkout = params.get('checkout');
        if (!checkout) {
          return;
        }

        if (checkout === 'success') {
          const plan = this.normalizePlan(params.get('plan'));
          this.checkoutNotice.set({
            type: 'success',
            plan
          });
        } else if (checkout === 'error') {
          this.checkoutNotice.set({
            type: 'error'
          });
        }

        this.clearCheckoutParams();
      });
  }

  private normalizePlan(plan: string | null): 'plus' | 'team' | undefined {
    if (plan === 'team' || plan === 'plus') {
      return plan;
    }
    return undefined;
  }

  getPlanLabel(plan: 'plus' | 'team' | undefined) {
    if (plan === 'team') {
      return 'Your Pro / Team plan';
    }
    if (plan === 'plus') {
      return 'Your Plus plan';
    }
    return 'Your plan';
  }

  private clearCheckoutParams() {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { checkout: null, plan: null },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
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
