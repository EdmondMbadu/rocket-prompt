import { CommonModule } from '@angular/common';
import { Component, DestroyRef, HostListener, ViewChild, ElementRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map, distinctUntilChanged, switchMap, combineLatest, catchError } from 'rxjs/operators';
import { of, combineLatest as rxjsCombineLatest, from, firstValueFrom } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { CollectionService } from '../../services/collection.service';
import { PromptService } from '../../services/prompt.service';
import { OrganizationService } from '../../services/organization.service';
import type { PromptCollection } from '../../models/collection.model';
import type { Prompt } from '../../models/prompt.model';
import type { UserProfile } from '../../models/user-profile.model';
import type { Organization } from '../../models/organization.model';
import type { PromptCard } from '../../models/prompt-card.model';
import { PromptCardComponent } from '../../components/prompt-card/prompt-card.component';

interface PromptOption {
  readonly id: string;
  readonly title: string;
  readonly tag: string;
  readonly tagLabel: string;
}

@Component({
  selector: 'app-collection-detail',
  standalone: true,
  imports: [CommonModule, PromptCardComponent],
  templateUrl: './collection-detail.component.html',
  styleUrl: './collection-detail.component.css'
})
export class CollectionDetailComponent {
  private readonly authService = inject(AuthService);
  private readonly collectionService = inject(CollectionService);
  private readonly promptService = inject(PromptService);
  private readonly organizationService = inject(OrganizationService);
  readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly currentUser$ = this.authService.currentUser$;
  readonly profile = signal<UserProfile | null>(null);
  readonly profileLoaded = signal(false);

  readonly searchTerm = signal('');
  readonly collection = signal<PromptCollection | null>(null);
  readonly collectionTagLabel = signal('');
  readonly isLoadingCollection = signal(true);
  readonly collectionNotFound = signal(false);
  readonly prompts = signal<PromptCard[]>([]);
  readonly authorProfiles = signal<Map<string, UserProfile>>(new Map());
  readonly organizations = signal<Map<string, Organization>>(new Map());
  readonly isLoadingPrompts = signal(true);
  readonly loadPromptsError = signal<string | null>(null);
  readonly recentlyCopied = signal<Set<string>>(new Set());
  readonly menuOpen = signal(false);
  readonly menuTop = signal<number | null>(null);
  readonly menuRight = signal<number | null>(null);
  @ViewChild('avatarButton') avatarButtonRef?: ElementRef<HTMLButtonElement>;
  readonly bookmarked = signal(false);
  readonly bookmarking = signal(false);
  readonly clientId = signal('');
  readonly copiedPromptUrl = signal<Set<string>>(new Set());
  readonly editModalOpen = signal(false);
  readonly editModalTab = signal<'remove' | 'add' | 'settings'>('remove');
  readonly selectedPromptsToRemove = signal<Set<string>>(new Set());
  readonly selectedPromptsToAdd = signal<Set<string>>(new Set());
  readonly isUpdatingCollection = signal(false);
  readonly updateCollectionError = signal<string | null>(null);
  readonly availablePromptsForAdd = signal<PromptOption[]>([]);
  readonly isLoadingAvailablePrompts = signal(true);
  readonly loadAvailablePromptsError = signal<string | null>(null);
  readonly promptAddSearchTerm = signal('');
  readonly uploadingImage = signal(false);
  readonly deletingImage = signal(false);
  readonly imageUploadError = signal<string | null>(null);
  readonly editCollectionName = signal('');
  readonly editCollectionTag = signal('');
  readonly editCollectionCustomUrl = signal('');
  readonly editCollectionBlurb = signal('');
  readonly editCustomUrlError = signal<string | null>(null);
  readonly isCheckingCustomUrl = signal(false);
  private customUrlTimer: ReturnType<typeof setTimeout> | null = null;
  readonly uploadingBrandLogo = signal(false);
  readonly deletingBrandLogo = signal(false);
  readonly brandLogoUploadError = signal<string | null>(null);
  readonly editBrandLink = signal('');
  readonly editBrandSubtext = signal('');
  readonly brandingSectionExpanded = signal(false);
  
  readonly brandSubtextWordCount = computed(() => {
    const text = this.editBrandSubtext().trim();
    if (!text) return 0;
    return text.split(/\s+/).filter(word => word.length > 0).length;
  });

