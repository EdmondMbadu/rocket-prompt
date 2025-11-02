import { Component, DestroyRef, inject, signal } from '@angular/core';
import { NgFor, NgIf, NgSwitch, NgSwitchCase, NgSwitchDefault } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';
import type { UserPreferences, UserProfile } from '../../models/user-profile.model';

interface SidebarNavItem {
  label: string;
  icon: 'home' | 'collections' | 'bookmark' | string;
  route: string;
  exact?: boolean;
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, NgFor, NgIf, NgSwitch, NgSwitchCase, NgSwitchDefault],
  templateUrl: './sidebar.component.html'
})
export class SidebarComponent {
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly storageKey = 'rp_sidebar_collapsed';

  private currentUserId: string | null = null;
  private lastKnownPreferences: UserPreferences = {};

  readonly collapsed = signal(false);
  readonly mobileMenuOpen = signal(false);
  readonly navItems: SidebarNavItem[] = [
    {
      label: 'Home',
      icon: 'home',
      route: '/home',
      exact: true
    },
    {
      label: 'Your Collections',
      icon: 'collections',
      route: '/collections'
    },
    {
      label: 'Saved Collections',
      icon: 'bookmark',
      route: '/collections/bookmarked'
    }
  ];

  constructor() {
    this.collapsed.set(this.loadCollapsedFromLocalStorage());
    this.observeUserPreferenceChanges();
  }

  toggleCollapsed(): void {
    const next = !this.collapsed();
    this.collapsed.set(next);
    this.storeCollapsedInLocalStorage(next);
    void this.persistCollapsedState(next);
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpen.update(v => !v);
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
  }

  private observeUserPreferenceChanges(): void {
    this.authService.currentUser$
      .pipe(
        switchMap(user => {
          this.currentUserId = user?.uid ?? null;

          if (!this.currentUserId) {
            this.lastKnownPreferences = {};
            this.collapsed.set(this.loadCollapsedFromLocalStorage());
            return EMPTY;
          }

          return this.authService.userProfile$(this.currentUserId);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: profile => this.applyProfilePreferences(profile),
        error: error => {
          console.error('Failed to load sidebar preference', error);
        }
      });
  }

  private applyProfilePreferences(profile: UserProfile | undefined): void {
    if (!profile) {
      const collapsed = this.loadCollapsedFromLocalStorage();
      this.collapsed.set(collapsed);
      this.lastKnownPreferences = {};
      return;
    }

    const sidebarCollapsed = profile.preferences?.sidebarCollapsed;

    if (typeof sidebarCollapsed === 'boolean') {
      this.collapsed.set(sidebarCollapsed);
      this.storeCollapsedInLocalStorage(sidebarCollapsed);
    } else {
      const collapsed = this.loadCollapsedFromLocalStorage();
      this.collapsed.set(collapsed);
    }

    this.lastKnownPreferences = { ...(profile.preferences ?? {}) };
    this.lastKnownPreferences.sidebarCollapsed = this.collapsed();
  }

  private loadCollapsedFromLocalStorage(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }

    try {
      const raw = window.localStorage.getItem(this.storageKey);
      return raw === 'true';
    } catch {
      return false;
    }
  }

  private storeCollapsedInLocalStorage(collapsed: boolean): void {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(this.storageKey, String(collapsed));
    } catch {
      // ignore storage errors
    }
  }

  private async persistCollapsedState(collapsed: boolean): Promise<void> {
    const uid = this.currentUserId;

    if (!uid) {
      return;
    }

    try {
      const preferences: UserPreferences = {
        ...this.lastKnownPreferences,
        sidebarCollapsed: collapsed
      };
      await this.authService.updateUserPreferences(uid, preferences);
      this.lastKnownPreferences = preferences;
    } catch (error) {
      console.error('Failed to save sidebar preference', error);
    }
  }
}

