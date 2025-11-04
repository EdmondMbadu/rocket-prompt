import { CommonModule } from '@angular/common';
import { Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PromptService } from '../../services/prompt.service';
import { AuthService } from '../../services/auth.service';
import type { Prompt } from '../../models/prompt.model';

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
  private readonly destroyRef = inject(DestroyRef);

  readonly isLoading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly prompt = signal<Prompt | undefined>(undefined);
  readonly shareModalOpen = signal(false);
  readonly currentUser = signal(this.authService.currentUser);

  // Provide like state
  readonly liked = signal(false);
  readonly liking = signal(false);
  readonly clientId = signal<string>('');
  // copied state for the single prompt page (used to show check icon briefly)
  readonly copied = signal(false);
  private copyTimer?: ReturnType<typeof setTimeout>;

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

  // Provide a small computed short id for sharing (first 8 chars)
  readonly shortId = computed(() => {
    const p = this.prompt();
    return p?.id ? p.id.slice(0, 8) : '';
  });

  constructor() {
    this.ensureClientId();
    const idParam = String(this.route.snapshot.paramMap.get('id') ?? '');

    this.promptService
      .prompts$()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: prompts => {
          // try exact match first, then prefix match to support shortened ids
          const found = prompts.find(p => p.id === idParam) ?? prompts.find(p => p.id.startsWith(idParam));

          if (!found) {
            this.prompt.set(undefined);
            this.loadError.set('Prompt not found.');
            this.isLoading.set(false);
            return;
          }

          this.prompt.set(found);
          this.loadError.set(null);
          this.isLoading.set(false);
          // determine whether current actor already liked this prompt
          void this.updateLikedState(found.id);
        },
        error: err => {
          console.error('Failed to load prompt', err);
          this.prompt.set(undefined);
          this.loadError.set('Could not load the prompt. Please try again.');
          this.isLoading.set(false);
        }
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
    return `https://claude.ai/?prompt=${encodedPrompt}`;
  }

  async openChatbot(url: string, chatbotName: string, promptText?: string) {
    // ChatGPT supports URL parameters for pre-filling prompts
    // For other providers (Gemini, Claude), copy the prompt text first so paste inserts the prompt
    const text = promptText ?? this.prompt()?.content ?? '';

    if (chatbotName === 'ChatGPT') {
      // ChatGPT: open directly (it accepts query param)
      window.open(url, '_blank');
      return;
    }

    // Gemini and other providers: copy to clipboard first
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
  }

  copyPromptPageUrl() {
    const p = this.prompt();
    if (!p) return;

    const short = p.id ? p.id.slice(0, 8) : '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';

    const url = p.customUrl ? `${origin}/${p.customUrl}` : `${origin}/prompt/${short}`;

    navigator.clipboard.writeText(url).then(() => {
      this.showCopyMessage('Prompt URL copied!');
    }).catch(() => {
      this.fallbackCopyTextToClipboard(url);
      this.showCopyMessage('Prompt URL copied!');
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
    } catch (e) {
      this.fallbackCopyTextToClipboard(text);
      this.showCopyMessage('Prompt copied!');
      this.markCopied();
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
}
