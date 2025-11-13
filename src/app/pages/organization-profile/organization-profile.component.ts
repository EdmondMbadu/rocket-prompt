import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, signal, computed } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { OrganizationService } from '../../services/organization.service';
import type { Organization } from '../../models/organization.model';
import type { UserProfile } from '../../models/user-profile.model';

@Component({
  selector: 'app-organization-profile',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './organization-profile.component.html',
  styleUrl: './organization-profile.component.css'
})
export class OrganizationProfileComponent {
  private readonly authService = inject(AuthService);
  private readonly organizationService = inject(OrganizationService);
  readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  private readonly fb = inject(FormBuilder);

  readonly currentUser$ = this.authService.currentUser$;
  readonly organization = signal<Organization | null>(null);
  readonly organizationLoaded = signal(false);
  readonly currentUserProfile = signal<UserProfile | null>(null);
  readonly editingName = signal(false);
  readonly editingDescription = signal(false);
  readonly isSaving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly showFullDescription = signal(false);

  readonly nameForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]]
  });

  readonly descriptionForm = this.fb.nonNullable.group({
    description: ['', [Validators.maxLength(500)]]
  });

  readonly isViewingOwnOrganization = computed(() => {
    const currentUser = this.authService.currentUser;
    const org = this.organization();
    if (!currentUser || !org) return false;
    return org.createdBy === currentUser.uid || org.members.includes(currentUser.uid);
  });

  readonly truncatedDescription = computed(() => {
    const description = this.organization()?.description;
    if (!description) return '';
    
    const words = description.trim().split(/\s+/);
    if (words.length <= 50) return description;
    
    return words.slice(0, 50).join(' ') + '...';
  });

  readonly descriptionWordCount = computed(() => {
    const description = this.organization()?.description;
    if (!description) return 0;
    return description.trim().split(/\s+/).length;
  });

  constructor() {
    // Load organization based on route params
    this.route.params
      .pipe(
        switchMap(params => {
          const username = params['username'];
          if (username) {
            return this.organizationService.organizationByUsername$(username);
          }
          return of<Organization | undefined>(undefined);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(org => {
        if (org) {
          this.organization.set(org);
          // Initialize forms with current values
          this.nameForm.patchValue({ name: org.name });
          this.descriptionForm.patchValue({ description: org.description || '' });
        }
        this.organizationLoaded.set(true);
      });

    // Load current user profile
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
        this.currentUserProfile.set(profile ?? null);
      });
  }

  getOrganizationInitials(organization: Organization | null): string {
    if (!organization) return 'ORG';
    const name = organization.name?.trim() || '';
    if (name.length === 0) return 'ORG';
    
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  async navigateToHomeOrLanding() {
    const user = this.authService.currentUser;
    if (user) {
      await this.router.navigate(['/home']);
    } else {
      await this.router.navigate(['/']);
    }
  }

  startEditingName() {
    const org = this.organization();
    if (org) {
      this.nameForm.patchValue({ name: org.name });
      this.editingName.set(true);
    }
  }

  cancelEditingName() {
    const org = this.organization();
    if (org) {
      this.nameForm.patchValue({ name: org.name });
    }
    this.editingName.set(false);
    this.saveError.set(null);
  }

  async saveName() {
    if (this.nameForm.invalid) {
      this.nameForm.markAllAsTouched();
      return;
    }

    const org = this.organization();
    const currentUser = this.authService.currentUser;
    if (!org || !currentUser) {
      return;
    }

    const newName = this.nameForm.getRawValue().name.trim();
    if (newName === org.name) {
      this.editingName.set(false);
      return;
    }

    this.isSaving.set(true);
    this.saveError.set(null);

    try {
      await this.organizationService.updateOrganization(
        org.id,
        { name: newName },
        currentUser.uid
      );
      this.editingName.set(false);
    } catch (error) {
      console.error('Failed to update name', error);
      this.saveError.set(error instanceof Error ? error.message : 'Failed to update name. Please try again.');
    } finally {
      this.isSaving.set(false);
    }
  }

  startEditingDescription() {
    const org = this.organization();
    if (org) {
      this.descriptionForm.patchValue({ description: org.description || '' });
      this.editingDescription.set(true);
      this.showFullDescription.set(true);
    }
  }

  cancelEditingDescription() {
    const org = this.organization();
    if (org) {
      this.descriptionForm.patchValue({ description: org.description || '' });
    }
    this.editingDescription.set(false);
    this.showFullDescription.set(false);
    this.saveError.set(null);
  }

  async saveDescription() {
    if (this.descriptionForm.invalid) {
      this.descriptionForm.markAllAsTouched();
      return;
    }

    const org = this.organization();
    const currentUser = this.authService.currentUser;
    if (!org || !currentUser) {
      return;
    }

    const newDescription = this.descriptionForm.getRawValue().description.trim();
    if (newDescription === (org.description || '')) {
      this.editingDescription.set(false);
      return;
    }

    this.isSaving.set(true);
    this.saveError.set(null);

    try {
      await this.organizationService.updateOrganization(
        org.id,
        { description: newDescription || undefined },
        currentUser.uid
      );
      this.editingDescription.set(false);
      this.showFullDescription.set(false);
    } catch (error) {
      console.error('Failed to update description', error);
      this.saveError.set(error instanceof Error ? error.message : 'Failed to update description. Please try again.');
    } finally {
      this.isSaving.set(false);
    }
  }

  toggleDescription() {
    this.showFullDescription.update(v => !v);
  }

  getDescriptionWordCount(): number {
    const value = this.descriptionForm.controls.description.value;
    if (!value) return 0;
    const trimmed = value.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).filter(word => word.length > 0).length;
  }
}

