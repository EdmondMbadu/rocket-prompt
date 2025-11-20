import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink, Router } from '@angular/router';
import { BillingService } from '../../services/billing.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-pricing-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './pricing-page.component.html',
  styleUrl: './pricing-page.component.css'
})
export class PricingPageComponent implements OnInit {
  readonly processingPlan = signal<'plus' | 'team' | null>(null);
  readonly checkoutError = signal<string | null>(null);

  constructor(
    private readonly billingService: BillingService,
    private readonly authService: AuthService,
    private readonly router: Router,
    private readonly route: ActivatedRoute
  ) { }

  ngOnInit() {
    const planParam = this.normalizePlan(this.route.snapshot.queryParamMap.get('plan'));
    const shouldAutoCheckout = this.route.snapshot.queryParamMap.get('autoCheckout') === '1';

    if (shouldAutoCheckout && planParam) {
      setTimeout(() => {
        void this.startCheckout(planParam);
      }, 0);
    }

    if (shouldAutoCheckout || planParam) {
      this.clearCheckoutParams();
    }
  }

  async startCheckout(plan: 'plus' | 'team') {
    const user = this.authService.currentUser;
    if (!user) {
      await this.router.navigate(['/auth'], {
        queryParams: {
          mode: 'login',
          redirectTo: `/pricing?plan=${plan}&autoCheckout=1`
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

  private normalizePlan(input: string | null): 'plus' | 'team' | null {
    if (input === 'plus' || input === 'team') {
      return input;
    }
    return null;
  }

  private clearCheckoutParams() {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { plan: null, autoCheckout: null },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }
}
