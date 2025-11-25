import { Injectable, signal } from '@angular/core';

export type GeminiLaunchMode = 'standard' | 'nano';

@Injectable({
  providedIn: 'root'
})
export class GeminiLaunchModeService {
  private readonly storageKey = 'rocketPromptGeminiLaunchMode';
  private readonly standardUrl = 'https://gemini.google.com/app';
  private readonly nanoBaseUrl = 'https://aistudio.google.com/app/prompts/new_chat';
  private readonly nanoModel = 'gemini-3-pro-image-preview';
  private readonly modeSignal = signal<GeminiLaunchMode>('standard');

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const stored = window.localStorage?.getItem(this.storageKey);
        if (stored === 'nano') {
          this.modeSignal.set('nano');
        }
      } catch {
        // Ignore storage errors (e.g., private browsing)
      }
    }
  }

  readonly launchMode = this.modeSignal.asReadonly();

  setLaunchMode(mode: GeminiLaunchMode) {
    if (this.modeSignal() === mode) {
      return;
    }

    this.modeSignal.set(mode);

    if (typeof window !== 'undefined') {
      try {
        window.localStorage?.setItem(this.storageKey, mode);
      } catch {
        // Ignore storage errors (e.g., quota exceeded)
      }
    }
  }

  isNanoMode(): boolean {
    return this.modeSignal() === 'nano';
  }

  shouldCopyBeforeOpen(): boolean {
    return !this.isNanoMode();
  }

  buildLaunchUrl(prompt: string): string {
    if (this.isNanoMode()) {
      const url = new URL(this.nanoBaseUrl);
      url.searchParams.set('model', this.nanoModel);
      const trimmed = (prompt ?? '').trim();
      if (trimmed) {
        url.searchParams.set('input', trimmed);
        url.searchParams.set('prompt', trimmed);
      }
      return url.toString();
    }

    return this.standardUrl;
  }
}
