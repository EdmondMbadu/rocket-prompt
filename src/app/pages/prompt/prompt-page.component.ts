import { CommonModule } from '@angular/common';
import { Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PromptService } from '../../services/prompt.service';
import { AuthService } from '../../services/auth.service';
import { OrganizationService } from '../../services/organization.service';
import type { Prompt } from '../../models/prompt.model';
import type { UserProfile } from '../../models/user-profile.model';
import type { Organization } from '../../models/organization.model';

@Component({
  selector: 'app-prompt-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './prompt-page.component.html',
  styleUrl: './prompt-page.component.css'
})
export class PromptPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly promptService = inject(PromptService);
  private readonly authService = inject(AuthService);
  private readonly organizationService = inject(OrganizationService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isLoading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly prompt = signal<Prompt | undefined>(undefined);
  readonly shareModalOpen = signal(false);
  readonly currentUser = signal(this.authService.currentUser);
  readonly authorProfile = signal<UserProfile | undefined>(undefined);
  readonly organization = signal<Organization | undefined>(undefined);
  readonly useGrokCom = signal(true);

  // Provide like state
  readonly liked = signal(false);
  readonly liking = signal(false);
  readonly clientId = signal<string>('');
  // copied state for the single prompt page (used to show check icon briefly)
  readonly copied = signal(false);
  private copyTimer?: ReturnType<typeof setTimeout>;

  // Collapsible sections state - launch stays open, share starts collapsed
  readonly launchSectionExpanded = signal(true);
  readonly shareSectionExpanded = signal(false);

  // computed actor id: `u_<uid>` for signed-in users, `c_<clientId>` for anonymous
  readonly actorId = computed(() => {
    const user = this.currentUser();
    if (user?.uid) return `u_${user.uid}`;
    const cid = this.clientId();
    return cid ? `c_${cid}` : '';
  });

  // Check if user is logged in
  readonly isLoggedIn = computed(() => {
    return !!this.currentUser();
  });

  // Check if current user is the author
  readonly isAuthor = computed(() => {
    const p = this.prompt();
    const user = this.currentUser();
    return p && user && p.authorId === user.uid;
  });

  // Check if prompt is private and user is not the author
  readonly isPrivateAndNotAuthor = computed(() => {
    const p = this.prompt();
    return p?.isPrivate && !this.isAuthor();
  });

  // Provide a small computed short id for sharing (first 8 chars)
  readonly shortId = computed(() => {
    const p = this.prompt();
    return p?.id ? p.id.slice(0, 8) : '';
  });

  // Provide full path for display (e.g., "rocketprompt.io/prompt/abc12345")
  readonly fullPath = computed(() => {
    const p = this.prompt();
    if (!p) return '';
    const short = p.id ? p.id.slice(0, 8) : '';
    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'rocketprompt.io';
    return p.customUrl ? `${hostname}/${p.customUrl}` : `${hostname}/prompt/${short}`;
  });

  // Check if prompt is 100 words or less
  readonly isShortPrompt = computed(() => {
    const p = this.prompt();
    if (!p || !p.content) return false;
    const wordCount = p.content.trim().split(/\s+/).filter(word => word.length > 0).length;
    return wordCount <= 100;
  });

  constructor() {
    this.ensureClientId();

    // Load prompt when route parameter changes (supports navigation between prompts)
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(paramMap => {
        // Support both 'id' (for /prompt/:id) and 'customUrl' (for /:customUrl) route parameters
        const idParam = String(paramMap.get('id') ?? paramMap.get('customUrl') ?? '');

        if (!idParam) {
          this.isLoading.set(false);
          this.loadError.set('Invalid prompt URL.');
          return;
        }

        // Load the prompt directly - this works for both authenticated and unauthenticated users
        void this.loadPrompt(idParam);
      });

    // re-evaluate liked state when auth changes (login/logout)
    this.authService.currentUser$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(user => {
        this.currentUser.set(user);
        const p = this.prompt();
        if (p) {
          void this.updateLikedState(p.id);
        }
      });
  }

  openShareModal() {
    this.shareModalOpen.set(true);
  }

  closeShareModal() {
    this.shareModalOpen.set(false);
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
    // Try passing the prompt directly in the URL (mirrors the ChatGPT flow)
    // If Grok ignores it, the tab still opens and the user can paste manually.
    const encodedPrompt = encodeURIComponent(prompt);
    const timestamp = Date.now();
    const base = this.useGrokCom() ? 'https://grok.com/' : 'https://x.com/i/grok';
    return `${base}?q=${encodedPrompt}&t=${timestamp}`;
  }

  async openChatbot(url: string, chatbotName: string, promptText?: string) {
    // ChatGPT/Claude support query params. Grok tries query param but still copies for safety.
    // Gemini relies on copy to clipboard before opening.
    const text = promptText ?? this.prompt()?.content ?? '';
    const p = this.prompt();

    if (chatbotName === 'ChatGPT' || chatbotName === 'Claude') {
      // Open directly (attempting to prefill via URL query string)
      window.open(url, '_blank');
      // Track launch
      if (p) {
        try {
          const launchType = chatbotName === 'ChatGPT' ? 'gpt' : 'claude';
          const result = await this.promptService.trackLaunch(p.id, launchType);
          this.prompt.set({ ...p, ...result } as Prompt);
        } catch (e) {
          console.error('Failed to track launch', e);
        }
      }
      return;
    }

    if (chatbotName === 'Grok') {
      // Copy so the user can paste if Grok ignores the query param
      try {
        if (text) {
          await navigator.clipboard.writeText(text);
          this.showCopyMessage('Grok prompt copied!');
        }
      } catch (e) {
        if (text) {
          this.fallbackCopyTextToClipboard(text);
          this.showCopyMessage('Grok prompt copied!');
        }
      }

      window.open(url, '_blank');

      // Track launch
      if (p) {
        try {
          const result = await this.promptService.trackLaunch(p.id, 'grok');
          this.prompt.set({ ...p, ...result } as Prompt);
        } catch (e) {
          console.error('Failed to track launch', e);
        }
      }
      return;
    }

    // Gemini: copy to clipboard first
    try {
      if (text) {
        await navigator.clipboard.writeText(text);
        this.showCopyMessage(`${chatbotName} prompt copied!`);
      }
    } catch (e) {
      if (text) {
        this.fallbackCopyTextToClipboard(text);
        this.showCopyMessage(`${chatbotName} prompt copied!`);
      }
    }

    window.open(url, '_blank');

    // Track launch
    if (p) {
      try {
        const launchType: 'gemini' = 'gemini';
        const result = await this.promptService.trackLaunch(p.id, launchType);
        this.prompt.set({ ...p, ...result } as Prompt);
      } catch (e) {
        console.error('Failed to track launch', e);
      }
    }
  }

  copyOneClickLink(target: 'gpt' | 'grok' | 'claude') {
    const url = this.buildOneShotLink(target);
    if (!url) return;

    const label = target === 'gpt' ? 'One Shot GPT' : target === 'grok' ? 'One Shot Grok' : 'One Shot Claude';
    navigator.clipboard.writeText(url).then(() => {
      this.showCopyMessage(`${label} link copied!`);
    }).catch(() => {
      this.fallbackCopyTextToClipboard(url);
      this.showCopyMessage(`${label} link copied!`);
    });
  }

  copyPromptPageUrl() {
    const p = this.prompt();
    if (!p) return;

    const short = p.id ? p.id.slice(0, 8) : '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';

    const url = p.customUrl ? `${origin}/${p.customUrl}` : `${origin}/prompt/${short}`;

    navigator.clipboard.writeText(url).then(() => {
      this.showCopyMessage('Prompt URL copied!');
      this.markCopied();
    }).catch(() => {
      this.fallbackCopyTextToClipboard(url);
      this.showCopyMessage('Prompt URL copied!');
      this.markCopied();
    });
  }

  async copyPrompt() {
    const p = this.prompt();
    if (!p) return;

    const text = p.content ?? '';

    try {
      await navigator.clipboard.writeText(text);
      this.showCopyMessage('Prompt copied!');
      this.markCopied();

      // Track launch
      try {
        const result = await this.promptService.trackLaunch(p.id, 'copied');
        this.prompt.set({ ...p, ...result } as Prompt);
      } catch (e) {
        console.error('Failed to track launch', e);
      }
    } catch (e) {
      this.fallbackCopyTextToClipboard(text);
      this.showCopyMessage('Prompt copied!');
      this.markCopied();

      // Track launch
      try {
        const result = await this.promptService.trackLaunch(p.id, 'copied');
        this.prompt.set({ ...p, ...result } as Prompt);
      } catch (e) {
        console.error('Failed to track launch', e);
      }
    }
  }

  private markCopied() {
    try {
      // set copied flag and clear any previous timer
      this.copied.set(true);
      if (this.copyTimer) {
        clearTimeout(this.copyTimer);
      }

      const DURATION = 2500;
      this.copyTimer = setTimeout(() => {
        this.copied.set(false);
        this.copyTimer = undefined;
      }, DURATION);
    } catch (e) {
      // ignore
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

  // --- Likes support ---
  private ensureClientId() {
    try {
      const key = 'rp_client_id';
      let id = typeof window !== 'undefined' ? localStorage.getItem(key) : null;
      if (!id) {
        id = `c_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
        try { localStorage.setItem(key, id); } catch { /* ignore */ }
      }
      this.clientId.set(id ?? '');
    } catch (e) {
      this.clientId.set('');
    }
  }

  private async loadPrompt(identifier: string) {
    // Reset state
    this.isLoading.set(true);
    this.loadError.set(null);
    this.prompt.set(undefined);

    try {
      // First, try to find by customUrl (most efficient for custom URLs)
      let found = await this.promptService.getPromptByCustomUrl(identifier);

      // If not found by customUrl, try by ID (supports full ID or short prefix)
      if (!found) {
        found = await this.promptService.getPromptById(identifier);
      }

      if (!found) {
        // Prompt not found - show error but don't redirect
        this.prompt.set(undefined);
        this.loadError.set('Prompt not found.');
        this.isLoading.set(false);
        return;
      }

      // Successfully found the prompt
      this.prompt.set(found);
      this.loadError.set(null);
      this.isLoading.set(false);

      // Load organization if organizationId exists, otherwise load author profile
      if (found.organizationId) {
        void this.loadOrganization(found.organizationId);
      } else if (found.authorId) {
        void this.loadAuthorProfile(found.authorId);
      }

      // determine whether current actor already liked this prompt
      void this.updateLikedState(found.id);
    } catch (error) {
      // Handle errors gracefully - show error message but don't redirect
      console.error('Failed to load prompt', error);
      this.prompt.set(undefined);

      // Provide more specific error messages
      const errorMessage = error instanceof Error
        ? `Could not load the prompt: ${error.message}`
        : 'Could not load the prompt. Please try again.';

      this.loadError.set(errorMessage);
      this.isLoading.set(false);
    }
  }

  private async updateLikedState(promptId: string) {
    const actor = this.actorId();
    if (!actor) {
      this.liked.set(false);
      return;
    }

    try {
      const has = await this.promptService.hasLiked(promptId, actor);
      this.liked.set(has);
    } catch (e) {
      console.error('Failed to determine liked state', e);
      this.liked.set(false);
    }
  }

  async toggleLike() {
    const p = this.prompt();
    if (!p) return;
    if (this.liking()) return;

    const actor = this.actorId();
    if (!actor) return;

    this.liking.set(true);
    try {
      const res = await this.promptService.toggleLike(p.id, actor);
      this.liked.set(res.liked);
      this.prompt.set({ ...p, likes: res.likes } as Prompt);
    } catch (e) {
      console.error('Failed to toggle like', e);
    } finally {
      this.liking.set(false);
    }
  }

  back() {
    this.router.navigate(['/home'], { replaceUrl: true });
  }

  copyShareLink() {
    const id = this.shortId() || this.prompt()?.id;
    if (!id) return;

    const url = `${window.location.origin}/prompt/${id}`;
    void navigator.clipboard?.writeText(url);
  }

  // gracefully format date
  formatDate(date?: Date) {
    if (!date) return '';
    return new Date(date).toLocaleString();
  }

  navigateToSignUp() {
    this.router.navigate(['/auth'], { queryParams: { mode: 'signup' } });
  }

  getPromptUrl(): string {
    const p = this.prompt();
    if (!p) return '';
    const short = p.id ? p.id.slice(0, 8) : '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return p.customUrl ? `${origin}/${p.customUrl}` : `${origin}/prompt/${short}`;
  }

  private buildOneShotLink(target: 'gpt' | 'grok' | 'claude'): string | null {
    const base = this.getPromptUrl();
    if (!base) return null;
    const suffix = target === 'gpt' ? 'GPT' : target === 'grok' ? 'GROK' : 'CLAUDE';
    return `${base}/${suffix}`;
  }

  shareToFacebook() {
    const url = encodeURIComponent(this.getPromptUrl());
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank', 'width=600,height=400');
  }

  shareToTwitter() {
    const url = encodeURIComponent(this.getPromptUrl());
    const title = this.prompt()?.title || 'Check out this prompt';
    const text = encodeURIComponent(title);
    window.open(`https://twitter.com/intent/tweet?url=${url}&text=${text}`, '_blank', 'width=600,height=400');
  }

  shareToLinkedIn() {
    const url = encodeURIComponent(this.getPromptUrl());
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${url}`, '_blank', 'width=600,height=400');
  }

  sharePromptUrl() {
    this.copyPromptPageUrl();
  }

  toggleShareSection() {
    this.shareSectionExpanded.update(v => !v);
  }

  // Organization methods
  private async loadOrganization(organizationId: string) {
    try {
      this.organizationService.organization$(organizationId)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (org) => {
            this.organization.set(org || undefined);
          },
          error: (error) => {
            console.error('Failed to load organization', error);
            this.organization.set(undefined);
          }
        });
    } catch (error) {
      console.error('Failed to load organization', error);
      this.organization.set(undefined);
    }
  }

  // Author profile methods
  private async loadAuthorProfile(authorId: string) {
    try {
      const profile = await this.authService.fetchUserProfile(authorId);
      this.authorProfile.set(profile || undefined);
    } catch (error) {
      console.error('Failed to load author profile', error);
      this.authorProfile.set(undefined);
    }
  }

  getAuthorProfile(): UserProfile | undefined {
    return this.authorProfile();
  }

  getOrganization(): Organization | undefined {
    return this.organization();
  }

  getAuthorInitials(): string {
    const org = this.getOrganization();
    if (org) {
      // Use first letter of organization name
      return org.name?.charAt(0)?.toUpperCase() ?? 'O';
    }

    const profile = this.getAuthorProfile();
    if (!profile) {
      return 'RP';
    }

    const firstInitial = profile.firstName?.charAt(0)?.toUpperCase() ?? '';
    const lastInitial = profile.lastName?.charAt(0)?.toUpperCase() ?? '';
    const initials = `${firstInitial}${lastInitial}`.trim();

    return initials || (profile.email?.charAt(0)?.toUpperCase() ?? 'R');
  }

  getAuthorName(): string {
    const org = this.getOrganization();
    if (org) {
      return org.name;
    }

    const profile = this.getAuthorProfile();
    if (!profile) {
      return 'Author';
    }

    return `${profile.firstName || ''} ${profile.lastName || ''}`.trim() || profile.email || 'Author';
  }

  getAuthorProfilePicture(): string | undefined {
    const org = this.getOrganization();
    if (org?.logoUrl) {
      return org.logoUrl;
    }

    const profile = this.getAuthorProfile();
    return profile?.profilePictureUrl;
  }

  async navigateToAuthorProfile(authorId: string, event: Event) {
    event.stopPropagation();
    const org = this.getOrganization();
    if (org) {
      if (org.username) {
        void this.router.navigate(['/organization', org.username]);
      } else {
        // Fallback to ID if username not available (though this shouldn't happen)
        console.warn('Organization missing username, using ID:', org.id);
        void this.router.navigate(['/organization', org.id]);
      }
      return;
    }

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

  getOriginalPromptUrl(): string | null {
    const p = this.prompt();
    if (!p?.forkedFromPromptId) {
      return null;
    }

    if (p.forkedFromCustomUrl) {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      return `${origin}/${p.forkedFromCustomUrl}`;
    }

    if (p.forkedFromPromptId) {
      const short = p.forkedFromPromptId.slice(0, 8);
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      return `${origin}/prompt/${short}`;
    }

    return null;
  }

  async navigateToHomeOrLanding() {
    const user = this.authService.currentUser;
    if (user) {
      await this.router.navigate(['/home']);
    } else {
      await this.router.navigate(['/']);
    }
  }

  setGrokDomain(useGrokDotCom: boolean) {
    this.useGrokCom.set(useGrokDotCom);
  }
}