  readonly actorId = computed(() => {
    const user = this.authService.currentUser;
    if (user?.uid) {
      return `u_${user.uid}`;
    }

    const cid = this.clientId();
    return cid ? `c_${cid}` : '';
  });

  // Check if user is logged in
  readonly isLoggedIn = computed(() => {
    return !!this.profile();
  });

  // Organization membership check
  readonly organization = signal<any>(null);
  readonly isOrganizationMember = signal(false);

  // Check if current user is the author of the collection
  readonly isAuthor = computed(() => {
    const collection = this.collection();
    const currentUser = this.authService.currentUser;
    if (!collection || !currentUser) {
      return false;
    }
    return collection.authorId === currentUser.uid;
  });

  readonly canEdit = computed(() => {
    return this.isAuthor() || this.isOrganizationMember();
  });
  
  readonly canDelete = computed(() => {
    return this.isAuthor() || this.isOrganizationMember();
  });

  private readonly copyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly promptUrlCopyTimers = new Map<string, ReturnType<typeof setTimeout>>();

  readonly collectionPrompts = computed(() => {
    const collection = this.collection();
    if (!collection) {
      return [] as PromptCard[];
    }

    const ids = new Set(collection.promptIds ?? []);
    return this.prompts().filter(prompt => ids.has(prompt.id));
  });

  readonly promptCount = computed(() => {
    const collection = this.collection();
    if (!collection) {
      return 0;
    }
    // Always calculate from the current promptIds array to ensure accuracy
    const promptIds = collection.promptIds ?? [];
    return Array.isArray(promptIds) ? promptIds.length : 0;
  });

  readonly filteredPrompts = computed(() => {
    const prompts = this.collectionPrompts();
    const term = this.searchTerm().trim().toLowerCase();

    if (!term) {
      return prompts;
    }

    return prompts.filter(prompt => {
      const haystack = [prompt.title, prompt.content, prompt.tag, prompt.customUrl ?? '']
        .join(' ')
        .toLowerCase();

      return haystack.includes(term);
    });
  });

