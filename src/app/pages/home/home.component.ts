import { CommonModule } from '@angular/common';
import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { map, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import type { UserProfile } from '../../models/user-profile.model';

interface PromptCategory {
  readonly label: string;
  readonly value: string;
}

interface PromptCard {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly snippet: string;
  readonly category: string;
  readonly categoryLabel: string;
  readonly views: number;
  readonly favorites: number;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css'
})
export class HomeComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

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

  readonly categories: readonly PromptCategory[] = [
    { label: 'All', value: 'all' },
    { label: 'Creative', value: 'creative' },
    { label: 'Development', value: 'development' },
    { label: 'Marketing', value: 'marketing' },
    { label: 'Analysis', value: 'analysis' },
    { label: 'Productivity', value: 'productivity' }
  ];

  readonly prompts = signal<readonly PromptCard[]>([
    {
      id: 'creative-story-writer',
      title: 'Creative Story Writer',
      description: 'Generate engaging creative stories with plot twists',
      snippet:
        'You are a creative story writer. Write an engaging story about [TOPIC]. Include vivid descriptions, emotional depth, and an unexpected twist in the final act...',
      category: 'creative',
      categoryLabel: 'creative',
      views: 245,
      favorites: 89
    },
    {
      id: 'code-reviewer',
      title: 'Code Reviewer',
      description: 'Get comprehensive code reviews with actionable feedback',
      snippet:
        'Review the following code and provide detailed feedback on: 1) Code quality 2) Best practices 3) Potential bugs 4) Suggested improvements 5) Test coverage...',
      category: 'development',
      categoryLabel: 'development',
      views: 512,
      favorites: 143
    },
    {
      id: 'marketing-copy-expert',
      title: 'Marketing Copy Expert',
      description: 'Generate persuasive marketing copy that converts',
      snippet:
        'Create compelling marketing copy for [PRODUCT/SERVICE]. Target audience: [AUDIENCE]. Tone: [TONE]. Include a strong hook, benefit-driven bullets, and a clear CTA...',
      category: 'marketing',
      categoryLabel: 'marketing',
      views: 387,
      favorites: 102
    },
    {
      id: 'data-analysis-assistant',
      title: 'Data Analysis Assistant',
      description: 'Extract insights and recommendations from data',
      snippet:
        'Analyze the following data and provide: 1) Key insights 2) Trends and patterns 3) Statistical summary 4) Actionable recommendations 5) Risks or anomalies...',
      category: 'analysis',
      categoryLabel: 'analysis',
      views: 408,
      favorites: 120
    },
    {
      id: 'social-media-manager',
      title: 'Social Media Manager',
      description: 'Plan and generate social media content calendars',
      snippet:
        'Create a week of social media posts for [BRAND] on [PLATFORM]. Include hashtags, emojis, and engaging CTAs. Maintain a consistent voice that matches the brand...',
      category: 'marketing',
      categoryLabel: 'marketing',
      views: 298,
      favorites: 87
    },
    {
      id: 'meeting-summarizer',
      title: 'Meeting Summarizer',
      description: 'Turn meeting notes into actionable summaries',
      snippet:
        'Summarize the following meeting notes into: 1) Key decisions 2) Action items with owners 3) Deadlines 4) Risks or blockers 5) Follow-up questions...',
      category: 'productivity',
      categoryLabel: 'productivity',
      views: 334,
      favorites: 91
    }
  ]);

  readonly searchTerm = signal('');
  readonly selectedCategory = signal<PromptCategory['value']>('all');
  readonly menuOpen = signal(false);

  readonly filteredPrompts = computed(() => {
    const prompts = this.prompts();
    const term = this.searchTerm().trim().toLowerCase();
    const category = this.selectedCategory();

    return prompts.filter(prompt => {
      const matchesCategory = category === 'all' || prompt.category === category;

      if (!matchesCategory) {
        return false;
      }

      if (!term) {
        return true;
      }

      const haystack = [prompt.title, prompt.description, prompt.snippet, prompt.categoryLabel]
        .join(' ')
        .toLowerCase();

      return haystack.includes(term);
    });
  });

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
}
