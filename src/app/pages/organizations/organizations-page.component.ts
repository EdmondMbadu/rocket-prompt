import { CommonModule } from '@angular/common';
import { Component, DestroyRef, HostListener, ViewChild, ElementRef, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { OrganizationService } from '../../services/organization.service';
import type { UserProfile } from '../../models/user-profile.model';
import type { Organization } from '../../models/organization.model';

@Component({
    selector: 'app-organizations-page',
    standalone: true,
    imports: [CommonModule],
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
    readonly menuOpen = signal(false);
    readonly menuTop = signal<number | null>(null);
    readonly menuRight = signal<number | null>(null);
    @ViewChild('avatarButton') avatarButtonRef?: ElementRef<HTMLButtonElement>;

    // Organization data
    readonly userCreatedOrganization = signal<Organization | null>(null);
    readonly userMemberOrganizations = signal<Organization[]>([]);
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

                if (!profile) {
                    this.menuOpen.set(false);
                } else {
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
    }

    profileInitials(profile: UserProfile | null | undefined) {
        if (!profile) {
            return 'RP';
        }

        const firstInitial = profile.firstName?.charAt(0)?.toUpperCase() ?? '';
        const lastInitial = profile.lastName?.charAt(0)?.toUpperCase() ?? '';
        const initials = `${firstInitial}${lastInitial}`.trim();

        return initials || (profile.email?.charAt(0)?.toUpperCase() ?? 'R');
    }

    toggleMenu() {
        const isOpening = !this.menuOpen();
        this.menuOpen.update(open => !open);

        if (isOpening) {
            setTimeout(() => {
                this.updateMenuPosition();
            }, 0);
        }
    }

    private updateMenuPosition() {
        if (!this.avatarButtonRef?.nativeElement) {
            return;
        }

        const button = this.avatarButtonRef.nativeElement;
        const rect = button.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const isMobile = viewportWidth < 640;

        if (isMobile) {
            const menuHeight = 250;
            const spacing = 12;
            let topPosition = rect.bottom + spacing;

            if (topPosition + menuHeight > viewportHeight - 16) {
                topPosition = rect.top - menuHeight - spacing;
                if (topPosition < 16) {
                    topPosition = 16;
                }
            }

            this.menuTop.set(Math.max(16, Math.min(topPosition, viewportHeight - menuHeight - 16)));
            this.menuRight.set(16);
        } else {
            this.menuTop.set(rect.bottom + 12);
            this.menuRight.set(Math.max(16, viewportWidth - rect.right));
        }
    }

    closeMenu() {
        this.menuOpen.set(false);
    }

    @HostListener('document:click', ['$event'])
    handleDocumentClick(event: Event) {
        if (!this.menuOpen()) {
            return;
        }

        const target = event.target as HTMLElement | null;

        if (!target?.closest('[data-user-menu]')) {
            this.closeMenu();
        }
    }

    @HostListener('document:keydown.escape')
    handleEscape() {
        if (this.menuOpen()) {
            this.closeMenu();
        }
    }

    async signOut() {
        if (!this.profile()) {
            await this.router.navigate(['/auth'], {
                queryParams: { redirectTo: this.router.url }
            });
            return;
        }

        this.closeMenu();
        await this.authService.signOut();
        await this.router.navigate(['/']);
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
            void this.router.navigate(['/organizations', organization.id]);
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

