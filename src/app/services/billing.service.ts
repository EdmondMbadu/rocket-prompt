import { Injectable } from '@angular/core';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import type { Functions } from 'firebase/functions';
import { environment } from '../../../environments/environments';
import { AuthService } from './auth.service';

type PlanOption = 'plus' | 'team';

interface CheckoutPayload {
  plan: PlanOption;
  successUrl: string;
  cancelUrl: string;
}

interface CheckoutResponse {
  sessionId: string;
  sessionUrl?: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class BillingService {
  private readonly app: FirebaseApp = this.ensureApp();
  private functions: Functions | null = null;
  private functionsModule?: typeof import('firebase/functions');

  constructor(private readonly authService: AuthService) {}

  async startCheckout(plan: PlanOption): Promise<void> {
    const user = this.authService.currentUser;
    if (!user) {
      throw new Error('Please sign in before upgrading.');
    }

    const origin = this.getWindowOrigin();
    const successUrl = `${origin}/home?checkout=success`;
    const cancelUrl = `${origin}/?checkout=cancelled`;

    const { functions, functionsModule } = await this.getFunctionsContext();
    const callable = functionsModule.httpsCallable<CheckoutPayload, CheckoutResponse>(
      functions,
      'createCheckoutSession'
    );

    const response = await callable({
      plan,
      successUrl,
      cancelUrl
    });

    const sessionUrl = response.data?.sessionUrl;
    if (!sessionUrl) {
      throw new Error('Stripe session was not created. Please try again.');
    }

    if (typeof window !== 'undefined') {
      window.location.assign(sessionUrl);
    } else {
      throw new Error('Checkout requires a browser environment.');
    }
  }

  private async getFunctionsContext() {
    const functionsModule = await this.importFunctionsModule();

    if (!this.functions) {
      this.functions = functionsModule.getFunctions(this.app, 'us-central1');
    }

    return {
      functions: this.functions,
      functionsModule
    };
  }

  private async importFunctionsModule() {
    if (!this.functionsModule) {
      this.functionsModule = await import('firebase/functions');
    }

    return this.functionsModule;
  }

  private ensureApp(): FirebaseApp {
    if (getApps().length) {
      return getApp();
    }

    return initializeApp(environment.firebase);
  }

  private getWindowOrigin(): string {
    if (typeof window === 'undefined') {
      return 'https://rocketprompt.io';
    }

    return window.location.origin;
  }
}
