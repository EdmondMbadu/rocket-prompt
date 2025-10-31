import { Component, DestroyRef, computed, signal } from '@angular/core';
import { NgIf } from '@angular/common';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SidebarComponent } from './components/sidebar/sidebar.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NgIf, SidebarComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  private readonly hideSidebarSegments = new Set(['', 'auth', 'verify-email']);
  private readonly currentUrl = signal('');

  readonly title = signal('rocket-prompt');
  readonly showSidebar = computed(() => {
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
