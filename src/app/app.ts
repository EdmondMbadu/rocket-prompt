import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { NgIf } from '@angular/common';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { filter, map } from 'rxjs';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NgIf, SidebarComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  private readonly authService = inject(AuthService);
  private readonly hideSidebarSegments = new Set(['', 'auth', 'verify-email']);
  private readonly currentUrl = signal('');
  private readonly currentUser = toSignal(
    this.authService.currentUser$.pipe(map(user => user !== null)),
    { initialValue: false }
  );

  readonly title = signal('rocket-prompt');
  readonly showSidebar = computed(() => {
    // Don't show sidebar if user is not logged in
    if (!this.currentUser()) {
      return false;
    }
    const primarySegment = this.extractPrimarySegment(this.currentUrl());
    return !this.hideSidebarSegments.has(primarySegment);
  });

  constructor(private readonly router: Router, destroyRef: DestroyRef) {
    this.currentUrl.set(this.router.url);
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(destroyRef)
      )
      .subscribe(event => {
        this.currentUrl.set(event.urlAfterRedirects);
      });
  }

  private extractPrimarySegment(url: string): string {
    const pathname = url.split('?')[0];
    const segments = pathname.split('/').filter(Boolean);
    return segments[0] ?? '';
  }
}
