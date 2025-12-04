import { CommonModule } from '@angular/common';
import { Component, DestroyRef, HostListener, ViewChild, ElementRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { PromptService } from '../../services/prompt.service';
import { OrganizationService } from '../../services/organization.service';
import type { Prompt } from '../../models/prompt.model';
import type { UserProfile } from '../../models/user-profile.model';
import type { Organization } from '../../models/organization.model';
import type { PromptCard } from '../../models/prompt-card.model';
import { PromptCardComponent } from '../../components/prompt-card/prompt-card.component';
import { ShareModalComponent } from '../../components/share-modal/share-modal.component';
import { RocketGoalsLaunchService } from '../../services/rocket-goals-launch.service';

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
  readonly launchGrok: number;
  readonly copied: number;
  readonly totalLaunch: number;
  readonly customUrl?: string;
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
}

@Component({
  selector: 'app-liked-prompts-page',
  standalone: true,
  imports: [CommonModule, PromptCardComponent, ShareModalComponent],
  templateUrl: './liked-prompts-page.component.html',
  styleUrl: './liked-prompts-page.component.css'
})
export class LikedPromptsPageComponent {
  private readonly authService = inject(AuthService);
  private readonly promptService = inject(PromptService);
  private readonly organizationService = inject(OrganizationService);
  private readonly rocketGoalsLaunchService = inject(RocketGoalsLaunchService);
  readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly likedPrompts = signal<LikedPromptCard[]>([]);
  readonly authorProfiles = signal<Map<string, UserProfile>>(new Map());
  readonly organizations = signal<Map<string, Organization>>(new Map());
  readonly isLoading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly searchTerm = signal('');
  readonly clientId = signal('');
  readonly likingPrompts = signal<Set<string>>(new Set());
  readonly isAuthenticated = signal(false);
  readonly menuOpen = signal(false);
  readonly menuTop = signal<number | null>(null);
  readonly menuRight = signal<number | null>(null);
  readonly shareModalOpen = signal(false);
  readonly sharePrompt = signal<PromptCard | null>(null);
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

  likedPromptToCard(prompt: LikedPromptCard): PromptCard {
    return {
      id: prompt.id,
      authorId: prompt.authorId,
      title: prompt.title,
      content: prompt.content,
      preview: prompt.preview,
      tag: prompt.tag,
      tagLabel: prompt.tagLabel,
      customUrl: prompt.customUrl,
      views: 0, // LikedPromptCard doesn't have views
      likes: prompt.likes,
      launchGpt: prompt.launchGpt || 0,
      launchGemini: prompt.launchGemini || 0,
      launchClaude: prompt.launchClaude || 0,
      launchGrok: prompt.launchGrok || 0,
      copied: prompt.copied || 0,
      totalLaunch: prompt.totalLaunch || 0,
      authorProfile: prompt.authorProfile,
      organizationId: prompt.organizationId,
      organizationProfile: prompt.organizationProfile,
      forkedFromPromptId: prompt.forkedFromPromptId,
      forkedFromAuthorId: prompt.forkedFromAuthorId,
      forkedFromTitle: prompt.forkedFromTitle,
      forkedFromCustomUrl: prompt.forkedFromCustomUrl,
      forkCount: prompt.forkCount,
      isPrivate: false // Liked prompts are not private
    };
  }

  async openPrompt(prompt: PromptCard | LikedPromptCard) {
    const likedPrompt = prompt as LikedPromptCard;
    if (!likedPrompt?.id) {
      return;
    }

    if (likedPrompt.customUrl) {
      await this.router.navigate([`/${likedPrompt.customUrl}`]);
    } else {
      const short = likedPrompt.id.slice(0, 8) || likedPrompt.id;
      await this.router.navigate(['/prompt', short]);
    }
  }

