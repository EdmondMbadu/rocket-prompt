import { CommonModule } from '@angular/common';
import { Component, DestroyRef, HostListener, ViewChild, ElementRef, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import type { UserProfile } from '../../models/user-profile.model';

@Component({
    selector: 'app-organizations-page',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './organizations-page.component.html',
    styleUrl: './organizations-page.component.css'
})
export class OrganizationsPageComponent {
    private readonly authService = inject(AuthService);
    readonly router = inject(Router);
    private readonly destroyRef = inject(DestroyRef);

    readonly currentUser$ = this.authService.currentUser$;
    readonly profile = signal<UserProfile | null>(null);
    readonly profileLoaded = signal(false);
    readonly menuOpen = signal(false);
    readonly menuTop = signal<number | null>(null);
    readonly menuRight = signal<number | null>(null);
    @ViewChild('avatarButton') avatarButtonRef?: ElementRef<HTMLButtonElement>;

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
}

