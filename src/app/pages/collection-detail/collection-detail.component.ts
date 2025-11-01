import { CommonModule } from '@angular/common';
import { Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { CollectionService } from '../../services/collection.service';
import { PromptService } from '../../services/prompt.service';
import type { PromptCollection } from '../../models/collection.model';
import type { Prompt } from '../../models/prompt.model';
import type { UserProfile } from '../../models/user-profile.model';

interface PromptCard {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly preview: string;
  readonly tag: string;
  readonly tagLabel: string;
  readonly customUrl?: string;
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
  private readonly router = inject(Router);
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
  readonly isLoadingPrompts = signal(true);
  readonly loadPromptsError = signal<string | null>(null);
  readonly recentlyCopied = signal<Set<string>>(new Set());
  readonly menuOpen = signal(false);
  readonly liked = signal(false);
  readonly liking = signal(false);
  readonly clientId = signal('');

  readonly actorId = computed(() => {
    const user = this.authService.currentUser;
    if (user?.uid) {
      return `u_${user.uid}`;
    }

    const cid = this.clientId();
    return cid ? `c_${cid}` : '';
  });

  private readonly copyTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
          void this.updateLikedState(current.id);
        } else {
          this.liked.set(false);
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
    const short = (prompt?.id ?? '').slice(0, 8);
    if (!short) {
      return;
    }

    void this.router.navigate(['/prompt', short]);
  }

  backToCollections() {
    void this.router.navigate(['/collections']);
  }

  trackPromptById(_: number, prompt: PromptCard) {
    return prompt.id;
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
                this.liked.set(false);
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
            void this.updateLikedState(collection.id);
          } else {
            this.collection.set(null);
            this.collectionTagLabel.set('');
            this.liked.set(false);
          }

          this.isLoadingCollection.set(false);
        },
        error: error => {
          console.error('Failed to load collection', error);
          this.collection.set(null);
          this.collectionTagLabel.set('');
          this.collectionNotFound.set(true);
          this.isLoadingCollection.set(false);
          this.liked.set(false);
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

  private mapPromptToCard(prompt: Prompt): PromptCard {
    const tag = prompt.tag || 'general';

    return {
      id: prompt.id,
      title: prompt.title,
      content: prompt.content,
      preview: this.buildPreview(prompt.content),
      tag,
      tagLabel: this.formatTagLabel(tag),
      customUrl: prompt.customUrl
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

  goToAuth(mode: 'login' | 'signup' = 'login') {
    const redirect = this.router.url || '/collections';
    void this.router.navigate(['/auth'], {
      queryParams: {
        mode: mode === 'signup' ? 'signup' : 'login',
        redirectTo: redirect
      }
    });
  }

  async toggleLike(event?: Event) {
    event?.stopPropagation();

    const collection = this.collection();
    if (!collection || !collection.id) {
      return;
    }

    if (this.liking()) {
      return;
    }

    const actor = this.actorId();
    if (!actor) {
      return;
    }

    this.liking.set(true);

    try {
      const result = await this.collectionService.toggleLike(collection.id, actor);
      this.liked.set(result.liked);
      this.collection.set({ ...collection, likes: result.likes });
    } catch (error) {
      console.error('Failed to toggle collection like', error);
    } finally {
      this.liking.set(false);
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

  private async updateLikedState(collectionId: string | undefined) {
    const trimmedId = collectionId?.trim();

    if (!trimmedId) {
      this.liked.set(false);
      return;
    }

    const actor = this.actorId();

    if (!actor) {
      this.liked.set(false);
      return;
    }

    try {
      const has = await this.collectionService.hasLiked(trimmedId, actor);
      this.liked.set(has);
    } catch (error) {
      console.error('Failed to determine collection liked state', error);
      this.liked.set(false);
    }
  }
}

