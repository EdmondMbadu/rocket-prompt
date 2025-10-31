import { Component } from '@angular/core';
import { NgFor, NgSwitch, NgSwitchCase, NgSwitchDefault } from '@angular/common';
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
  imports: [RouterLink, RouterLinkActive, NgFor, NgSwitch, NgSwitchCase, NgSwitchDefault],
  templateUrl: './sidebar.component.html'
})
export class SidebarComponent {
  readonly navItems: SidebarNavItem[] = [
    {
      label: 'Home',
      icon: 'home',
      route: '/home',
      exact: true
    }
  ];
}

