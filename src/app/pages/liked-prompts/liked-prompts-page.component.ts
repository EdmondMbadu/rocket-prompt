import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../services/auth.service';
import { PromptService } from '../../services/prompt.service';
import type { Prompt } from '../../models/prompt.model';

interface LikedPromptCard {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly preview: string;
  readonly tag: string;
  readonly tagLabel: string;
  readonly likes: number;
  readonly customUrl?: string;
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
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly likedPrompts = signal<LikedPromptCard[]>([]);
  readonly isLoading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly searchTerm = signal('');
  readonly clientId = signal('');
  readonly likingPrompts = signal<Set<string>>(new Set());
  readonly isAuthenticated = signal(false);

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

    const short = prompt.id.slice(0, 8) || prompt.id;
    await this.router.navigate(['/prompt', short]);
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

      this.likedPrompts.set(prompts.map(prompt => this.mapPromptToCard(prompt)));
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

  private mapPromptToCard(prompt: Prompt): LikedPromptCard {
    const tag = prompt.tag || 'general';

    return {
      id: prompt.id,
      title: prompt.title,
      content: prompt.content,
      preview: this.buildPreview(prompt.content),
      tag,
      tagLabel: this.formatTagLabel(tag),
      likes: prompt.likes ?? 0,
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
}

