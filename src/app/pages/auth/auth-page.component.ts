import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FirebaseError } from 'firebase/app';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../services/auth.service';

type AuthMode = 'login' | 'signup' | 'reset';

@Component({
  selector: 'app-auth-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './auth-page.component.html',
  styleUrl: './auth-page.component.css'
})
export class AuthPageComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private redirectToTarget: string | null = null;

  readonly mode = signal<AuthMode>('login');
  readonly heading = computed(() => {
    switch (this.mode()) {
      case 'signup':
        return 'Create your account';
      case 'reset':
        return 'Reset your password';
      default:
        return 'Welcome back';
    }
  });
  readonly description = computed(() => {
    switch (this.mode()) {
      case 'signup':
        return 'Join Rocket Prompt and save your favourite prompt templates.';
      case 'reset':
        return "Enter the email linked to your account and we'll send a reset link.";
      default:
        return 'Sign in to access your saved prompts and collections.';
    }
  });
  readonly ctaLabel = computed(() => {
    switch (this.mode()) {
      case 'signup':
        return 'Create account';
      case 'reset':
        return 'Send reset link';
      default:
        return 'Sign in';
    }
  });

  readonly authForm = this.fb.group({
    firstName: [''],
    lastName: [''],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  isSubmitting = false;
  errorMessage = '';
  successMessage = '';

  constructor() {
    this.route.queryParamMap
      .pipe(takeUntilDestroyed())
      .subscribe(params => {
        const modeParam = params.get('mode');
        const resolvedMode: AuthMode = modeParam === 'signup' ? 'signup' : modeParam === 'reset' ? 'reset' : 'login';
        this.setMode(resolvedMode, { skipNavigation: true });

        const redirectParam = params.get('redirectTo');
        this.redirectToTarget = this.normalizeRedirectTarget(redirectParam);
      });

    this.applyModeValidators(this.mode());
  }

  setMode(mode: AuthMode, options: { skipNavigation?: boolean } = {}) {
    if (this.mode() === mode) {
      return;
    }

    this.mode.set(mode);
    this.applyModeValidators(mode);
    this.errorMessage = '';

    if (mode !== 'reset') {
      this.successMessage = '';
    }

    if (!options.skipNavigation) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { mode },
        queryParamsHandling: 'merge',
        replaceUrl: true
      });
    }
  }

  async onSubmit() {
    const mode = this.mode();

    this.errorMessage = '';
    this.successMessage = '';

    if (mode === 'reset') {
      const email = this.authForm.value.email;
      if (!email) {
        this.authForm.get('email')?.markAsTouched();
        return;
      }

      this.isSubmitting = true;

      try {
        await this.authService.sendPasswordResetEmail(email);
        this.successMessage = 'Password reset link sent! Please check your inbox.';
      } catch (error) {
        this.errorMessage = this.mapError(error);
      } finally {
        this.isSubmitting = false;
      }

      return;
    }

    if (this.authForm.invalid) {
      this.authForm.markAllAsTouched();
      return;
    }

    const { firstName, lastName, email, password } = this.authForm.value;
    if (!email || !password) {
      return;
    }

    this.isSubmitting = true;

    try {
      if (mode === 'signup') {
        await this.authService.signUp({ firstName: firstName!, lastName: lastName!, email, password });
        this.successMessage =
          'Account created! We sent a verification link to your email. Please verify before signing in.';
        await this.router.navigate(['/verify-email'], { state: { email } });
      } else {
        const credential = await this.authService.signIn(email, password);
        const profile = await this.authService.fetchUserProfile(credential.user.uid);

        if (!profile) {
          await this.authService.signOut();
          throw new Error(
            'We could not find a profile for this account. Please contact support or sign up again.'
          );
        }

        if (credential.user.emailVerified) {
          const target = this.redirectToTarget ?? '/home';
          this.redirectToTarget = null;
          await this.router.navigateByUrl(target, { replaceUrl: true });
        } else {
          await this.router.navigate(['/verify-email']);
        }
      }
    } catch (error) {
      this.errorMessage = this.mapError(error);
    } finally {
      this.isSubmitting = false;
    }
  }

  private mapError(error: unknown): string {
    if (error instanceof FirebaseError) {
      switch (error.code) {
        case 'auth/email-already-in-use':
          return 'This email is already registered. Try signing in instead.';
        case 'auth/invalid-credential':
        case 'auth/wrong-password':
        case 'auth/user-not-found':
          return 'The provided credentials are incorrect. Double-check your email and password.';
        case 'auth/too-many-requests':
          return 'Too many attempts. Please wait a moment and try again.';
        default:
          return error.message;
      }
    }

    if (error instanceof Error) {
      return error.message;
    }

    return 'Something went wrong. Please try again.';
  }

  private applyModeValidators(mode: AuthMode) {
    const firstNameControl = this.authForm.get('firstName');
    const lastNameControl = this.authForm.get('lastName');
    const passwordControl = this.authForm.get('password');

    if (!firstNameControl || !lastNameControl || !passwordControl) {
      return;
    }

    if (mode === 'signup') {
      firstNameControl.setValidators([Validators.required, Validators.minLength(2)]);
      lastNameControl.setValidators([Validators.required, Validators.minLength(2)]);
    } else {
      firstNameControl.clearValidators();
      lastNameControl.clearValidators();
      firstNameControl.reset('', { emitEvent: false });
      lastNameControl.reset('', { emitEvent: false });
    }

    firstNameControl.updateValueAndValidity({ emitEvent: false });
    lastNameControl.updateValueAndValidity({ emitEvent: false });

    if (mode === 'reset') {
      passwordControl.clearValidators();
      passwordControl.reset('', { emitEvent: false });
    } else {
      passwordControl.setValidators([Validators.required, Validators.minLength(6)]);
    }

    passwordControl.updateValueAndValidity({ emitEvent: false });
  }

  private normalizeRedirectTarget(target: string | null): string | null {
    if (!target) {
      return null;
    }

    if (typeof window === 'undefined') {
      return target.startsWith('/') ? target : null;
    }

    try {
      const url = new URL(target, window.location.origin);
      if (url.origin !== window.location.origin) {
        return null;
      }
      return url.pathname + url.search + url.hash;
    } catch {
      return target.startsWith('/') ? target : null;
    }
  }
}