  async removeLike(prompt: PromptCard | LikedPromptCard, event?: Event) {
    const likedPrompt = prompt as LikedPromptCard;
    event?.stopPropagation();

    if (!likedPrompt?.id) {
      return;
    }

    const actor = this.actorId();
    if (!actor) {
      return;
    }

    if (this.isPromptLiking(likedPrompt.id)) {
      return;
    }

    this.likingPrompts.update(prev => {
      const next = new Set(prev);
      next.add(likedPrompt.id);
      return next;
    });

    try {
      const result = await this.promptService.toggleLike(likedPrompt.id, actor);

      if (result.liked) {
        this.likedPrompts.update(prev =>
          prev.map(item => (item.id === likedPrompt.id ? { ...item, likes: result.likes } : item))
        );
        return;
      }

      this.likedPrompts.update(prev => prev.filter(item => item.id !== likedPrompt.id));
    } catch (error) {
      console.error('Failed to update liked prompt', error);
    } finally {
      this.likingPrompts.update(prev => {
        const next = new Set(prev);
        next.delete(likedPrompt.id);
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
      this.loadOrganizations(prompts);
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

  async navigateToAuthorProfile(authorId: string, event: Event, prompt?: LikedPromptCard | PromptCard) {
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

  navigateToOrganization(organizationId: string, event: Event, prompt?: LikedPromptCard | PromptCard) {
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
      
      const updatedCards = this.likedPrompts().map(card => ({
        ...card,
        authorProfile: card.authorId ? updatedMap.get(card.authorId) : undefined
      }));
      this.likedPrompts.set(updatedCards);
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
      
      const updatedCards = this.likedPrompts().map(card => ({
        ...card,
        organizationProfile: card.organizationId ? updatedMap.get(card.organizationId) : undefined
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
      launchGrok: prompt.launchGrok ?? 0,
      copied: prompt.copied ?? 0,
      totalLaunch: prompt.totalLaunch ?? 0,
      customUrl: prompt.customUrl,
      authorProfile: prompt.authorId ? this.authorProfiles().get(prompt.authorId) : undefined,
      organizationId: prompt.organizationId,
      organizationProfile: prompt.organizationId ? this.organizations().get(prompt.organizationId) : undefined,
      forkedFromPromptId: prompt.forkedFromPromptId,
      forkedFromAuthorId: prompt.forkedFromAuthorId,
      forkedFromTitle: prompt.forkedFromTitle,
      forkedFromCustomUrl: prompt.forkedFromCustomUrl,
      forkCount: prompt.forkCount
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

  getOriginalPromptUrl(prompt: LikedPromptCard | PromptCard): string | null {
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

  navigateToOriginalPrompt(prompt: LikedPromptCard | PromptCard, event: Event) {
    event.stopPropagation();
    const url = this.getOriginalPromptUrl(prompt);
    if (url) {
      void this.router.navigateByUrl(url.replace(window.location.origin, ''));
    }
  }

  getPromptUrl(prompt: LikedPromptCard): string {
    const short = prompt.id ? prompt.id.slice(0, 8) : '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return prompt.customUrl ? `${origin}/${prompt.customUrl}` : `${origin}/prompt/${short}`;
  }

  getPromptDisplayUrl(prompt: LikedPromptCard): string {
    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'rocketprompt.io';
    const short = prompt.id ? prompt.id.slice(0, 8) : '';
    return prompt.customUrl ? `${hostname}/${prompt.customUrl}` : `${hostname}/prompt/${short}`;
  }

  async navigateToHomeOrLanding() {
    const user = this.authService.currentUser;
    if (user) {
      await this.router.navigate(['/home']);
    } else {
      await this.router.navigate(['/']);
    }
  }

  async launchPrompt(prompt: PromptCard) {
    if (!prompt?.content) {
      return;
    }

    const text = prompt.content;
    const url = this.createChatGPTUrl(text);
    await this.openChatbot(url, 'ChatGPT', text);
    await this.trackPromptLaunch(prompt, 'gpt');
  }

  openShareModal(prompt: PromptCard) {
    this.sharePrompt.set(prompt);
    this.shareModalOpen.set(true);
  }

  closeShareModal() {
    this.shareModalOpen.set(false);
    this.sharePrompt.set(null);
  }

  async handleOpenChatbot(chatbotName: 'ChatGPT' | 'Gemini' | 'Claude' | 'Grok' | 'RocketGoals'): Promise<void> {
    const prompt = this.sharePrompt();
    if (!prompt?.content) return;

    if (chatbotName === 'RocketGoals') {
      this.launchRocketGoalsPrompt(prompt);
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

  private launchRocketGoalsPrompt(prompt: PromptCard): void {
    const content = prompt.content ?? '';
    if (!content) {
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

  createChatGPTUrl(prompt: string): string {
    const encodedPrompt = encodeURIComponent(prompt);
    const timestamp = Date.now();
    return `https://chat.openai.com/?q=${encodedPrompt}&t=${timestamp}`;
  }

  createGeminiUrl(prompt: string): string {
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

  async openChatbot(url: string, chatbotName: string, promptText?: string) {
    if (chatbotName === 'ChatGPT' || chatbotName === 'Claude') {
      window.open(url, '_blank');
      return;
    }

    const textToCopy = promptText || '';

    try {
      if (textToCopy) {
        await navigator.clipboard.writeText(textToCopy);
      }
    } catch (e) {
      if (textToCopy) {
        this.fallbackCopyTextToClipboard(textToCopy);
      }
    }

    window.open(url, '_blank');
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

  private showCopyMessage(messageText: string) {
    const message = document.createElement('div');
    message.className = 'fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 transition-all';
    message.textContent = messageText;

    document.body.appendChild(message);

    setTimeout(() => {
      message.remove();
    }, 3000);
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
      // Could show a toast message here if needed
    }).catch(() => {
      this.fallbackCopyTextToClipboard(url);
    });
  }

  private buildOneShotLink(prompt: PromptCard, target: 'gpt' | 'grok' | 'claude' | 'rocket'): string | null {
    const base = this.getPromptUrl(prompt as LikedPromptCard);
    if (!base) {
      return null;
    }
    const suffix = target === 'gpt' ? 'GPT' : target === 'grok' ? 'GROK' : target === 'claude' ? 'CLAUDE' : 'ROCKET';
    return `${base}/${suffix}`;
  }

  copyPromptPageUrlFromShare() {
    const prompt = this.sharePrompt();
    if (!prompt) return;

    const url = this.getPromptUrl(prompt as LikedPromptCard);

    navigator.clipboard.writeText(url).then(() => {
      // Could show a toast message here if needed
    }).catch(() => {
      this.fallbackCopyTextToClipboard(url);
    });
  }

  copyPromptFromShare() {
    const prompt = this.sharePrompt();
    if (!prompt?.content) return;

    const text = prompt.content;

    navigator.clipboard.writeText(text).then(() => {
      // Could show a toast message here if needed
    }).catch(() => {
      this.fallbackCopyTextToClipboard(text);
    });
  }

  private async trackPromptLaunch(prompt: PromptCard, launchType: 'gpt' | 'gemini' | 'claude' | 'grok') {
    if (!prompt?.id) {
      return;
    }

    try {
      const result = await this.promptService.trackLaunch(prompt.id, launchType);
      this.likedPrompts.update(prev => prev.map(card => {
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
}
