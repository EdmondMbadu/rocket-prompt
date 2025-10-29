import { CommonModule } from '@angular/common';
import { Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { PromptService } from '../../services/prompt.service';
import type { Prompt } from '../../models/prompt.model';
import type { UserProfile } from '../../models/user-profile.model';

interface PromptCategory {
  readonly label: string;
  readonly value: string;
}

interface PromptCard {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly preview: string;
  readonly tag: string;
  readonly tagLabel: string;
  readonly customUrl?: string;
  readonly views: number;
  readonly likes: number;
  readonly createdAt?: Date;
  readonly updatedAt?: Date;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css'
})
export class HomeComponent {
  private readonly authService = inject(AuthService);
  private readonly promptService = inject(PromptService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  private readonly createPromptDefaults = {
    title: '',
    tag: '',
    customUrl: '',
    content: ''
  } as const;

  readonly currentUser$ = this.authService.currentUser$;
  readonly profile$ = this.currentUser$.pipe(
    switchMap(user => {
      if (!user) {
        return of<UserProfile | undefined>(undefined);
      }

      return this.authService.userProfile$(user.uid);
    }),
    map(profile => (profile ? profile : undefined))
  );

  readonly categories = signal<PromptCategory[]>([
    { label: 'All', value: 'all' },
    { label: 'Creative', value: 'creative' },
    { label: 'Development', value: 'development' },
    { label: 'Marketing', value: 'marketing' },
    { label: 'Analysis', value: 'analysis' },
    { label: 'Productivity', value: 'productivity' }
  ]);

  readonly prompts = signal<PromptCard[]>([]);

  readonly searchTerm = signal('');
  readonly selectedCategory = signal<PromptCategory['value']>('all');
  readonly menuOpen = signal(false);
  readonly newPromptModalOpen = signal(false);
  readonly isCreatingPrompt = signal(false);
  readonly creationError = signal<string | null>(null);
  readonly isLoadingPrompts = signal(true);
  readonly loadPromptsError = signal<string | null>(null);
  readonly deleteError = signal<string | null>(null);
  readonly deletingPromptId = signal<string | null>(null);

  readonly createPromptForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(3)]],
    tag: ['', [Validators.required]],
    customUrl: [''],
    content: ['', [Validators.required, Validators.minLength(10)]]
  });

  readonly filteredPrompts = computed(() => {
    const prompts = this.prompts();
    const term = this.searchTerm().trim().toLowerCase();
    const category = this.selectedCategory();

    return prompts.filter(prompt => {
      const matchesCategory = category === 'all' || prompt.tag === category;

      if (!matchesCategory) {
        return false;
      }

      if (!term) {
        return true;
      }

      const haystack = [
        prompt.title,
        prompt.content,
        prompt.tag,
        prompt.customUrl ?? ''
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(term);
    });
  });

  constructor() {
    this.observePrompts();
  }

  async signOut() {
    this.closeMenu();
    await this.authService.signOut();
    await this.router.navigate(['/']);
  }

  selectCategory(category: PromptCategory['value']) {
    this.selectedCategory.set(category);
  }

  onSearch(term: string) {
    this.searchTerm.set(term);
  }

  trackPromptById(_: number, prompt: PromptCard) {
    return prompt.id;
  }

  toggleMenu() {
    if (this.newPromptModalOpen()) {
      return;
    }

    this.menuOpen.update(open => !open);
  }

  closeMenu() {
    this.menuOpen.set(false);
  }

  profileInitials(profile: UserProfile | undefined) {
    if (!profile) {
      return 'RP';
    }

    const firstInitial = profile.firstName?.charAt(0)?.toUpperCase() ?? '';
    const lastInitial = profile.lastName?.charAt(0)?.toUpperCase() ?? '';
    const initials = `${firstInitial}${lastInitial}`.trim();

    return initials || (profile.email?.charAt(0)?.toUpperCase() ?? 'R');
  }

  openCreatePromptModal() {
    this.closeMenu();
    this.creationError.set(null);
    this.resetCreatePromptForm();
    this.newPromptModalOpen.set(true);
  }

  closeCreatePromptModal() {
    if (this.isCreatingPrompt()) {
      return;
    }

    this.newPromptModalOpen.set(false);
  }

  async submitCreatePrompt() {
    if (this.createPromptForm.invalid) {
      this.createPromptForm.markAllAsTouched();
      return;
    }

    const { title, tag, customUrl, content } = this.createPromptForm.getRawValue();

    this.isCreatingPrompt.set(true);
    this.creationError.set(null);

    try {
      await this.promptService.createPrompt({
        title,
        content,
        tag,
        customUrl: customUrl?.trim() ? customUrl.trim() : undefined
      });

      this.resetCreatePromptForm();
      this.newPromptModalOpen.set(false);
    } catch (error) {
      console.error('Failed to create prompt', error);
      this.creationError.set(error instanceof Error ? error.message : 'Could not create prompt. Please try again.');
    } finally {
      this.isCreatingPrompt.set(false);
    }
  }

  async onDeletePrompt(prompt: PromptCard) {
    if (this.deletingPromptId() === prompt.id) {
      return;
    }

    const confirmed = window.confirm(`Delete "${prompt.title}"? This action cannot be undone.`);

    if (!confirmed) {
      return;
    }

    this.deletingPromptId.set(prompt.id);
    this.deleteError.set(null);

    try {
      await this.promptService.deletePrompt(prompt.id);
    } catch (error) {
      console.error('Failed to delete prompt', error);
      this.deleteError.set(
        error instanceof Error ? error.message : 'Could not delete the prompt. Please try again.'
      );
    } finally {
      this.deletingPromptId.set(null);
    }
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
    if (this.newPromptModalOpen()) {
      this.closeCreatePromptModal();
      return;
    }

    if (this.menuOpen()) {
      this.closeMenu();
    }
  }

  private observePrompts() {
    this.promptService
      .prompts$()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: prompts => {
          const cards = prompts.map(prompt => this.mapPromptToCard(prompt));
          this.prompts.set(cards);
          this.syncCategories(prompts);
          this.isLoadingPrompts.set(false);
          this.loadPromptsError.set(null);
          if (this.deleteError()) {
            this.deleteError.set(null);
          }
        },
        error: error => {
          console.error('Failed to load prompts', error);
          this.isLoadingPrompts.set(false);
          this.loadPromptsError.set('We could not load your prompts. Please try again.');
        }
      });
  }

  private mapPromptToCard(prompt: Prompt): PromptCard {
    const tag = prompt.tag || 'general';

    return {
      id: prompt.id,
      title: prompt.title,
      content: prompt.content,
      preview: this.buildPreview(prompt.content),
      tag,
      tagLabel: this.formatTagLabel(tag),
      customUrl: prompt.customUrl,
      views: prompt.views ?? 0,
      likes: prompt.likes ?? 0,
      createdAt: prompt.createdAt,
      updatedAt: prompt.updatedAt
    };
  }

  private buildPreview(content: string) {
    const normalized = content?.trim() ?? '';

    if (normalized.length <= 240) {
      return normalized;
    }

    return `${normalized.slice(0, 240).trimEnd()}…`;
  }

  private formatTagLabel(tag: string) {
    if (!tag) {
      return 'General';
    }

    return tag
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private syncCategories(prompts: readonly Prompt[]) {
    const existing = this.categories();
    const existingValues = new Set(existing.map(category => category.value));
    const additions: PromptCategory[] = [];

    prompts.forEach(prompt => {
      const tag = prompt.tag?.trim();

      if (!tag || tag === 'all' || existingValues.has(tag)) {
        return;
      }

      existingValues.add(tag);
      additions.push({
        label: this.formatTagLabel(tag),
        value: tag
      });
    });

    if (additions.length) {
      additions.sort((a, b) => a.label.localeCompare(b.label));
      this.categories.set([...existing, ...additions]);
    }
  }

  private resetCreatePromptForm() {
    this.createPromptForm.reset({ ...this.createPromptDefaults });
  }
}
