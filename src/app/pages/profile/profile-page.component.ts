import { CommonModule } from '@angular/common';
import { Component, DestroyRef, HostListener, ViewChild, ElementRef, computed, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map, switchMap } from 'rxjs/operators';
import { of, combineLatest, from } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { PromptService } from '../../services/prompt.service';
import { CollectionService } from '../../services/collection.service';
import { OrganizationService } from '../../services/organization.service';
import { NavbarComponent } from '../../components/navbar/navbar.component';
import type { Prompt, CreatePromptInput, UpdatePromptInput } from '../../models/prompt.model';
import type { UserProfile } from '../../models/user-profile.model';
import type { Organization } from '../../models/organization.model';
import type { PromptCollection } from '../../models/collection.model';
import { generateDisplayUsername } from '../../utils/username.util';
import { getSubscriptionDetails, shouldShowUpgradeBanner } from '../../utils/subscription.util';

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
  readonly launchGrok: number;
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
  selector: 'app-profile-page',
  standalone: true,
  imports: [CommonModule, RouterLink, ReactiveFormsModule, NavbarComponent],
  templateUrl: './profile-page.component.html',
  styleUrl: './profile-page.component.css'
})
export class ProfilePageComponent {
  private readonly authService = inject(AuthService);
  private readonly promptService = inject(PromptService);
  private readonly collectionService = inject(CollectionService);
  private readonly organizationService = inject(OrganizationService);
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
  readonly authorProfiles = signal<Map<string, UserProfile>>(new Map());
  readonly organizations = signal<Map<string, Organization>>(new Map());

  readonly searchTerm = signal('');
  readonly collectionsSearchTerm = signal('');
  readonly selectedCategory = signal<PromptCategory['value']>('all');
  readonly activeTab = signal<'prompts' | 'collections'>('prompts');
  readonly isLoadingPrompts = signal(true);
  readonly loadPromptsError = signal<string | null>(null);
  readonly collections = signal<PromptCollection[]>([]);
  readonly isLoadingCollections = signal(false);
  readonly loadCollectionsError = signal<string | null>(null);
  readonly recentlyCopied = signal<Set<string>>(new Set());
  readonly recentlyCopiedUrl = signal<Set<string>>(new Set());
  readonly profileUrlCopied = signal(false);
  readonly newPromptModalOpen = signal(false);
  readonly isEditingPrompt = signal(false);
  readonly editingPromptId = signal<string | null>(null);
  readonly isSavingPrompt = signal(false);
  readonly promptFormError = signal<string | null>(null);
  readonly deleteError = signal<string | null>(null);
  readonly deletingPromptId = signal<string | null>(null);

  // Collection creation
  readonly newCollectionModalOpen = signal(false);
  readonly isSavingCollection = signal(false);
  readonly collectionFormError = signal<string | null>(null);
  readonly collectionCustomUrlError = signal<string | null>(null);
  readonly isCheckingCollectionCustomUrl = signal(false);
  readonly promptSearchTermForCollection = signal('');
  private collectionCustomUrlTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly copyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly copyUrlTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private readonly createPromptDefaults = {
    title: '',
    tag: '',
    customUrl: '',
    content: '',
    isPrivate: false
  } as const;

