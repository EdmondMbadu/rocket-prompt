import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PromptService } from '../../services/prompt.service';
import { RocketGoalsLaunchService } from '../../services/rocket-goals-launch.service';
import type { Prompt } from '../../models/prompt.model';

type LaunchTarget = 'gpt' | 'grok' | 'claude' | 'rocket';

@Component({
  selector: 'app-prompt-launch',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './prompt-launch.component.html',
  styleUrl: './prompt-launch.component.css'
})
export class PromptLaunchComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly promptService = inject(PromptService);
  private readonly rocketGoalsLaunchService = inject(RocketGoalsLaunchService);

  readonly status = signal<'loading' | 'launching' | 'error'>('loading');
  readonly errorMessage = signal<string | null>(null);
  readonly promptTitle = signal<string>('');
  readonly promptUrl = signal<string>('');
  readonly launchTarget = signal<LaunchTarget>('gpt');
  readonly launchTargetLabel = computed(() => {
    const target = this.launchTarget();
    return target === 'gpt' ? 'GPT' : target === 'grok' ? 'Grok' : target === 'claude' ? 'Claude' : 'Rocket';
  });

  private lastIdentifier: string | null = null;
  private lastIdentifierType: 'id' | 'custom' = 'custom';
  private currentPrompt: Prompt | null = null;

  constructor() {
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(params => {
        const rawTarget = (params.get('target') ?? '').toLowerCase();
        const target: LaunchTarget = rawTarget === 'grok' ? 'grok' : rawTarget === 'claude' ? 'claude' : rawTarget === 'rocket' ? 'rocket' : 'gpt';
        this.launchTarget.set(target);

        const idParam = params.get('id');
        const customParam = params.get('customUrl');
        const identifier = (customParam ?? idParam ?? '').trim();

        if (!identifier) {
          this.status.set('error');
          this.errorMessage.set('Missing prompt identifier.');
          return;
        }

        const identifierType: 'id' | 'custom' = idParam ? 'id' : 'custom';
        this.lastIdentifier = identifier;
        this.lastIdentifierType = identifierType;
        void this.loadAndLaunch(identifier, identifierType);
      });
  }

  retryLaunch() {
    if (!this.lastIdentifier) {
      return;
    }
    void this.loadAndLaunch(this.lastIdentifier, this.lastIdentifierType);
  }

  private async loadAndLaunch(identifier: string, identifierType: 'id' | 'custom') {
    this.status.set('loading');
    this.errorMessage.set(null);

    try {
      let prompt: Prompt | undefined;
      if (identifierType === 'id') {
        prompt = await this.promptService.getPromptById(identifier);
      } else {
        prompt = await this.promptService.getPromptByCustomUrl(identifier)
          ?? await this.promptService.getPromptById(identifier);
      }

      if (!prompt) {
        this.status.set('error');
        this.errorMessage.set('Prompt not found or unavailable.');
        return;
      }

      this.currentPrompt = prompt;
      this.promptTitle.set(prompt.title || 'Prompt');
      this.promptUrl.set(this.buildPromptUrl(prompt));
      await this.launchPrompt(prompt);
    } catch (error) {
      console.error('Failed to launch prompt', error);
      this.status.set('error');
      this.errorMessage.set('Something went wrong while launching this prompt.');
    }
  }

  private async launchPrompt(prompt: Prompt) {
    const text = prompt.content?.trim() ?? '';
    if (!text) {
      this.status.set('error');
      this.errorMessage.set('Prompt has no content to launch.');
      return;
    }

    this.status.set('launching');
    const target = this.launchTarget();
    let url: string;
    if (target === 'gpt') {
      url = this.createChatGPTUrl(text);
    } else if (target === 'grok') {
      url = this.createGrokUrl(text);
    } else if (target === 'rocket') {
      const launch = this.rocketGoalsLaunchService.prepareLaunch(text, prompt.id);
      url = launch.url;
    } else {
      url = this.createClaudeUrl(text);
    }

    try {
      await this.promptService.trackLaunch(prompt.id, target);
    } catch (error) {
      console.error('Failed to track launch', error);
      // continue redirect even if tracking fails
    }

    if (typeof window !== 'undefined') {
      window.location.replace(url);
    }
  }

  private buildPromptUrl(prompt: Prompt): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://rocketprompt.io';
    const short = prompt.id ? prompt.id.slice(0, 8) : '';
    return prompt.customUrl ? `${origin}/${prompt.customUrl}` : `${origin}/prompt/${short}`;
  }

  private createChatGPTUrl(prompt: string): string {
    const encodedPrompt = encodeURIComponent(prompt);
    const timestamp = Date.now();
    return `https://chat.openai.com/?q=${encodedPrompt}&t=${timestamp}`;
  }

  private createGrokUrl(prompt: string): string {
    const encodedPrompt = encodeURIComponent(prompt);
    const timestamp = Date.now();
    return `https://grok.com/?q=${encodedPrompt}&t=${timestamp}`;
  }

  private createClaudeUrl(prompt: string): string {
    const encodedPrompt = encodeURIComponent(prompt);
    return `https://claude.ai/new?q=${encodedPrompt}`;
  }
}
