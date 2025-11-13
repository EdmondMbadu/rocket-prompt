import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { OrganizationService } from '../../services/organization.service';
import { NavbarComponent } from '../../components/navbar/navbar.component';
import type { UserProfile } from '../../models/user-profile.model';
import type { Organization } from '../../models/organization.model';

@Component({
    selector: 'app-organizations-page',
    standalone: true,
    imports: [CommonModule, NavbarComponent],
    templateUrl: './organizations-page.component.html',
    styleUrl: './organizations-page.component.css'
})
export class OrganizationsPageComponent {
    private readonly authService = inject(AuthService);
    private readonly organizationService = inject(OrganizationService);
    readonly router = inject(Router);
    private readonly destroyRef = inject(DestroyRef);

    readonly currentUser$ = this.authService.currentUser$;
    readonly profile = signal<UserProfile | null>(null);
    readonly profileLoaded = signal(false);

    // Organization data
    readonly userCreatedOrganization = signal<Organization | null>(null);
    readonly userMemberOrganizations = signal<Organization[]>([]);
    readonly openJoinOrganizations = signal<Organization[]>([]);
    readonly isLoadingOrganizations = signal(false);

    // Computed values
    readonly canCreateOrganization = computed(() => {
        const profile = this.profile();
        if (!profile) return false;
        const subscriptionStatus = profile.subscriptionStatus;
        const role = profile.role;
        return subscriptionStatus === 'team' || role === 'admin';
    });

    readonly shouldShowUpgradePrompt = computed(() => {
        const profile = this.profile();
        if (!profile) return false;
        const subscriptionStatus = profile.subscriptionStatus;
        const role = profile.role;
        const hasCreatedOrg = this.userCreatedOrganization() !== null;
        return !hasCreatedOrg && subscriptionStatus !== 'team' && role !== 'admin';
    });

    readonly shouldShowCreateButton = computed(() => {
        const profile = this.profile();
        if (!profile) return false;
        const hasCreatedOrg = this.userCreatedOrganization() !== null;
        return !hasCreatedOrg && this.canCreateOrganization();
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

                if (profile) {
                    // Load organizations when profile is loaded
                    this.loadOrganizations(profile.userId || profile.id);
                }
            });
    }

    private loadOrganizations(userId: string) {
        this.isLoadingOrganizations.set(true);

        // Load organization created by user
        this.organizationService.organizationsByCreator$(userId)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (orgs) => {
                    // Take the first organization (user can only create one for now)
                    this.userCreatedOrganization.set(orgs.length > 0 ? orgs[0] : null);
                    this.isLoadingOrganizations.set(false);
                },
                error: (error) => {
                    console.error('Failed to load created organizations', error);
                    this.isLoadingOrganizations.set(false);
                }
            });

        // Load organizations where user is a member
        this.organizationService.organizationsByMember$(userId)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (orgs) => {
                    // Filter out the organization created by user (already shown in first section)
                    // Use a small delay to ensure created org is loaded first
                    setTimeout(() => {
                        const createdOrgId = this.userCreatedOrganization()?.id;
                        const memberOrgs = orgs.filter(org => org.id !== createdOrgId);
                        this.userMemberOrganizations.set(memberOrgs);
                    }, 100);
                },
                error: (error) => {
                    console.error('Failed to load member organizations', error);
                }
            });

        // Load organizations with open join
        this.organizationService.organizationsWithOpenJoin$()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (orgs) => {
                    // Show ALL organizations with open join - no filtering needed
                    // The organization profile page will handle showing "Already a member" vs "Join" button
                    console.log('Open join organizations (all):', orgs.length, orgs.map(o => ({ id: o.id, name: o.name })));
                    this.openJoinOrganizations.set(orgs);
                },
                error: (error) => {
                    console.error('Failed to load open join organizations', error);
                }
            });
    }


    async navigateToHomeOrLanding() {
        const user = this.authService.currentUser;
        if (user) {
            await this.router.navigate(['/home']);
        } else {
            await this.router.navigate(['/']);
        }
    }

    navigateToOrganization(organization: Organization) {
        if (organization.username) {
            void this.router.navigate(['/organization', organization.username]);
        } else {
            // Fallback: navigate to organizations list page if no username
            void this.router.navigate(['/organizations']);
        }
    }

    navigateToCreateOrganization() {
        void this.router.navigate(['/organizations/create']);
    }

    navigateToUpgrade() {
        // TODO: Navigate to pricing/upgrade page or open modal
        // For now, just show an alert
        alert('Upgrade to Team subscription to create organizations. This feature is coming soon!');
    }

    getOrganizationInitials(organization: Organization): string {
        const name = organization.name?.trim() || '';
        if (name.length === 0) return 'ORG';

        const words = name.split(/\s+/).filter(Boolean);
        if (words.length >= 2) {
            return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
        }
        return name.substring(0, 2).toUpperCase();
    }
}

