import { CommonModule } from '@angular/common';
import { Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PromptService } from '../../services/prompt.service';
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
  private readonly destroyRef = inject(DestroyRef);

  readonly isLoading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly prompt = signal<Prompt | undefined>(undefined);
  readonly shareModalOpen = signal(false);

  // Provide a small computed short id for sharing (first 8 chars)
  readonly shortId = computed(() => {
    const p = this.prompt();
    return p?.id ? p.id.slice(0, 8) : '';
  });

  constructor() {
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
        },
        error: err => {
          console.error('Failed to load prompt', err);
          this.prompt.set(undefined);
          this.loadError.set('Could not load the prompt. Please try again.');
          this.isLoading.set(false);
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
    const encodedPrompt = encodeURIComponent(prompt);
    return `https://gemini.google.com/app?prompt=${encodedPrompt}`;
  }

  createClaudeUrl(prompt: string): string {
    const encodedPrompt = encodeURIComponent(prompt);
    return `https://claude.ai/?prompt=${encodedPrompt}`;
  }

  async openChatbot(url: string, chatbotName: string, promptText?: string) {
    // For non-ChatGPT providers copy the prompt text first so paste inserts the prompt
    const text = promptText ?? this.prompt()?.content ?? '';

    if (chatbotName !== 'ChatGPT') {
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
      return;
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

  back() {
    this.router.navigate(['/home']);
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
}