  constructor() {
    this.ensureClientId();
    this.observeCollection();
    this.observePrompts();
    this.observeAvailablePrompts();

    this.currentUser$
      .pipe(
        switchMap(user => {
          if (!user) {
            return of<UserProfile | null>(null);
          }

          return this.authService.userProfile$(user.uid);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(profile => {
        this.profile.set(profile ?? null);
        this.profileLoaded.set(true);

        if (!profile) {
          this.menuOpen.set(false);
        }

        const current = this.collection();
        if (current) {
          void this.updateBookmarkedState(current.id);
        } else {
          this.bookmarked.set(false);
        }
      });
  }

  profileInitials(profile: UserProfile | null | undefined) {
    if (!profile) {
      return 'RP';
    }

    const firstInitial = profile.firstName?.charAt(0)?.toUpperCase() ?? '';
    const lastInitial = profile.lastName?.charAt(0)?.toUpperCase() ?? '';
    const initials = `${firstInitial}${lastInitial}`.trim();

    return initials || (profile.email?.charAt(0)?.toUpperCase() ?? 'R');
  }

  toggleMenu() {
    if (!this.profile()) {
      return;
    }

    if (this.editModalOpen()) {
      return;
    }

    const isOpening = !this.menuOpen();
    this.menuOpen.update(open => !open);
    
    if (isOpening) {
      // Use setTimeout to ensure ViewChild is available and DOM is updated
      setTimeout(() => {
        this.updateMenuPosition();
      }, 0);
    }
  }

  private updateMenuPosition() {
    if (!this.avatarButtonRef?.nativeElement) {
      return;
    }

    const button = this.avatarButtonRef.nativeElement;
    const rect = button.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const isMobile = viewportWidth < 640;
    
    if (isMobile) {
      // On mobile, position below the button with some spacing
      // Ensure it doesn't go off screen at the bottom
      const menuHeight = 250; // Approximate menu height (increased for safety)
      const spacing = 12;
      let topPosition = rect.bottom + spacing;
      
      // If menu would go off screen, position it above the button instead
      if (topPosition + menuHeight > viewportHeight - 16) {
        topPosition = rect.top - menuHeight - spacing;
        // Ensure it doesn't go off screen at the top either
        if (topPosition < 16) {
          topPosition = 16;
        }
      }
      
      // Ensure menu is always visible and not cut off
      this.menuTop.set(Math.max(16, Math.min(topPosition, viewportHeight - menuHeight - 16)));
      // On mobile, align to right with some margin
      this.menuRight.set(16);
    } else {
      // Desktop: Position menu below the button with some spacing
      this.menuTop.set(rect.bottom + 12);
      // Align right edge of menu with right edge of button
      this.menuRight.set(Math.max(16, viewportWidth - rect.right));
    }
  }

  closeMenu() {
    this.menuOpen.set(false);
  }

  async signOut() {
    if (!this.profile()) {
      await this.router.navigate(['/auth'], {
        queryParams: { redirectTo: this.router.url }
      });
      return;
    }

    this.closeMenu();
    await this.authService.signOut();
    await this.router.navigate(['/']);
  }

  onSearch(value: string) {
    this.searchTerm.set(value);
  }

  clearSearch() {
    this.searchTerm.set('');
  }

  async copyPrompt(prompt: PromptCard) {
    if (!prompt) {
      return;
    }

    try {
      await navigator.clipboard.writeText(prompt.content ?? '');
      this.showCopyMessage('Prompt copied!');
      this.markPromptAsCopied(prompt.id);
    } catch (error) {
      this.fallbackCopyTextToClipboard(prompt.content ?? '');
      this.showCopyMessage('Prompt copied!');
      this.markPromptAsCopied(prompt.id);
    }
  }

  openPrompt(prompt: PromptCard) {
    if (prompt.customUrl) {
      void this.router.navigate([`/${prompt.customUrl}`]);
    } else {
      const short = (prompt?.id ?? '').slice(0, 8);
      if (!short) {
        return;
      }
      void this.router.navigate(['/prompt', short]);
    }
  }

  backToCollections() {
    void this.router.navigate(['/collections']);
  }

  trackPromptById(_: number, prompt: PromptCard | PromptOption | { id: string }) {
    return prompt.id;
  }

  getPromptUrl(prompt: PromptCard): string {
    if (!prompt) return '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    if (prompt.customUrl) {
      return `${origin}/${prompt.customUrl}`;
    } else {
      const short = prompt.id ? prompt.id.slice(0, 8) : '';
      return `${origin}/prompt/${short}`;
    }
  }

  fullPath(prompt: PromptCard): string {
    if (!prompt) return '';
    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'rocketprompt.io';
    if (prompt.customUrl) {
      return `${hostname}/${prompt.customUrl}`;
    } else {
      const short = prompt.id ? prompt.id.slice(0, 8) : '';
      return `${hostname}/prompt/${short}`;
    }
  }

  copyPromptPageUrl(prompt: PromptCard) {
    if (!prompt) return;

    const url = this.getPromptUrl(prompt);

    navigator.clipboard.writeText(url).then(() => {
      this.showCopyMessage('Prompt URL copied!');
      this.markPromptUrlAsCopied(prompt.id);
    }).catch(() => {
      this.fallbackCopyTextToClipboard(url);
      this.showCopyMessage('Prompt URL copied!');
      this.markPromptUrlAsCopied(prompt.id);
    });
  }

  isPromptUrlCopied(promptId: string): boolean {
    return this.copiedPromptUrl().has(promptId);
  }

  private markPromptUrlAsCopied(id: string) {
    if (!id) {
      return;
    }

    this.copiedPromptUrl.update(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

    const existing = this.promptUrlCopyTimers.get(id);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.copiedPromptUrl.update(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      this.promptUrlCopyTimers.delete(id);
    }, 2500);

    this.promptUrlCopyTimers.set(id, timer);
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

  @HostListener('document:keydown.escape')
  handleEscape() {
    if (this.editModalOpen()) {
      this.closeEditModal();
      return;
    }
    if (this.menuOpen()) {
      this.closeMenu();
    }
  }

  private observeCollection() {
    this.route.paramMap
      .pipe(
        map(params => {
          // Support both 'id' (for /collections/:id) and 'customUrl' (for /collection/:customUrl) route parameters
          return params.get('id') ?? params.get('customUrl') ?? '';
        }),
        distinctUntilChanged(),
        switchMap(identifier => {
          if (!identifier) {
            this.collection.set(null);
            this.collectionTagLabel.set('');
            this.collectionNotFound.set(true);
            this.isLoadingCollection.set(false);
            return of<PromptCollection | null>(null);
          }

          this.isLoadingCollection.set(true);
          this.collectionNotFound.set(false);

          // Check if this is a customUrl route (from /collection/:customUrl)
          const isCustomUrlRoute = this.route.snapshot.url[0]?.path === 'collection';
          
          if (isCustomUrlRoute) {
            // Load by custom URL
            return from(this.collectionService.getCollectionByCustomUrl(identifier)).pipe(
              map(collection => {
                if (!collection) {
                  this.collectionNotFound.set(true);
                  this.bookmarked.set(false);
                  return null;
                }

                this.collectionNotFound.set(false);
                return collection;
              }),
              catchError(() => {
                this.collectionNotFound.set(true);
                this.bookmarked.set(false);
                return of<PromptCollection | null>(null);
              })
            );
          } else {
            // Load by ID (existing behavior)
            return this.collectionService.collection$(identifier).pipe(
              map(collection => {
                if (!collection) {
                  this.collectionNotFound.set(true);
                  this.bookmarked.set(false);
                  return null;
                }

                this.collectionNotFound.set(false);
                return collection;
              })
            );
          }
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: async collection => {
          if (collection) {
            this.collection.set(collection);
            this.collectionTagLabel.set(this.formatTagLabel(collection.tag ?? 'general'));
            void this.updateBookmarkedState(collection.id);
            
            // Check organization membership if collection belongs to an organization
            if (collection.organizationId) {
              try {
                const org = await firstValueFrom(this.organizationService.organization$(collection.organizationId));
                this.organization.set(org);
                if (org) {
                  const currentUser = this.authService.currentUser;
                  if (currentUser) {
                    const isMember = org.createdBy === currentUser.uid || org.members.includes(currentUser.uid);
                    this.isOrganizationMember.set(isMember);
                  } else {
                    this.isOrganizationMember.set(false);
                  }
                } else {
                  this.isOrganizationMember.set(false);
                }
              } catch (error) {
                console.error('Failed to check organization membership', error);
                this.isOrganizationMember.set(false);
              }
            } else {
              this.organization.set(null);
              this.isOrganizationMember.set(false);
            }
          } else {
            this.collection.set(null);
            this.collectionTagLabel.set('');
            this.bookmarked.set(false);
            this.organization.set(null);
            this.isOrganizationMember.set(false);
          }

          this.isLoadingCollection.set(false);
        },
        error: error => {
          console.error('Failed to load collection', error);
          this.collection.set(null);
          this.collectionTagLabel.set('');
          this.collectionNotFound.set(true);
          this.isLoadingCollection.set(false);
          this.bookmarked.set(false);
        }
      });
  }

  private observePrompts() {
    this.promptService
      .prompts$()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: prompts => {
          const cards = prompts.map(prompt => this.mapPromptToCard(prompt));
          this.loadAuthorProfiles(prompts);
          this.loadOrganizations(prompts);
          this.prompts.set(cards);
          this.isLoadingPrompts.set(false);
          this.loadPromptsError.set(null);
        },
        error: error => {
          console.error('Failed to load prompts', error);
          this.isLoadingPrompts.set(false);
          this.loadPromptsError.set('We could not load prompts for this collection.');
        }
      });
  }

  private observeAvailablePrompts() {
    rxjsCombineLatest([
      this.promptService.prompts$(),
      this.route.paramMap.pipe(
        map(params => params.get('id')),
        distinctUntilChanged(),
        switchMap(id => {
          if (!id) {
            return of<PromptCollection | null>(null);
          }
          return this.collectionService.collection$(id);
        })
      )
    ])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ([prompts, collection]) => {
          const collectionPromptIds = new Set(collection?.promptIds ?? []);
          
          // Filter out prompts that are already in the collection
          const available = prompts
            .filter(prompt => !collectionPromptIds.has(prompt.id))
            .map(prompt => this.mapPromptToOption(prompt));
          
          this.availablePromptsForAdd.set(available);
          this.isLoadingAvailablePrompts.set(false);
          this.loadAvailablePromptsError.set(null);
        },
        error: error => {
          console.error('Failed to load available prompts', error);
          this.isLoadingAvailablePrompts.set(false);
          this.loadAvailablePromptsError.set('We could not load available prompts.');
        }
      });
  }

