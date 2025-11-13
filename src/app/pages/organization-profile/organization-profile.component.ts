import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, signal, computed } from '@angular/core';
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
  imports: [CommonModule],
  templateUrl: './organization-profile.component.html',
  styleUrl: './organization-profile.component.css'
})
export class OrganizationProfileComponent {
  private readonly authService = inject(AuthService);
  private readonly organizationService = inject(OrganizationService);
  readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly currentUser$ = this.authService.currentUser$;
  readonly organization = signal<Organization | null>(null);
  readonly organizationLoaded = signal(false);
  readonly currentUserProfile = signal<UserProfile | null>(null);

  readonly isViewingOwnOrganization = computed(() => {
    const currentUser = this.authService.currentUser;
    const org = this.organization();
    if (!currentUser || !org) return false;
    return org.createdBy === currentUser.uid || org.members.includes(currentUser.uid);
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

  navigateToEdit() {
    const org = this.organization();
    if (org) {
      void this.router.navigate(['/organizations', org.id, 'edit']);
    }
  }
}

