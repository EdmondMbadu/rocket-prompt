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
  readonly uploadingLogo = signal(false);
  readonly uploadingCover = signal(false);
  readonly logoError = signal<string | null>(null);
  readonly coverError = signal<string | null>(null);
  readonly logoPreview = signal<string | null>(null);
  readonly coverPreview = signal<string | null>(null);

  private usernameCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private logoFile: File | null = null;
  private coverFile: File | null = null;

  readonly createOrganizationForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    description: [''],
    username: ['']
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

  async onLogoSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    
    if (!file) {
      return;
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      this.logoError.set('Only image files are allowed.');
      return;
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      this.logoError.set('Image size must be less than 5MB.');
      return;
    }

    this.logoFile = file;
    this.logoError.set(null);

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      this.logoPreview.set(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    // Reset input to allow selecting the same file again
    input.value = '';
  }

  async onCoverSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    
    if (!file) {
      return;
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      this.coverError.set('Only image files are allowed.');
      return;
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      this.coverError.set('Image size must be less than 5MB.');
      return;
    }

    this.coverFile = file;
    this.coverError.set(null);

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      this.coverPreview.set(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    // Reset input to allow selecting the same file again
    input.value = '';
  }

  removeLogo() {
    this.logoFile = null;
    this.logoPreview.set(null);
    this.logoError.set(null);
  }

  removeCover() {
    this.coverFile = null;
    this.coverPreview.set(null);
    this.coverError.set(null);
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

    const { name, description, username } = this.createOrganizationForm.getRawValue();

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
      // Create organization first
      const organizationId = await this.organizationService.createOrganization({
        name: name.trim(),
        description: description?.trim() || undefined,
        username: trimmedUsername || undefined
      }, currentUser.uid);

      // Upload logo if provided
      if (this.logoFile) {
        this.uploadingLogo.set(true);
        try {
          await this.organizationService.uploadLogo(organizationId, this.logoFile, currentUser.uid);
        } catch (error) {
          console.error('Failed to upload logo', error);
          this.logoError.set(error instanceof Error ? error.message : 'Failed to upload logo.');
        } finally {
          this.uploadingLogo.set(false);
        }
      }

      // Upload cover image if provided
      if (this.coverFile) {
        this.uploadingCover.set(true);
        try {
          await this.organizationService.uploadCoverImage(organizationId, this.coverFile, currentUser.uid);
        } catch (error) {
          console.error('Failed to upload cover image', error);
          this.coverError.set(error instanceof Error ? error.message : 'Failed to upload cover image.');
        } finally {
          this.uploadingCover.set(false);
        }
      }

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

