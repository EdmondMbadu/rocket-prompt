import { CommonModule } from '@angular/common';
import { Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map, distinctUntilChanged, switchMap, combineLatest } from 'rxjs/operators';
import { of, combineLatest as rxjsCombineLatest } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { CollectionService } from '../../services/collection.service';
import { PromptService } from '../../services/prompt.service';
import type { PromptCollection } from '../../models/collection.model';
import type { Prompt } from '../../models/prompt.model';
import type { UserProfile } from '../../models/user-profile.model';

interface PromptCard {
  readonly id: string;
  readonly authorId: string;
  readonly title: string;
  readonly content: string;
  readonly preview: string;
  readonly tag: string;
  readonly tagLabel: string;
  readonly customUrl?: string;
  readonly authorProfile?: UserProfile;
}

interface PromptOption {
  readonly id: string;
  readonly title: string;
  readonly tag: string;
  readonly tagLabel: string;
}

@Component({
  selector: 'app-collection-detail',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './collection-detail.component.html',
  styleUrl: './collection-detail.component.css'
})
export class CollectionDetailComponent {
  private readonly authService = inject(AuthService);
  private readonly collectionService = inject(CollectionService);
  private readonly promptService = inject(PromptService);
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
  readonly isLoadingPrompts = signal(true);
  readonly loadPromptsError = signal<string | null>(null);
  readonly recentlyCopied = signal<Set<string>>(new Set());
  readonly menuOpen = signal(false);
  readonly bookmarked = signal(false);
  readonly bookmarking = signal(false);
  readonly clientId = signal('');
  readonly copiedPromptUrl = signal<Set<string>>(new Set());
  readonly editModalOpen = signal(false);
  readonly editModalTab = signal<'remove' | 'add'>('remove');
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

  // Check if current user is the author of the collection
  readonly isAuthor = computed(() => {
    const collection = this.collection();
    const currentUser = this.authService.currentUser;
    if (!collection || !currentUser) {
      return false;
    }
    return collection.authorId === currentUser.uid;
  });

  readonly canEdit = computed(() => this.isAuthor());
  readonly canDelete = computed(() => this.isAuthor());

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

    this.menuOpen.update(open => !open);
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
        map(params => params.get('id')),
        distinctUntilChanged(),
        switchMap(id => {
          if (!id) {
            this.collection.set(null);
            this.collectionTagLabel.set('');
            this.collectionNotFound.set(true);
            this.isLoadingCollection.set(false);
            return of<PromptCollection | null>(null);
          }

          this.isLoadingCollection.set(true);
          this.collectionNotFound.set(false);

          return this.collectionService.collection$(id).pipe(
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
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: collection => {
          if (collection) {
            this.collection.set(collection);
            this.collectionTagLabel.set(this.formatTagLabel(collection.tag ?? 'general'));
            void this.updateBookmarkedState(collection.id);
          } else {
            this.collection.set(null);
            this.collectionTagLabel.set('');
            this.bookmarked.set(false);
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
      authorProfile: prompt.authorId ? this.authorProfiles().get(prompt.authorId) : undefined
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
    this.editModalOpen.set(true);
    this.editModalTab.set('remove');
    this.selectedPromptsToRemove.set(new Set());
    this.selectedPromptsToAdd.set(new Set());
    this.updateCollectionError.set(null);
    this.promptAddSearchTerm.set('');
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
}

