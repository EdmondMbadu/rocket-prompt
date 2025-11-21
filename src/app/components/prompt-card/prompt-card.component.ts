import { Component, input, output, computed, Signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PromptCard } from '../../models/prompt-card.model';
import { UserProfile } from '../../models/user-profile.model';
import { Organization } from '../../models/organization.model';

@Component({
  selector: 'app-prompt-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './prompt-card.component.html',
  styleUrl: './prompt-card.component.css'
})
export class PromptCardComponent {
  // Required inputs
  readonly prompt = input.required<PromptCard>();
  
  // Optional inputs for helper data
  readonly authorProfile = input<UserProfile | undefined>();
  readonly organizationProfile = input<Organization | undefined>();
  readonly isUrlCopied = input<boolean>(false);
  readonly showEditActions = input<boolean>(false);
  readonly showLikeButton = input<boolean>(false);
  readonly isLiked = input<boolean>(false);
  readonly isLiking = input<boolean>(false);
  readonly isDeleting = input<boolean>(false);
  readonly isSaving = input<boolean>(false);
  readonly currentUserExists = input<boolean>(false);
  readonly defaultChatbotLabel = input<string>('ChatGPT');
  
  // Optional inputs for custom behavior
  readonly promptUrl = input<string | null>(null);
  readonly promptDisplayUrl = input<string | null>(null);
  readonly originalPromptUrl = input<string | null>(null);
  readonly canEdit = input<boolean>(false);
  
  // Event outputs
  readonly launchPrompt = output<PromptCard>();
  readonly sharePrompt = output<PromptCard>();
  readonly forkPrompt = output<PromptCard>();
  readonly openPrompt = output<PromptCard>();
  readonly editPrompt = output<PromptCard>();
  readonly deletePrompt = output<PromptCard>();
  readonly copyPrompt = output<PromptCard>();
  readonly copyPromptUrl = output<PromptCard>();
  readonly likePrompt = output<PromptCard>();
  readonly removeLike = output<PromptCard>();
  readonly navigateToAuthor = output<{ authorId: string; event: Event }>();
  readonly navigateToOrganization = output<{ organizationId: string; event: Event }>();
  readonly navigateToOriginalPrompt = output<{ prompt: PromptCard; event: Event }>();

  // Computed values
  readonly displayAuthorProfile = computed(() => {
    const profile = this.authorProfile();
    if (profile) return profile;
    return this.prompt().authorProfile;
  });

  readonly displayOrganizationProfile = computed(() => {
    const org = this.organizationProfile();
    if (org) return org;
    return this.prompt().organizationProfile;
  });

  readonly displayPromptUrl = computed(() => {
    const url = this.promptUrl();
    if (url !== null) return url;
    const prompt = this.prompt();
    if (prompt.customUrl) {
      return `/p/${prompt.customUrl}`;
    }
    return `/p/${prompt.id}`;
  });

  readonly displayPromptDisplayUrl = computed(() => {
    const displayUrl = this.promptDisplayUrl();
    if (displayUrl !== null) return displayUrl;
    const prompt = this.prompt();
    return prompt.customUrl || prompt.id;
  });

  readonly displayOriginalPromptUrl = computed(() => {
    const url = this.originalPromptUrl();
    if (url !== null) return url;
    const prompt = this.prompt();
    if (prompt.forkedFromCustomUrl) {
      return `/p/${prompt.forkedFromCustomUrl}`;
    }
    if (prompt.forkedFromPromptId) {
      return `/p/${prompt.forkedFromPromptId}`;
    }
    return null;
  });

  readonly canEditPrompt = computed(() => {
    const canEdit = this.canEdit();
    if (canEdit !== undefined) return canEdit;
    return false;
  });

  // Helper methods
  getAuthorInitials(authorId: string): string {
    const profile = this.displayAuthorProfile();
    if (profile && profile.firstName && profile.lastName) {
      return `${profile.firstName[0]}${profile.lastName[0]}`.toUpperCase();
    }
    return 'AU';
  }

  getOrganizationInitials(org: Organization | undefined): string {
    if (!org || !org.name) return 'ORG';
    const words = org.name.trim().split(/\s+/);
    if (words.length >= 2) {
      return `${words[0][0]}${words[1][0]}`.toUpperCase();
    }
    return org.name.substring(0, 2).toUpperCase();
  }

  // Event handlers
  onLaunchPrompt(event: Event): void {
    event.stopPropagation();
    this.launchPrompt.emit(this.prompt());
  }

  onSharePrompt(event: Event): void {
    event.stopPropagation();
    this.sharePrompt.emit(this.prompt());
  }

  onForkPrompt(event: Event): void {
    event.stopPropagation();
    this.forkPrompt.emit(this.prompt());
  }

  onOpenPrompt(event: Event): void {
    event.stopPropagation();
    this.openPrompt.emit(this.prompt());
  }

  onEditPrompt(event: Event): void {
    event.stopPropagation();
    this.editPrompt.emit(this.prompt());
  }

  onDeletePrompt(event: Event): void {
    event.stopPropagation();
    this.deletePrompt.emit(this.prompt());
  }

  onCopyPrompt(event: Event): void {
    event.stopPropagation();
    this.copyPrompt.emit(this.prompt());
  }

  onCopyPromptUrl(event: Event): void {
    event.stopPropagation();
    this.copyPromptUrl.emit(this.prompt());
  }

  onLikePrompt(event: Event): void {
    event.stopPropagation();
    this.likePrompt.emit(this.prompt());
  }

  onRemoveLike(event: Event): void {
    event.stopPropagation();
    this.removeLike.emit(this.prompt());
  }

  onNavigateToAuthor(authorId: string, event: Event): void {
    event.stopPropagation();
    this.navigateToAuthor.emit({ authorId, event });
  }

  onNavigateToOrganization(organizationId: string, event: Event): void {
    event.stopPropagation();
    this.navigateToOrganization.emit({ organizationId, event });
  }

  onNavigateToOriginalPrompt(event: Event): void {
    event.stopPropagation();
    this.navigateToOriginalPrompt.emit({ prompt: this.prompt(), event });
  }
}