  readonly createPromptForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(3)]],
    tag: ['', [Validators.required]],
    customUrl: [''],
    content: ['', [Validators.required, Validators.minLength(10)]],
    isPrivate: [false]
  });

  readonly collectionForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(3)]],
    tag: ['', [Validators.required, Validators.minLength(2)]],
    promptIds: this.fb.nonNullable.control<string[]>([], {
      validators: [(control) => {
        const value = control.value;
        if (Array.isArray(value) && value.length > 0) {
          return null;
        }
        return { required: true };
      }]
    }),
    customUrl: [''],
    blurb: ['']
  });

  readonly tagQuery = signal('');
  readonly tagQueryDebounced = signal('');
  private tagQueryTimer: ReturnType<typeof setTimeout> | null = null;

  readonly customUrlError = signal<string | null>(null);
  readonly isCheckingCustomUrl = signal(false);
  private customUrlTimer: ReturnType<typeof setTimeout> | null = null;

  readonly uploadingProfilePicture = signal(false);
  readonly profilePictureError = signal<string | null>(null);
  readonly deletingProfilePicture = signal(false);

  readonly currentUser$ = this.authService.currentUser$;
  readonly viewingUserId = signal<string | null>(null);
  readonly isViewingOwnProfile = computed(() => {
    const currentUser = this.authService.currentUser;
    const viewingId = this.viewingUserId();
    return currentUser && (viewingId === null || viewingId === currentUser.uid);
  });

  // Current logged-in user's profile (for avatar and menu)
  readonly currentUserProfile$ = this.currentUser$.pipe(
    switchMap(user => {
      if (!user) {
        return of<UserProfile | undefined>(undefined);
      }
      return this.authService.userProfile$(user.uid);
    })
  );
  readonly currentUserProfile = signal<UserProfile | null | undefined>(null);

  readonly profile$ = combineLatest([this.route.params, this.route.queryParams]).pipe(
    switchMap(([params, queryParams]) => {
      const username = params['username'];
      const userId = queryParams['userId'];

      if (username) {
        // Viewing profile by username
        return this.authService.userProfileByUsername$(username).pipe(
          switchMap(profile => {
            if (profile) {
              this.viewingUserId.set(profile.userId || profile.id || null);
              return of(profile);
            }
            // If username not found, fall back to own profile
            return this.currentUser$.pipe(
              switchMap(user => {
                if (!user) {
                  return of<UserProfile | undefined>(undefined);
                }
                this.viewingUserId.set(null);
                return this.authService.userProfile$(user.uid);
              })
            );
          })
        );
      }

      if (userId) {
        // Viewing profile by userId - redirect to username URL
        this.viewingUserId.set(userId);
        return this.authService.userProfile$(userId).pipe(
          switchMap(profile => {
            if (profile?.username) {
              // Redirect to username-based URL
              this.router.navigate(['/profile', profile.username], { replaceUrl: true });
              return of(profile);
            }
            // If no username yet, generate it and redirect
            if (profile) {
              return from(this.authService.fetchUserProfile(userId)).pipe(
                switchMap(updatedProfile => {
                  if (updatedProfile?.username) {
                    this.router.navigate(['/profile', updatedProfile.username], { replaceUrl: true });
                    return of(updatedProfile);
                  }
                  return of(profile);
                })
              );
            }
            return of(profile);
          })
        );
      }

      // Viewing own profile
      this.viewingUserId.set(null);
      return this.currentUser$.pipe(
        switchMap(user => {
          if (!user) {
            return of<UserProfile | undefined>(undefined);
          }
          return this.authService.userProfile$(user.uid).pipe(
            switchMap(profile => {
              // Ensure username exists and redirect if needed
              if (profile && !profile.username) {
                return from(this.authService.fetchUserProfile(user.uid)).pipe(
                  switchMap(updatedProfile => {
                    if (updatedProfile?.username) {
                      this.router.navigate(['/profile', updatedProfile.username], { replaceUrl: true });
                    }
                    return of(updatedProfile || profile);
                  })
                );
              }
              return of(profile);
            })
          );
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

  readonly totalLaunches = computed(() => {
    return this.prompts().reduce((sum, prompt) => sum + (prompt.totalLaunch || 0), 0);
  });

  readonly launchBreakdown = computed(() => {
    const prompts = this.prompts();
    const stats = [
      {
        id: 'gpt',
        label: 'ChatGPT',
        subtext: 'OpenAI',
        count: prompts.reduce((sum, prompt) => sum + (prompt.launchGpt || 0), 0),
        icon: 'assets/gpt.png',
        isImage: true,
        bgClass: 'bg-green-50',
        colorClass: 'bg-green-500'
      },
      {
        id: 'gemini',
        label: 'Gemini',
        subtext: 'Google DeepMind',
        count: prompts.reduce((sum, prompt) => sum + (prompt.launchGemini || 0), 0),
        icon: 'assets/gemini.png',
        isImage: true,
        bgClass: 'bg-blue-50',
        colorClass: 'bg-blue-500'
      },
      {
        id: 'claude',
        label: 'Claude',
        subtext: 'Anthropic',
        count: prompts.reduce((sum, prompt) => sum + (prompt.launchClaude || 0), 0),
        icon: 'assets/claude.jpeg',
        isImage: true,
        bgClass: 'bg-orange-50',
        colorClass: 'bg-orange-500'
      },
      {
        id: 'grok',
        label: 'Grok',
        subtext: 'xAI',
        count: prompts.reduce((sum, prompt) => sum + (prompt.launchGrok || 0), 0),
        icon: 'assets/grok.jpg',
        isImage: true,
        bgClass: 'bg-slate-50',
        colorClass: 'bg-slate-900'
      },
      {
        id: 'copied',
        label: 'Copied',
        subtext: 'Clipboard',
        count: prompts.reduce((sum, prompt) => sum + (prompt.copied || 0), 0),
        icon: 'clipboard',
        isImage: false,
        bgClass: 'bg-gray-100',
        colorClass: 'bg-gray-500'
      }
    ];

    return stats.sort((a, b) => b.count - a.count);
  });

  getBarHeight(value: number, max: number): number {
    if (!max || max === 0) return 0;
    // Ensure a minimum visibility for non-zero values
    const percentage = (value / max) * 100;
    return value > 0 ? Math.max(percentage, 2) : 0;
  }

  readonly isModelUsageExpanded = signal(false);

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
    // Subscribe to current user profile and update signal for navbar
    this.currentUserProfile$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(profile => {
        this.currentUserProfile.set(profile ?? null);
      });
    this.observePrompts();
    this.observeCollections();
  }

  selectTab(tab: 'prompts' | 'collections') {
    this.activeTab.set(tab);
  }



  private observeCollections() {
    combineLatest([this.route.params, this.route.queryParams, this.profile$]).pipe(
      switchMap(([params, queryParams, profile]) => {
        if (!profile) {
          this.collections.set([]);
          this.isLoadingCollections.set(false);
          return of<PromptCollection[]>([]);
        }

        const username = params['username'];
        const userId = queryParams['userId'];
        const authorId = profile.userId || profile.id || userId || '';

        if (!authorId) {
          this.collections.set([]);
          this.isLoadingCollections.set(false);
          return of<PromptCollection[]>([]);
        }

        this.isLoadingCollections.set(true);
        this.loadCollectionsError.set(null);

        return this.collectionService.collectionsByAuthor$(authorId);
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: collections => {
        this.collections.set(collections);
        this.isLoadingCollections.set(false);
        this.loadCollectionsError.set(null);
      },
      error: error => {
        console.error('Failed to load collections', error);
        this.isLoadingCollections.set(false);
        this.loadCollectionsError.set('We could not load collections. Please try again.');
      }
    });
  }

  readonly userCollectionCount = computed(() => {
    return this.collections().length;
  });

  readonly filteredCollections = computed(() => {
    const collections = this.collections();
    const term = this.collectionsSearchTerm().trim().toLowerCase();

    if (!term) {
      return collections;
    }

    return collections.filter(collection => {
      const haystack = [
        collection.name,
        collection.tag,
        collection.blurb ?? '',
        collection.customUrl ?? ''
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(term);
    });
  });

  // Available prompts for collection creation (only user's own prompts)
  readonly availablePromptsForCollection = computed(() => {
    const currentUser = this.authService.currentUser;
    if (!currentUser) {
      return [];
    }
    return this.prompts().filter(prompt => {
      // Only include prompts that belong to the current user
      return prompt.authorId === currentUser.uid;
    });
  });

  // Filtered prompts for collection modal search
  readonly filteredPromptsForCollection = computed(() => {
    const term = this.promptSearchTermForCollection().trim().toLowerCase();
    const prompts = this.availablePromptsForCollection();

    if (!term) {
      return prompts;
    }

    return prompts.filter(prompt => {
      const haystack = [prompt.title, prompt.tag, prompt.tagLabel].join(' ').toLowerCase();
      return haystack.includes(term);
    });
  });

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


  selectCategory(category: PromptCategory['value']) {
    this.selectedCategory.set(category);
  }

  onSearch(term: string) {
    this.searchTerm.set(term);
  }

  onCollectionsSearch(term: string) {
    this.collectionsSearchTerm.set(term);
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

  getDisplayUsername(profile: UserProfile | undefined): string {
    if (!profile) {
      return 'User';
    }

    // Use stored username if available, otherwise generate it
    if (profile.username) {
      return profile.username;
    }

    const userId = profile.userId || profile.id || '';
    return generateDisplayUsername(profile.firstName, profile.lastName, userId);
  }

  getProfileUrl(profile: UserProfile | undefined): string {
    if (!profile) {
      return '';
    }

    const username = profile.username || this.getDisplayUsername(profile);
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/profile/${username}`;
  }

  async copyProfileUrl(profile: UserProfile | undefined) {
    if (!profile) return;

    const url = this.getProfileUrl(profile);

    try {
      await navigator.clipboard.writeText(url);
      this.showCopyMessage('Profile URL copied!');
      this.markProfileUrlAsCopied();
    } catch (e) {
      this.fallbackCopyTextToClipboard(url);
      this.showCopyMessage('Profile URL copied!');
      this.markProfileUrlAsCopied();
    }
  }

  private markProfileUrlAsCopied() {
    this.profileUrlCopied.set(true);

    const DURATION = 2500;

    setTimeout(() => {
      this.profileUrlCopied.set(false);
    }, DURATION);
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

  navigateToCurrentUserProfile(currentUserProfile: UserProfile) {
    if (currentUserProfile?.username) {
      void this.router.navigate(['/profile', currentUserProfile.username]);
    } else {
      void this.router.navigate(['/profile']);
    }
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

  redirectToPricing() {
    void this.router.navigate(['/pricing']);
  }

  navigateToCollection(collection: PromptCollection) {
    if (!collection?.id) {
      return;
    }

    if (collection.customUrl) {
      void this.router.navigate(['/collection', collection.customUrl]);
    } else {
      void this.router.navigate(['/collections', collection.id]);
    }
  }

  openCreateCollectionModal() {
    if (!this.isViewingOwnProfile()) {
      return;
    }

    const currentUser = this.authService.currentUser;
    if (!currentUser) {
      return;
    }

    this.collectionForm.reset({
      name: '',
      tag: '',
      promptIds: [],
      customUrl: '',
      blurb: ''
    });
    this.collectionForm.markAsPristine();
    this.collectionForm.markAsUntouched();
    this.collectionFormError.set(null);
    this.collectionCustomUrlError.set(null);
    this.clearCollectionCustomUrlDebounce();
    this.promptSearchTermForCollection.set('');
    this.newCollectionModalOpen.set(true);
  }

  closeCreateCollectionModal() {
    if (this.isSavingCollection()) {
      return;
    }

    this.newCollectionModalOpen.set(false);
    this.collectionFormError.set(null);
    this.collectionCustomUrlError.set(null);
    this.clearCollectionCustomUrlDebounce();
    this.collectionForm.markAsPristine();
    this.collectionForm.markAsUntouched();
  }

  togglePromptSelectionForCollection(promptId: string) {
    const control = this.collectionForm.controls.promptIds;
    const current = new Set(control.value ?? []);

    if (current.has(promptId)) {
      current.delete(promptId);
    } else {
      current.add(promptId);
    }

    control.setValue(Array.from(current));
    control.markAsDirty();
    control.markAsTouched();
  }

  isPromptSelectedForCollection(promptId: string): boolean {
    return this.collectionForm.controls.promptIds.value.includes(promptId);
  }

  onCollectionCustomUrlInput(value: string) {
    const trimmed = String(value ?? '').trim();
    this.collectionForm.controls.customUrl.setValue(trimmed, { emitEvent: false });

    if (this.collectionCustomUrlTimer) {
      clearTimeout(this.collectionCustomUrlTimer);
    }

    if (!trimmed) {
      this.collectionCustomUrlError.set(null);
      this.isCheckingCollectionCustomUrl.set(false);
      return;
    }

    const urlPattern = /^[a-z0-9-]+$/i;
    if (!urlPattern.test(trimmed)) {
      this.collectionCustomUrlError.set('Custom URL can only contain letters, numbers, and hyphens.');
      this.isCheckingCollectionCustomUrl.set(false);
      return;
    }

    const reservedPaths = ['home', 'auth', 'prompt', 'prompts', 'collections', 'collection', 'admin', 'verify-email', 'community-guidelines', 'profile'];
    if (reservedPaths.includes(trimmed.toLowerCase())) {
      this.collectionCustomUrlError.set('This URL is reserved. Please choose a different one.');
      this.isCheckingCollectionCustomUrl.set(false);
      return;
    }

    this.isCheckingCollectionCustomUrl.set(true);
    this.collectionCustomUrlError.set(null);

    this.collectionCustomUrlTimer = setTimeout(async () => {
      try {
        const isTaken = await this.collectionService.isCustomUrlTaken(trimmed);
        if (isTaken) {
          this.collectionCustomUrlError.set('This custom URL is already taken. Please choose a different one.');
        } else {
          this.collectionCustomUrlError.set(null);
        }
      } catch (error) {
        console.error('Failed to check custom URL', error);
        this.collectionCustomUrlError.set('Unable to verify custom URL availability. Please try again.');
      } finally {
        this.isCheckingCollectionCustomUrl.set(false);
      }
    }, 500);
  }

  private clearCollectionCustomUrlDebounce() {
    if (this.collectionCustomUrlTimer) {
      clearTimeout(this.collectionCustomUrlTimer);
      this.collectionCustomUrlTimer = null;
    }
  }

  async submitCollectionForm() {
    if (this.collectionForm.invalid || this.collectionCustomUrlError()) {
      this.collectionForm.markAllAsTouched();
      return;
    }

    const { name, tag, promptIds, customUrl, blurb } = this.collectionForm.getRawValue();
    const currentUser = this.authService.currentUser;
    const authorId = currentUser?.uid;

    if (!authorId) {
      this.collectionFormError.set('You must be signed in to create a collection.');
      return;
    }

    this.isSavingCollection.set(true);
    this.collectionFormError.set(null);

    try {
      await this.collectionService.createCollection({
        name,
        tag,
        promptIds,
        customUrl: customUrl?.trim() || undefined,
        blurb: blurb?.trim() || undefined
      }, authorId);

      this.newCollectionModalOpen.set(false);
      this.collectionForm.reset({
        name: '',
        tag: '',
        promptIds: [],
        customUrl: '',
        blurb: ''
      });
      this.collectionForm.markAsPristine();
      this.collectionForm.markAsUntouched();
      this.collectionCustomUrlError.set(null);
      this.clearCollectionCustomUrlDebounce();
    } catch (error) {
      console.error('Failed to create collection', error);
      this.collectionFormError.set(
        error instanceof Error ? error.message : 'Could not create the collection. Please try again.'
      );
    } finally {
      this.isSavingCollection.set(false);
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


  canEditPrompt(prompt: PromptCard): boolean {
    const currentUser = this.authService.currentUser;
    if (!currentUser) {
      return false;
    }
    return !prompt.authorId || prompt.authorId === currentUser.uid;
  }

  openCreatePromptModal() {
    this.isEditingPrompt.set(false);
    this.editingPromptId.set(null);
    this.promptFormError.set(null);
    this.customUrlError.set(null);
    this.clearCustomUrlDebounce();
    this.resetCreatePromptForm();
    this.tagQuery.set('');
    this.newPromptModalOpen.set(true);
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

    const { title, tag, customUrl, content, isPrivate } = this.createPromptForm.getRawValue();
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
        throw new Error('You must be signed in to create or update a prompt.');
      }

      // Check if the user can manage private prompts (admins or Pro/Plus subscribers)
      const profile = await this.authService.fetchUserProfile(currentUser.uid);
      const canSetPrivate = this.canManagePrivatePrompts(profile);

      if (this.isEditingPrompt() && this.editingPromptId()) {
        const updateInput: UpdatePromptInput = {
          title,
          content,
          tag,
          customUrl: trimmedCustomUrl,
          ...(canSetPrivate && typeof isPrivate === 'boolean' ? { isPrivate } : {})
        };
        await this.promptService.updatePrompt(this.editingPromptId()!, updateInput, currentUser.uid);
      } else {
        // Creating a new prompt
        const createInput: CreatePromptInput = {
          authorId: currentUser.uid,
          title,
          content,
          tag,
          customUrl: trimmedCustomUrl || undefined,
          ...(canSetPrivate && typeof isPrivate === 'boolean' ? { isPrivate } : {})
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

    if (this.newCollectionModalOpen()) {
      this.closeCreateCollectionModal();
      return;
    }

    // Menu handling moved to NavbarComponent
  }

  private observePrompts() {
    combineLatest([this.route.params, this.route.queryParams]).pipe(
      switchMap(([params, queryParams]) => {
        const username = params['username'];
        const userId = queryParams['userId'];

        if (username) {
          // Viewing profile by username - find user first
          return this.authService.userProfileByUsername$(username).pipe(
            switchMap(profile => {
              if (profile && profile.userId) {
                // Pass currentUserId to show private prompts if viewing own profile
                return this.currentUser$.pipe(
                  switchMap(currentUser => {
                    const currentUserId = currentUser?.uid;
                    return this.promptService.promptsByAuthor$(profile.userId, currentUserId);
                  })
                );
              }
              // If username not found, show own prompts
              return this.currentUser$.pipe(
                switchMap(user => {
                  if (!user) {
                    this.isLoadingPrompts.set(false);
                    return of<Prompt[]>([]);
                  }
                  return this.promptService.promptsByAuthor$(user.uid, user.uid);
                })
              );
            })
          );
        }

        if (userId) {
          // Viewing profile by userId (backward compatibility)
          // Pass currentUserId to show private prompts if viewing own profile
          return this.currentUser$.pipe(
            switchMap(currentUser => {
              const currentUserId = currentUser?.uid;
              return this.promptService.promptsByAuthor$(userId, currentUserId);
            })
          );
        }

        // Viewing own profile - show own prompts
        return this.currentUser$.pipe(
          switchMap(user => {
            if (!user) {
              this.isLoadingPrompts.set(false);
              return of<Prompt[]>([]);
            }
            return this.promptService.promptsByAuthor$(user.uid, user.uid);
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

  async onProfilePictureSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    const currentUser = this.authService.currentUser;
    if (!currentUser) {
      this.profilePictureError.set('You must be signed in to upload a profile picture.');
      return;
    }

    this.uploadingProfilePicture.set(true);
    this.profilePictureError.set(null);

    try {
      await this.authService.uploadProfilePicture(currentUser.uid, file);
      // The profile$ observable will automatically update when Firestore changes
    } catch (error) {
      console.error('Failed to upload profile picture', error);
      this.profilePictureError.set(
        error instanceof Error ? error.message : 'Failed to upload profile picture. Please try again.'
      );
    } finally {
      this.uploadingProfilePicture.set(false);
      // Reset the input
      input.value = '';
    }
  }

  async deleteProfilePicture() {
    const currentUser = this.authService.currentUser;
    if (!currentUser) {
      this.profilePictureError.set('You must be signed in to delete a profile picture.');
      return;
    }

    const confirmed = window.confirm('Are you sure you want to remove your profile picture?');
    if (!confirmed) {
      return;
    }

    this.deletingProfilePicture.set(true);
    this.profilePictureError.set(null);

    try {
      await this.authService.deleteProfilePicture(currentUser.uid);
      // The profile$ observable will automatically update when Firestore changes
    } catch (error) {
      console.error('Failed to delete profile picture', error);
      this.profilePictureError.set(
        error instanceof Error ? error.message : 'Failed to delete profile picture. Please try again.'
      );
    } finally {
      this.deletingProfilePicture.set(false);
    }
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

  subscriptionDetails(status?: string | null) {
    return getSubscriptionDetails(status);
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
