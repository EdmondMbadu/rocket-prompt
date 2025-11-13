import { CommonModule } from '@angular/common';
import { Component, DestroyRef, HostListener, ViewChild, ElementRef, inject, input, signal, computed, effect } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { OrganizationService } from '../../services/organization.service';
import type { UserProfile } from '../../models/user-profile.model';
import type { Organization } from '../../models/organization.model';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.css'
})
export class NavbarComponent {
  private readonly authService = inject(AuthService);
  private readonly organizationService = inject(OrganizationService);
  readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // Input: user profile (can be signal or observable)
  readonly profile = input<UserProfile | null | undefined>(null);
  
  // Internal state
  readonly menuOpen = signal(false);
  readonly menuTop = signal<number | null>(null);
  readonly menuRight = signal<number | null>(null);
  @ViewChild('avatarButton') avatarButtonRef?: ElementRef<HTMLButtonElement>;
  
  // Organizations
  readonly userOrganizations = signal<Organization[]>([]);
  readonly isLoadingOrganizations = signal(false);
  
  // Computed: check if user has organizations
  readonly hasOrganizations = computed(() => this.userOrganizations().length > 0);

  constructor() {
    // Load organizations when profile changes
    effect(() => {
      const userProfile = this.profile();
      const userId = userProfile?.userId || userProfile?.id;
      if (userId) {
        this.loadOrganizations(userId);
      } else {
        this.userOrganizations.set([]);
      }
    });
  }

  private loadOrganizations(userId: string) {
    this.isLoadingOrganizations.set(true);
    
    this.organizationService.organizationsByMember$(userId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (orgs) => {
          this.userOrganizations.set(orgs);
          this.isLoadingOrganizations.set(false);
        },
        error: (error) => {
          console.error('Failed to load organizations', error);
          this.isLoadingOrganizations.set(false);
        }
      });
  }

  profileInitials(profile: UserProfile | null | undefined): string {
    if (!profile) {
      return 'RP';
    }
    const first = profile.firstName?.charAt(0)?.toUpperCase() || '';
    const last = profile.lastName?.charAt(0)?.toUpperCase() || '';
    return (first + last) || 'RP';
  }

  getOrganizationInitials(org: Organization): string {
    if (!org.name) return 'O';
    const words = org.name.trim().split(/\s+/);
    if (words.length >= 2) {
      return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
    }
    return org.name.substring(0, 2).toUpperCase();
  }

  toggleMenu() {
    this.menuOpen.update(open => !open);
    if (!this.menuOpen()) {
      return;
    }
    this.updateMenuPosition();
  }

  closeMenu() {
    this.menuOpen.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (this.menuOpen() && this.avatarButtonRef?.nativeElement) {
      const target = event.target as Node;
      const menuElement = document.querySelector('[data-user-menu]');
      if (menuElement && !menuElement.contains(target)) {
        this.closeMenu();
      }
    }
  }

  @HostListener('window:resize')
  onWindowResize() {
    if (this.menuOpen()) {
      this.updateMenuPosition();
    }
  }

  private updateMenuPosition() {
    if (!this.avatarButtonRef?.nativeElement) {
      return;
    }

    const button = this.avatarButtonRef.nativeElement;
    const rect = button.getBoundingClientRect();
    const isMobile = window.innerWidth < 640;

    if (isMobile) {
      // On mobile, position at bottom of screen with some padding
      const padding = 16;
      this.menuTop.set(window.innerHeight - padding);
      this.menuRight.set(padding);
    } else {
      // On desktop, position below the button
      this.menuTop.set(rect.bottom + 12);
      this.menuRight.set(window.innerWidth - rect.right);
    }
  }

  navigateToOrganization(org: Organization) {
    if (org.username) {
      this.router.navigate(['/organization', org.username]);
    } else {
      // Fallback: navigate to organizations list page if no username
      this.router.navigate(['/organizations']);
    }
    this.closeMenu();
  }

  navigateToProfile() {
    this.router.navigate(['/profile']);
    this.closeMenu();
  }

  navigateToAdmin() {
    this.router.navigate(['/admin']);
    this.closeMenu();
  }

  async signOut() {
    try {
      await this.authService.signOut();
      this.closeMenu();
      this.router.navigate(['/']);
    } catch (error) {
      console.error('Sign out error:', error);
    }
  }
}

