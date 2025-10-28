import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './verify-email.component.html',
  styleUrl: './verify-email.component.css'
})
export class VerifyEmailComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  readonly user$ = this.authService.currentUser$;

  isReloading = false;
  isResending = false;
  feedbackMessage = '';
  feedbackType: 'success' | 'error' | '' = '';

  async refreshStatus() {
    try {
      this.isReloading = true;
      await this.authService.reloadCurrentUser();

      if (this.authService.currentUser?.emailVerified) {
        this.feedbackType = 'success';
        this.feedbackMessage = 'Email verified! Redirecting you to your home screen...';
        await this.router.navigate(['/home']);
      } else {
        this.feedbackType = 'error';
        this.feedbackMessage = 'We still need a verified email. Check your inbox or resend below.';
      }
    } finally {
      this.isReloading = false;
    }
  }

  async resendEmail() {
    try {
      this.isResending = true;
      await this.authService.resendVerificationEmail();
      this.feedbackType = 'success';
      this.feedbackMessage = 'Verification email sent! It may take a couple of minutes to arrive.';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to send the verification email.';
      this.feedbackType = 'error';
      this.feedbackMessage = message;
    } finally {
      this.isResending = false;
    }
  }
}
