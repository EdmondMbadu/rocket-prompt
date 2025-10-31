import { Component, signal } from '@angular/core';
import { NgFor, NgIf, NgSwitch, NgSwitchCase, NgSwitchDefault } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';

interface SidebarNavItem {
  label: string;
  icon: 'home' | string;
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
  readonly collapsed = signal(false);
  readonly mobileMenuOpen = signal(false);
  readonly navItems: SidebarNavItem[] = [
    {
      label: 'Home',
      icon: 'home',
      route: '/home',
      exact: true
    }
  ];

  toggleCollapsed(): void {
    this.collapsed.update(v => !v);
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpen.update(v => !v);
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
  }
}

