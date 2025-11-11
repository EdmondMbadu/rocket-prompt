import { CommonModule } from '@angular/common';
import { Component, DestroyRef, HostListener, ViewChild, ElementRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { PromptService } from '../../services/prompt.service';
import type { Prompt } from '../../models/prompt.model';
import type { UserProfile } from '../../models/user-profile.model';

interface LikedPromptCard {
  readonly id: string;
  readonly authorId: string;
  readonly title: string;
  readonly content: string;
  readonly preview: string;
  readonly tag: string;
  readonly tagLabel: string;
  readonly likes: number;
  readonly launchGpt: number;
  readonly launchGemini: number;
  readonly launchClaude: number;
  readonly copied: number;
  readonly totalLaunch: number;
  readonly customUrl?: string;
  readonly authorProfile?: UserProfile;
}

@Component({
  selector: 'app-liked-prompts-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './liked-prompts-page.component.html',
  styleUrl: './liked-prompts-page.component.css'
})
export class LikedPromptsPageComponent {
  private readonly authService = inject(AuthService);
  private readonly promptService = inject(PromptService);
  readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly likedPrompts = signal<LikedPromptCard[]>([]);
  readonly authorProfiles = signal<Map<string, UserProfile>>(new Map());
  readonly isLoading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly searchTerm = signal('');
  readonly clientId = signal('');
  readonly likingPrompts = signal<Set<string>>(new Set());
  readonly isAuthenticated = signal(false);
  readonly menuOpen = signal(false);
  readonly menuTop = signal<number | null>(null);
  readonly menuRight = signal<number | null>(null);
  @ViewChild('avatarButton') avatarButtonRef?: ElementRef<HTMLButtonElement>;

  readonly currentUser$ = this.authService.currentUser$;
  readonly profile$ = this.currentUser$.pipe(
    switchMap(user => {
      if (!user) {
        return of<UserProfile | undefined>(undefined);
      }

      return this.authService.userProfile$(user.uid);
    }),
    map(profile => profile ? profile : undefined)
  );

  private loadRequestId = 0;
  private lastLoadedActor: string | null = null;

  readonly actorId = computed(() => {
    const user = this.authService.currentUser;
    if (user?.uid) {
      return `u_${user.uid}`;
    }

    const cid = this.clientId();
    return cid ? `c_${cid}` : '';
  });

  readonly filteredPrompts = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const prompts = this.likedPrompts();

    if (!term) {
      return prompts;
    }

    return prompts.filter(prompt => {
      const haystack = [prompt.title, prompt.tagLabel, prompt.preview].join(' ').toLowerCase();
      return haystack.includes(term);
    });
  });

  constructor() {
    this.ensureClientId();

    this.authService.currentUser$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(user => {
        this.isAuthenticated.set(!!user);
        this.lastLoadedActor = null;
        void this.loadLikedPrompts();
      });

    void this.loadLikedPrompts();
  }

  onSearch(value: string) {
    this.searchTerm.set(value);
  }

  async refresh() {
    await this.loadLikedPrompts(true);
  }

  async openPrompt(prompt: LikedPromptCard) {
    if (!prompt?.id) {
      return;
    }

    if (prompt.customUrl) {
      await this.router.navigate([`/${prompt.customUrl}`]);
    } else {
      const short = prompt.id.slice(0, 8) || prompt.id;
      await this.router.navigate(['/prompt', short]);
    }
  }

  async removeLike(prompt: LikedPromptCard, event?: Event) {
    event?.stopPropagation();

    if (!prompt?.id) {
      return;
    }

    const actor = this.actorId();
    if (!actor) {
      return;
    }

    if (this.isPromptLiking(prompt.id)) {
      return;
    }

    this.likingPrompts.update(prev => {
      const next = new Set(prev);
      next.add(prompt.id);
      return next;
    });

    try {
      const result = await this.promptService.toggleLike(prompt.id, actor);

      if (result.liked) {
        this.likedPrompts.update(prev =>
          prev.map(item => (item.id === prompt.id ? { ...item, likes: result.likes } : item))
        );
        return;
      }

      this.likedPrompts.update(prev => prev.filter(item => item.id !== prompt.id));
    } catch (error) {
      console.error('Failed to update liked prompt', error);
    } finally {
      this.likingPrompts.update(prev => {
        const next = new Set(prev);
        next.delete(prompt.id);
        return next;
      });
    }
  }

  isPromptLiking(id: string) {
    return this.likingPrompts().has(id);
  }

  goToAuth(mode: 'login' | 'signup' = 'login') {
    const redirect = this.router.url || '/prompts/liked';
    void this.router.navigate(['/auth'], {
      queryParams: {
        mode: mode === 'signup' ? 'signup' : 'login',
        redirectTo: redirect
      }
    });
  }

  trackPromptById(_: number, prompt: LikedPromptCard) {
    return prompt.id;
  }

  private async loadLikedPrompts(force = false) {
    const actor = this.actorId();

    if (!actor) {
      this.likedPrompts.set([]);
      this.lastLoadedActor = null;
      this.isLoading.set(false);
      this.loadError.set(null);
      return;
    }

    if (!force && actor === this.lastLoadedActor && this.likedPrompts().length) {
      return;
    }

    const requestId = ++this.loadRequestId;
    this.isLoading.set(true);
    this.loadError.set(null);

    try {
      const prompts = await this.promptService.fetchLikedPrompts(actor);

      if (this.loadRequestId !== requestId) {
        return;
      }

      const cards = prompts.map(prompt => this.mapPromptToCard(prompt));
      this.likedPrompts.set(cards);
      this.loadAuthorProfiles(prompts);
      this.lastLoadedActor = actor;
    } catch (error) {
      if (this.loadRequestId !== requestId) {
        return;
      }

      console.error('Failed to load liked prompts', error);
      this.loadError.set('We could not load your liked prompts. Please try again.');
      this.likedPrompts.set([]);
      this.lastLoadedActor = actor;
    } finally {
      if (this.loadRequestId === requestId) {
        this.isLoading.set(false);
      }
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
          // ignore storage errors
        }
      }

      this.clientId.set(id ?? '');
    } catch (error) {
      console.error('Failed to resolve client id', error);
      this.clientId.set('');
    }
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
      
      const updatedCards = this.likedPrompts().map(card => ({
        ...card,
        authorProfile: card.authorId ? updatedMap.get(card.authorId) : undefined
      }));
      this.likedPrompts.set(updatedCards);
    });
  }

  private mapPromptToCard(prompt: Prompt): LikedPromptCard {
    const tag = prompt.tag || 'general';

    return {
      id: prompt.id,
      authorId: prompt.authorId,
      title: prompt.title,
      content: prompt.content,
      preview: this.buildPreview(prompt.content),
      tag,
      tagLabel: this.formatTagLabel(tag),
      likes: prompt.likes ?? 0,
      launchGpt: prompt.launchGpt ?? 0,
      launchGemini: prompt.launchGemini ?? 0,
      launchClaude: prompt.launchClaude ?? 0,
      copied: prompt.copied ?? 0,
      totalLaunch: prompt.totalLaunch ?? 0,
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

  toggleMenu() {
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

  profileInitials(profile: UserProfile | undefined) {
    if (!profile) {
      return 'RP';
    }

    const firstInitial = profile.firstName?.charAt(0)?.toUpperCase() ?? '';
    const lastInitial = profile.lastName?.charAt(0)?.toUpperCase() ?? '';
    const initials = `${firstInitial}${lastInitial}`.trim();

    return initials || (profile.email?.charAt(0)?.toUpperCase() ?? 'R');
  }

  async signOut() {
    this.closeMenu();
    await this.authService.signOut();
    await this.router.navigate(['/']);
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
}


