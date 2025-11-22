import { CommonModule, DOCUMENT } from '@angular/common';
import { ApplicationRef, Component, DestroyRef, HostListener, ViewChild, ElementRef, TemplateRef, EmbeddedViewRef, inject, input, signal, computed, effect } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { OrganizationService } from '../../services/organization.service';
import type { UserProfile } from '../../models/user-profile.model';
import type { Organization } from '../../models/organization.model';
import { getSubscriptionDetails } from '../../utils/subscription.util';

interface MenuTemplateContext {
  profile: UserProfile | null | undefined;
}

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
  private readonly appRef = inject(ApplicationRef);
  private readonly document = inject(DOCUMENT);

  // Input: user profile (can be signal or observable)
  readonly profile = input<UserProfile | null | undefined>(null);
  
  // Internal state
  readonly menuOpen = signal(false);
  readonly menuTop = signal<number | null>(null);
  readonly menuRight = signal<number | null>(null);
  @ViewChild('avatarButton') avatarButtonRef?: ElementRef<HTMLButtonElement>;
  @ViewChild('menuTemplate') menuTemplate?: TemplateRef<MenuTemplateContext>;
  readonly isMobileMenuPortaled = signal(false);
  readonly menuInstanceId = `user-menu-${Math.random().toString(36).slice(2, 9)}`;
  private mobileMenuViewRef?: EmbeddedViewRef<MenuTemplateContext>;
  
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

    effect(() => {
      if (this.mobileMenuViewRef) {
        this.mobileMenuViewRef.context.profile = this.profile();
        this.mobileMenuViewRef.detectChanges();
      }
    });

    this.destroyRef.onDestroy(() => {
      this.detachMobileMenuPortal();
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
      this.detachMobileMenuPortal();
      return;
    }
    this.updateMenuPosition();
    this.syncMobileMenuPortal();
  }

  closeMenu() {
    this.menuOpen.set(false);
    this.detachMobileMenuPortal();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!this.menuOpen()) {
      return;
    }

    const target = event.target as Node;
    const container = this.document?.querySelector(`[data-user-menu-instance="${this.menuInstanceId}"]`);
    const panel = this.document?.querySelector(`[data-menu-panel-id="${this.menuInstanceId}"]`);
    const backdrop = this.document?.querySelector(`[data-menu-backdrop-id="${this.menuInstanceId}"]`);
    const clickedInsideContainer = !!container && container.contains(target);
    const clickedInsidePanel = !!panel && panel.contains(target);
    const clickedBackdrop = !!backdrop && backdrop.contains(target);

    if (!clickedInsideContainer && !clickedInsidePanel && !clickedBackdrop) {
      this.closeMenu();
    }
  }

  @HostListener('window:resize')
  onWindowResize() {
    if (this.menuOpen()) {
      this.updateMenuPosition();
    }
    this.syncMobileMenuPortal();
  }

  private updateMenuPosition() {
    if (!this.avatarButtonRef?.nativeElement) {
      return;
    }

    const button = this.avatarButtonRef.nativeElement;
    const rect = button.getBoundingClientRect();
    const isMobile = window.innerWidth < 640;

    requestAnimationFrame(() => {
      const panel = this.document?.querySelector(`[data-menu-panel-id="${this.menuInstanceId}"]`) as HTMLElement | null;
      const panelHeight = panel?.offsetHeight ?? 0;
      const padding = 16;

      if (isMobile) {
        const desiredTop = rect.bottom + 12;
        const maxTop = Math.max(padding, window.innerHeight - padding - panelHeight);
        const clampedTop = Math.min(desiredTop, maxTop);
        this.menuTop.set(clampedTop);
        this.menuRight.set(padding);
      } else {
        this.menuTop.set(rect.bottom + 12);
        this.menuRight.set(window.innerWidth - rect.right);
      }

      this.syncMobileMenuPortal();
    });
  }

  private shouldUseMobilePortal(): boolean {
    return typeof window !== 'undefined' && window.innerWidth < 640;
  }

  private syncMobileMenuPortal() {
    if (this.menuOpen() && this.shouldUseMobilePortal()) {
      this.attachMobileMenuPortal();
    } else {
      this.detachMobileMenuPortal();
    }
  }

  private attachMobileMenuPortal() {
    if (!this.menuTemplate || this.mobileMenuViewRef || !this.document?.body) {
      return;
    }

    const viewRef = this.menuTemplate.createEmbeddedView({
      profile: this.profile()
    });
    this.appRef.attachView(viewRef);
    const fragment = this.document.createDocumentFragment();
    viewRef.rootNodes.forEach(node => fragment.appendChild(node));
    this.document.body.appendChild(fragment);
    this.mobileMenuViewRef = viewRef;
    this.isMobileMenuPortaled.set(true);
    viewRef.detectChanges();
  }

  private detachMobileMenuPortal() {
    if (!this.mobileMenuViewRef) {
      this.isMobileMenuPortaled.set(false);
      return;
    }

    this.mobileMenuViewRef.rootNodes.forEach(node => {
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
    });
    this.appRef.detachView(this.mobileMenuViewRef);
    this.mobileMenuViewRef.destroy();
    this.mobileMenuViewRef = undefined;
    this.isMobileMenuPortaled.set(false);
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

  subscriptionDetails(status?: string | null) {
    return getSubscriptionDetails(status);
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
