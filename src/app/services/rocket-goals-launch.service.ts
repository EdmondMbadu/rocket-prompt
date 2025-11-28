import { Injectable } from '@angular/core';

export interface RocketGoalsLaunchPreparation {
  readonly token: string;
  readonly url: string;
  readonly stored: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class RocketGoalsLaunchService {
  private readonly storageKeyPrefix = 'rocketGoalsAutoPrompt:';
  private readonly defaultOrigin = 'https://rocketprompt.io';

  prepareLaunch(promptText: string, promptId?: string): RocketGoalsLaunchPreparation {
    const token = this.createToken(promptId);
    const stored = this.storePrompt(token, promptText);
    const url = this.buildLaunchUrl(token);

    return { token, url, stored };
  }

  consumePrompt(token: string): string | null {
    if (!token || typeof window === 'undefined' || !window.localStorage) {
      return null;
    }

    const storageKey = this.getStorageKey(token);
    try {
      const prompt = window.localStorage.getItem(storageKey);
      if (prompt) {
        window.localStorage.removeItem(storageKey);
        return prompt;
      }
    } catch (error) {
      console.error('Failed to read RocketGoals prompt payload', error);
    }

    return null;
  }

  private createToken(promptId?: string): string {
    const randomPart = Math.random().toString(36).slice(2, 8);
    const idPart = promptId ? promptId.slice(0, 8) : randomPart;
    return `${Date.now()}-${idPart}-${randomPart}`;
  }

  private storePrompt(token: string, promptText: string): boolean {
    if (typeof window === 'undefined' || !window.localStorage) {
      return false;
    }

    const storageKey = this.getStorageKey(token);
    try {
      window.localStorage.setItem(storageKey, promptText);
      return true;
    } catch (error) {
      console.error('Failed to store RocketGoals prompt payload', error);
      return false;
    }
  }

  private buildLaunchUrl(token: string): string {
    const origin = this.getOrigin();
    const encodedToken = encodeURIComponent(token);
    return `${origin}/ai?autoLaunch=${encodedToken}`;
  }

  private getOrigin(): string {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return window.location.origin;
    }
    return this.defaultOrigin;
  }

  private getStorageKey(token: string): string {
    return `${this.storageKeyPrefix}${token}`;
  }
}
