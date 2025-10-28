import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { FirebaseError } from 'firebase/app';
import { AuthService } from '../../services/auth.service';

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

  readonly mode = signal<'signup' | 'login'>('signup');
  readonly heading = computed(() => (this.mode() === 'signup' ? 'Create your account' : 'Welcome back'));
  readonly ctaLabel = computed(() => (this.mode() === 'signup' ? 'Sign up' : 'Sign in'));
  readonly toggleLabel = computed(() =>
    this.mode() === 'signup' ? 'Already have an account?' : "Don't have an account?"
  );
  readonly toggleAction = computed(() => (this.mode() === 'signup' ? 'Sign in' : 'Sign up'));
  readonly mobileMenuOpen = signal(false);

  readonly authForm = this.fb.group({
    firstName: ['', [Validators.required, Validators.minLength(2)]],
    lastName: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  isSubmitting = false;
  errorMessage = '';
  successMessage = '';

  switchMode() {
    this.mode.set(this.mode() === 'signup' ? 'login' : 'signup');
    this.errorMessage = '';
    this.successMessage = '';
  }

  toggleMobileMenu() {
    this.mobileMenuOpen.update(open => !open);
  }

  closeMobileMenu() {
    this.mobileMenuOpen.set(false);
  }

  async onSubmit() {
    if (this.authForm.invalid) {
      this.authForm.markAllAsTouched();
      return;
    }

    const { firstName, lastName, email, password } = this.authForm.value;
    if (!firstName || !lastName || !email || !password) {
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      if (this.mode() === 'signup') {
        await this.authService.signUp({ firstName, lastName, email, password });
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

        const namesMatch =
          profile.firstName.trim().toLowerCase() === firstName.trim().toLowerCase() &&
          profile.lastName.trim().toLowerCase() === lastName.trim().toLowerCase();

        if (!namesMatch) {
          await this.authService.signOut();
          throw new Error('The first and last name provided do not match this account.');
        }

        if (credential.user.emailVerified) {
          await this.router.navigate(['/home']);
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
          return 'The provided credentials are incorrect. Double-check your email, password, and name.';
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
}
