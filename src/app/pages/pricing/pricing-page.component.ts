import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { RouterLink, Router } from '@angular/router';
import { BillingService } from '../../services/billing.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-pricing-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './pricing-page.component.html',
  styleUrl: './pricing-page.component.css'
})
export class PricingPageComponent {
  readonly processingPlan = signal<'plus' | 'team' | null>(null);
  readonly checkoutError = signal<string | null>(null);

  constructor(
    private readonly billingService: BillingService,
    private readonly authService: AuthService,
    private readonly router: Router
  ) { }

  async startCheckout(plan: 'plus' | 'team') {
    const user = this.authService.currentUser;
    if (!user) {
      await this.router.navigate(['/auth'], {
        queryParams: {
          mode: 'login',
          redirectTo: '/pricing'
        }
      });
      return;
    }

    this.checkoutError.set(null);
    this.processingPlan.set(plan);

    try {
      await this.billingService.startCheckout(plan);
    } catch (error) {
      console.error('Failed to start checkout', error);
      this.checkoutError.set(this.mapCheckoutError(error));
    } finally {
      this.processingPlan.set(null);
    }
  }

  isProcessing(plan: 'plus' | 'team') {
    return this.processingPlan() === plan;
  }

  private mapCheckoutError(error: unknown): string {
    if (
      typeof error === 'object' &&
      error !== null &&
      'message' in error &&
      typeof (error as { message?: unknown }).message === 'string'
    ) {
      const firebaseMessage = (error as { details?: unknown }).details;
      if (typeof firebaseMessage === 'string' && firebaseMessage.trim()) {
        return firebaseMessage;
      }

      return (error as { message: string }).message;
    }

    return 'We could not start the checkout. Please try again.';
  }
}