  private mapPromptToOption(prompt: Prompt): PromptOption {
    const tag = prompt.tag || 'general';
    return {
      id: prompt.id,
      title: prompt.title,
      tag,
      tagLabel: this.formatTagLabel(tag)
    };
  }

  getAuthorProfile(authorId: string): UserProfile | undefined {
    return this.authorProfiles().get(authorId);
  }

  getAuthorInitials(authorId: string): string {
    const profile = this.getAuthorProfile(authorId);
    if (!profile) {
      return 'RP';
    }
    const firstInitial = profile.firstName?.charAt(0)?.toUpperCase() ?? '';
    const lastInitial = profile.lastName?.charAt(0)?.toUpperCase() ?? '';
    const initials = `${firstInitial}${lastInitial}`.trim();
    return initials || (profile.email?.charAt(0)?.toUpperCase() ?? 'R');
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
      views: prompt.views || 0,
      likes: prompt.likes || 0,
      launchGpt: prompt.launchGpt || 0,
      launchGemini: prompt.launchGemini || 0,
      launchClaude: prompt.launchClaude || 0,
      launchGrok: prompt.launchGrok || 0,
      copied: prompt.copied || 0,
      totalLaunch: prompt.totalLaunch || 0,
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

  private markPromptAsCopied(id: string) {
    if (!id) {
      return;
    }

    this.recentlyCopied.update(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

    const existing = this.copyTimers.get(id);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.recentlyCopied.update(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      this.copyTimers.delete(id);
    }, 2500);

    this.copyTimers.set(id, timer);
  }

  navigateToSignUp() {
    this.router.navigate(['/auth'], { queryParams: { mode: 'signup' } });
  }

  goToAuth(mode: 'login' | 'signup' = 'login') {
    const redirect = this.router.url || '/collections';
    void this.router.navigate(['/auth'], {
      queryParams: {
        mode: mode === 'signup' ? 'signup' : 'login',
        redirectTo: redirect
      }
    });
  }

  async toggleBookmark(event?: Event) {
    event?.stopPropagation();

    const collection = this.collection();
    if (!collection || !collection.id) {
      return;
    }

    if (this.bookmarking()) {
      return;
    }

    const actor = this.actorId();
    if (!actor) {
      return;
    }

    this.bookmarking.set(true);

    try {
      const result = await this.collectionService.toggleBookmark(collection.id, actor);
      this.bookmarked.set(result.bookmarked);
      this.collection.set({ ...collection, bookmarkCount: result.bookmarkCount });
    } catch (error) {
      console.error('Failed to toggle collection bookmark', error);
    } finally {
      this.bookmarking.set(false);
    }
  }

  private ensureClientId() {
    try {
      const key = 'rp_client_id';
      let id = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;

      if (!id) {
        id = `c_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
        try {
          window.localStorage.setItem(key, id);
        } catch {
          // ignore storage write failures
        }
      }

      this.clientId.set(id ?? '');
    } catch (error) {
      console.error('Failed to resolve client id', error);
      this.clientId.set('');
    }
  }

  private async updateBookmarkedState(collectionId: string | undefined) {
    const trimmedId = collectionId?.trim();

    if (!trimmedId) {
      this.bookmarked.set(false);
      return;
    }

    const actor = this.actorId();

    if (!actor) {
      this.bookmarked.set(false);
      return;
    }

    try {
      const has = await this.collectionService.hasBookmarked(trimmedId, actor);
      this.bookmarked.set(has);
    } catch (error) {
      console.error('Failed to determine collection bookmarked state', error);
      this.bookmarked.set(false);
    }
  }

  openEditModal() {
    const collection = this.collection();
    this.editModalOpen.set(true);
    this.editModalTab.set('remove');
    this.selectedPromptsToRemove.set(new Set());
    this.selectedPromptsToAdd.set(new Set());
    this.updateCollectionError.set(null);
    this.promptAddSearchTerm.set('');
    this.editCollectionName.set(collection?.name ?? '');
    this.editCollectionTag.set(collection?.tag ?? '');
    this.editCollectionCustomUrl.set(collection?.customUrl ?? '');
    this.editCollectionBlurb.set(collection?.blurb ?? '');
    this.editBrandLink.set(collection?.brandLink ?? '');
    this.editBrandSubtext.set(collection?.brandSubtext ?? '');
    this.brandingSectionExpanded.set(false);
    this.editCustomUrlError.set(null);
    this.brandLogoUploadError.set(null);
    this.clearCustomUrlDebounce();
  }

  closeEditModal() {
    if (this.isUpdatingCollection()) {
      return;
    }
    this.editModalOpen.set(false);
    this.editModalTab.set('remove');
    this.selectedPromptsToRemove.set(new Set());
    this.selectedPromptsToAdd.set(new Set());
    this.updateCollectionError.set(null);
    this.promptAddSearchTerm.set('');
    this.editCollectionName.set('');
    this.editCollectionTag.set('');
    this.editCollectionCustomUrl.set('');
    this.editCollectionBlurb.set('');
    this.editBrandLink.set('');
    this.editBrandSubtext.set('');
    this.editCustomUrlError.set(null);
    this.brandLogoUploadError.set(null);
    this.clearCustomUrlDebounce();
  }

  togglePromptSelectionForRemoval(promptId: string) {
    this.selectedPromptsToRemove.update(prev => {
      const next = new Set(prev);
      if (next.has(promptId)) {
        next.delete(promptId);
      } else {
        next.add(promptId);
      }
      return next;
    });
  }

  isPromptSelectedForRemoval(promptId: string): boolean {
    return this.selectedPromptsToRemove().has(promptId);
  }

  togglePromptSelectionForAdd(promptId: string) {
    this.selectedPromptsToAdd.update(prev => {
      const next = new Set(prev);
      if (next.has(promptId)) {
        next.delete(promptId);
      } else {
        next.add(promptId);
      }
      return next;
    });
  }

  isPromptSelectedForAdd(promptId: string): boolean {
    return this.selectedPromptsToAdd().has(promptId);
  }

  onPromptAddSearch(value: string) {
    this.promptAddSearchTerm.set(value);
  }

  readonly filteredPromptsToAdd = computed(() => {
    const term = this.promptAddSearchTerm().trim().toLowerCase();
    const prompts = this.availablePromptsForAdd();

    if (!term) {
      return prompts;
    }

    return prompts.filter(prompt => {
      const haystack = [prompt.title, prompt.tag, prompt.tagLabel].join(' ').toLowerCase();
      return haystack.includes(term);
    });
  });

  async removeSelectedPrompts() {
    const collection = this.collection();
    if (!collection || !collection.id) {
      return;
    }

    const currentUser = this.authService.currentUser;
    if (!currentUser) {
      return;
    }

    const selectedIds = Array.from(this.selectedPromptsToRemove());
    if (selectedIds.length === 0) {
      this.updateCollectionError.set('Please select at least one prompt to remove.');
      return;
    }

    // Calculate new promptIds by removing selected ones
    const currentPromptIds = collection.promptIds ?? [];
    const remainingPromptIds = currentPromptIds.filter(id => !selectedIds.includes(id));

    if (remainingPromptIds.length === 0) {
      this.updateCollectionError.set('A collection must contain at least one prompt.');
      return;
    }

    this.isUpdatingCollection.set(true);
    this.updateCollectionError.set(null);

    try {
      await this.collectionService.updateCollection(
        collection.id,
        { promptIds: remainingPromptIds },
        currentUser.uid
      );
      // The collection observable will automatically update, which will trigger the promptCount computed signal
      this.closeEditModal();
    } catch (error) {
      console.error('Failed to update collection', error);
      this.updateCollectionError.set(
        error instanceof Error ? error.message : 'Failed to update collection. Please try again.'
      );
    } finally {
      this.isUpdatingCollection.set(false);
    }
  }

  async addSelectedPrompts() {
    const collection = this.collection();
    if (!collection || !collection.id) {
      return;
    }

    const currentUser = this.authService.currentUser;
    if (!currentUser) {
      return;
    }

    const selectedIds = Array.from(this.selectedPromptsToAdd());
    if (selectedIds.length === 0) {
      this.updateCollectionError.set('Please select at least one prompt to add.');
      return;
    }

    // Calculate new promptIds by adding selected ones (avoid duplicates)
    const currentPromptIds = collection.promptIds ?? [];
    const newPromptIds = Array.from(new Set([...currentPromptIds, ...selectedIds]));

    this.isUpdatingCollection.set(true);
    this.updateCollectionError.set(null);

    try {
      await this.collectionService.updateCollection(
        collection.id,
        { promptIds: newPromptIds },
        currentUser.uid
      );
      // The collection observable will automatically update, which will trigger the promptCount computed signal
      this.closeEditModal();
    } catch (error) {
      console.error('Failed to update collection', error);
      this.updateCollectionError.set(
        error instanceof Error ? error.message : 'Failed to update collection. Please try again.'
      );
    } finally {
      this.isUpdatingCollection.set(false);
    }
  }

  async deleteCollection() {
    const collection = this.collection();
    if (!collection || !collection.id) {
      return;
    }

    const currentUser = this.authService.currentUser;
    if (!currentUser) {
      return;
    }

    if (!confirm('Are you sure you want to delete this collection? This action cannot be undone.')) {
      return;
    }

    try {
      await this.collectionService.deleteCollection(collection.id, currentUser.uid);
      await this.router.navigate(['/collections']);
    } catch (error) {
      console.error('Failed to delete collection', error);
      alert(error instanceof Error ? error.message : 'Failed to delete collection. Please try again.');
    }
  }

  async onImageSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    
    if (!file) {
      return;
    }

    const collection = this.collection();
    if (!collection || !collection.id) {
      return;
    }

    const currentUser = this.authService.currentUser;
    if (!currentUser) {
      return;
    }

    this.uploadingImage.set(true);
    this.imageUploadError.set(null);

    try {
      const imageUrl = await this.collectionService.uploadHeroImage(collection.id, file, currentUser.uid);
      this.collection.set({ ...collection, heroImageUrl: imageUrl });
    } catch (error) {
      console.error('Failed to upload hero image', error);
      this.imageUploadError.set(
        error instanceof Error ? error.message : 'Failed to upload image. Please try again.'
      );
    } finally {
      this.uploadingImage.set(false);
      // Reset the input
      input.value = '';
    }
  }

  async deleteHeroImage() {
    const collection = this.collection();
    if (!collection || !collection.id) {
      return;
    }

    const currentUser = this.authService.currentUser;
    if (!currentUser) {
      return;
    }

    if (!confirm('Are you sure you want to remove the hero image?')) {
      return;
    }

    this.deletingImage.set(true);
    this.imageUploadError.set(null);

    try {
      await this.collectionService.deleteHeroImage(collection.id, currentUser.uid);
      this.collection.set({ ...collection, heroImageUrl: undefined });
    } catch (error) {
      console.error('Failed to delete hero image', error);
      this.imageUploadError.set(
        error instanceof Error ? error.message : 'Failed to delete image. Please try again.'
      );
    } finally {
      this.deletingImage.set(false);
    }
  }

  onEditCustomUrlInput(value: string) {
    const trimmed = String(value ?? '').trim();
    this.editCollectionCustomUrl.set(trimmed);
    
    // Clear any existing timer
    if (this.customUrlTimer) {
      clearTimeout(this.customUrlTimer);
    }

    // Clear error if empty
    if (!trimmed) {
      this.editCustomUrlError.set(null);
      this.isCheckingCustomUrl.set(false);
      return;
    }

    // Validate format first
    const urlPattern = /^[a-z0-9-]+$/i;
    if (!urlPattern.test(trimmed)) {
      this.editCustomUrlError.set('Custom URL can only contain letters, numbers, and hyphens.');
      this.isCheckingCustomUrl.set(false);
      return;
    }

    // Check for reserved paths
    const reservedPaths = ['home', 'auth', 'prompt', 'prompts', 'collections', 'collection', 'admin', 'verify-email', 'community-guidelines', 'profile'];
    if (reservedPaths.includes(trimmed.toLowerCase())) {
      this.editCustomUrlError.set('This URL is reserved. Please choose a different one.');
      this.isCheckingCustomUrl.set(false);
      return;
    }

    // Debounce the uniqueness check
    this.isCheckingCustomUrl.set(true);
    this.editCustomUrlError.set(null);
    
    const collection = this.collection();
    this.customUrlTimer = setTimeout(async () => {
      try {
        const isTaken = await this.collectionService.isCustomUrlTaken(trimmed, collection?.id);
        if (isTaken) {
          this.editCustomUrlError.set('This custom URL is already taken. Please choose a different one.');
        } else {
          this.editCustomUrlError.set(null);
        }
      } catch (error) {
        console.error('Failed to check custom URL', error);
        this.editCustomUrlError.set('Unable to verify custom URL availability. Please try again.');
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

  async updateCollectionSettings() {
    const collection = this.collection();
    if (!collection || !collection.id) {
      return;
    }

    const currentUser = this.authService.currentUser;
    if (!currentUser) {
      return;
    }

    if (this.editCustomUrlError()) {
      return;
    }

    const name = this.editCollectionName().trim();
    const tag = this.editCollectionTag().trim();
    const customUrl = this.editCollectionCustomUrl().trim();
    const blurb = this.editCollectionBlurb().trim();
    const brandLink = this.editBrandLink().trim();
    const brandSubtext = this.editBrandSubtext().trim();

    if (!name || name.length < 3) {
      this.updateCollectionError.set('Collection name must be at least 3 characters.');
      return;
    }

    if (!tag || tag.length < 2) {
      this.updateCollectionError.set('Collection tag must be at least 2 characters.');
      return;
    }

    // Validate brand subtext word limit (50 words)
    if (brandSubtext) {
      const wordCount = brandSubtext.split(/\s+/).filter(word => word.length > 0).length;
      if (wordCount > 50) {
        this.updateCollectionError.set('Brand description must be 50 words or less.');
        return;
      }
    }

    this.isUpdatingCollection.set(true);
    this.updateCollectionError.set(null);

    try {
      const updateData: any = {
        name,
        tag,
        customUrl: customUrl || undefined,
        blurb: blurb || undefined,
        brandLink: brandLink || '',
        brandSubtext: brandSubtext || ''
      };

      await this.collectionService.updateCollection(
        collection.id,
        updateData,
        currentUser.uid
      );
      
      // Manually update the collection signal to reflect changes immediately
      this.collection.set({
        ...collection,
        name,
        tag,
        customUrl: customUrl || undefined,
        blurb: blurb || undefined,
        brandLink: brandLink || undefined,
        brandSubtext: brandSubtext || undefined
      });
      
      // Reload collection to get updated data
      // The observable will automatically update
      this.closeEditModal();
    } catch (error) {
      console.error('Failed to update collection', error);
      this.updateCollectionError.set(
        error instanceof Error ? error.message : 'Failed to update collection. Please try again.'
      );
    } finally {
      this.isUpdatingCollection.set(false);
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

  async onBrandLogoSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    
    if (!file) {
      return;
    }

    const collection = this.collection();
    if (!collection || !collection.id) {
      return;
    }

    const currentUser = this.authService.currentUser;
    if (!currentUser) {
      return;
    }

    this.uploadingBrandLogo.set(true);
    this.brandLogoUploadError.set(null);

    try {
      const logoUrl = await this.collectionService.uploadBrandLogo(collection.id, file, currentUser.uid);
      this.collection.set({ ...collection, brandLogoUrl: logoUrl });
    } catch (error) {
      console.error('Failed to upload brand logo', error);
      this.brandLogoUploadError.set(
        error instanceof Error ? error.message : 'Failed to upload logo. Please try again.'
      );
    } finally {
      this.uploadingBrandLogo.set(false);
      // Reset the input
      input.value = '';
    }
  }

  async deleteBrandLogo() {
    const collection = this.collection();
    if (!collection || !collection.id) {
      return;
    }

    const currentUser = this.authService.currentUser;
    if (!currentUser) {
      return;
    }

    if (!confirm('Are you sure you want to remove the brand logo?')) {
      return;
    }

    this.deletingBrandLogo.set(true);
    this.brandLogoUploadError.set(null);

    try {
      await this.collectionService.deleteBrandLogo(collection.id, currentUser.uid);
      this.collection.set({ ...collection, brandLogoUrl: undefined });
    } catch (error) {
      console.error('Failed to delete brand logo', error);
      this.brandLogoUploadError.set(
        error instanceof Error ? error.message : 'Failed to delete logo. Please try again.'
      );
    } finally {
      this.deletingBrandLogo.set(false);
    }
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

