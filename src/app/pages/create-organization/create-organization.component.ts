import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { OrganizationService } from '../../services/organization.service';
import type { UserProfile } from '../../models/user-profile.model';

@Component({
  selector: 'app-create-organization',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './create-organization.component.html',
  styleUrl: './create-organization.component.css'
})
export class CreateOrganizationComponent {
  private readonly authService = inject(AuthService);
  private readonly organizationService = inject(OrganizationService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);

  readonly currentUser$ = this.authService.currentUser$;
  readonly profile = signal<UserProfile | null>(null);
  readonly profileLoaded = signal(false);
  readonly isCreating = signal(false);
  readonly error = signal<string | null>(null);
  readonly usernameError = signal<string | null>(null);
  readonly isCheckingUsername = signal(false);

  private usernameCheckTimer: ReturnType<typeof setTimeout> | null = null;

  readonly createOrganizationForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    description: [''],
    username: [''],
    logoUrl: [''],
    coverImageUrl: ['']
  });

  constructor() {
    this.currentUser$
      .pipe(
        switchMap(user => {
          if (!user) {
            return of<UserProfile | null>(null);
          }
          return this.authService.userProfile$(user.uid);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(profile => {
        this.profile.set(profile ?? null);
        this.profileLoaded.set(true);

        // Check if user can create organization
        if (profile) {
          const subscriptionStatus = profile.subscriptionStatus;
          const role = profile.role;
          if (subscriptionStatus !== 'team' && role !== 'admin') {
            // Redirect to organizations page if user can't create
            void this.router.navigate(['/organizations']);
          }
        }
      });
  }

  onUsernameInput(value: string) {
    const trimmed = String(value ?? '').trim();
    this.createOrganizationForm.controls.username.setValue(trimmed, { emitEvent: false });
    
    if (this.usernameCheckTimer) {
      clearTimeout(this.usernameCheckTimer);
    }

    if (!trimmed) {
      this.usernameError.set(null);
      this.isCheckingUsername.set(false);
      return;
    }

    const usernamePattern = /^[a-z0-9-]+$/i;
    if (!usernamePattern.test(trimmed)) {
      this.usernameError.set('Username can only contain letters, numbers, and hyphens.');
      this.isCheckingUsername.set(false);
      return;
    }

    this.isCheckingUsername.set(true);
    this.usernameError.set(null);
    
    this.usernameCheckTimer = setTimeout(async () => {
      try {
        const isTaken = await this.organizationService.isUsernameTaken(trimmed);
        if (isTaken) {
          this.usernameError.set('This username is already taken. Please choose a different one.');
        } else {
          this.usernameError.set(null);
        }
      } catch (error) {
        console.error('Failed to check username', error);
        this.usernameError.set('Unable to verify username availability. Please try again.');
      } finally {
        this.isCheckingUsername.set(false);
      }
    }, 500);
  }

  async onSubmit() {
    if (this.createOrganizationForm.invalid) {
      this.createOrganizationForm.markAllAsTouched();
      return;
    }

    const currentUser = this.authService.currentUser;
    if (!currentUser) {
      this.error.set('You must be signed in to create an organization.');
      return;
    }

    const { name, description, username, logoUrl, coverImageUrl } = this.createOrganizationForm.getRawValue();

    // Check username availability one more time
    const trimmedUsername = username?.trim();
    if (trimmedUsername) {
      const isTaken = await this.organizationService.isUsernameTaken(trimmedUsername);
      if (isTaken) {
        this.usernameError.set('This username is already taken. Please choose a different one.');
        return;
      }
    }

    this.isCreating.set(true);
    this.error.set(null);

    try {
      const organizationId = await this.organizationService.createOrganization({
        name: name.trim(),
        description: description?.trim() || undefined,
        username: trimmedUsername || undefined,
        logoUrl: logoUrl?.trim() || undefined,
        coverImageUrl: coverImageUrl?.trim() || undefined
      }, currentUser.uid);

      // Navigate to the organization profile
      const org = await this.organizationService.fetchOrganization(organizationId);
      if (org?.username) {
        await this.router.navigate(['/organization', org.username]);
      } else {
        await this.router.navigate(['/organizations']);
      }
    } catch (error) {
      console.error('Failed to create organization', error);
      this.error.set(error instanceof Error ? error.message : 'Failed to create organization. Please try again.');
    } finally {
      this.isCreating.set(false);
    }
  }

  async navigateToHomeOrLanding() {
    const user = this.authService.currentUser;
    if (user) {
      await this.router.navigate(['/home']);
    } else {
      await this.router.navigate(['/']);
    }
  }

  async cancel() {
    await this.router.navigate(['/organizations']);
  }
}

