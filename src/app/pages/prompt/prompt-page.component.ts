import { CommonModule } from '@angular/common';
import { Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PromptService } from '../../services/prompt.service';
import type { Prompt } from '../../models/prompt.model';

@Component({
  selector: 'app-prompt-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './prompt-page.component.html',
  styleUrl: './prompt-page.component.css'
})
export class PromptPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly promptService = inject(PromptService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isLoading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly prompt = signal<Prompt | undefined>(undefined);

  // Provide a small computed short id for sharing (first 8 chars)
  readonly shortId = computed(() => {
    const p = this.prompt();
    return p?.id ? p.id.slice(0, 8) : '';
  });

  constructor() {
    const idParam = String(this.route.snapshot.paramMap.get('id') ?? '');

    this.promptService
      .prompts$()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: prompts => {
          // try exact match first, then prefix match to support shortened ids
          const found = prompts.find(p => p.id === idParam) ?? prompts.find(p => p.id.startsWith(idParam));

          if (!found) {
            this.prompt.set(undefined);
            this.loadError.set('Prompt not found.');
            this.isLoading.set(false);
            return;
          }

          this.prompt.set(found);
          this.loadError.set(null);
          this.isLoading.set(false);
        },
        error: err => {
          console.error('Failed to load prompt', err);
          this.prompt.set(undefined);
          this.loadError.set('Could not load the prompt. Please try again.');
          this.isLoading.set(false);
        }
      });
  }

  back() {
    this.router.navigate(['/home']);
  }

  copyShareLink() {
    const id = this.shortId() || this.prompt()?.id;
    if (!id) return;

    const url = `${window.location.origin}/prompt/${id}`;
    void navigator.clipboard?.writeText(url);
  }

  // gracefully format date
  formatDate(date?: Date) {
    if (!date) return '';
    return new Date(date).toLocaleString();
  }
}
