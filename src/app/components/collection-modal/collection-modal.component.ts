import { CommonModule } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { DirectLaunchTarget } from '../../models/user-profile.model';

export interface CollectionPromptOption {
  readonly id: string;
  readonly title: string;
  readonly tagLabel?: string;
  readonly tag?: string;
}

export interface CollectionChatbotOption {
  readonly id: DirectLaunchTarget;
  readonly label: string;
  readonly icon: string;
}

@Component({
  selector: 'app-collection-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './collection-modal.component.html',
  styleUrl: './collection-modal.component.css'
})
export class CollectionModalComponent {
  readonly isOpen = input.required<boolean>();
  readonly isSaving = input(false);
  readonly form = input.required<FormGroup>();
  readonly disableSubmit = input(false);
  readonly formError = input<string | null>(null);
  readonly title = input('New Collection');
  readonly description = input<string | null>('Group your favorite prompts into a reusable set.');
  readonly customUrlPrefix = input('rocketprompt.io/collection/');
  readonly customUrlError = input<string | null>(null);
  readonly isCheckingCustomUrl = input(false);
  readonly promptSectionTitle = input('Select prompts');
  readonly promptSearchTerm = input('');
  readonly promptSearchPlaceholder = input('Search prompts by title or tag…');
  readonly showPromptSearch = input(true);
  readonly prompts = input<readonly CollectionPromptOption[]>([]);
  readonly hasPromptOptions = input(true);
  readonly isLoadingPrompts = input(false);
  readonly promptLoadError = input<string | null>(null);
  readonly noPromptsTitle = input('No prompts found');
  readonly noPromptsDescription = input('Create prompts first to build a collection.');
  readonly selectedPromptIds = input<readonly string[]>([]);
  readonly chatbotOptions = input<readonly CollectionChatbotOption[]>([]);
  readonly defaultAi = input<DirectLaunchTarget | null>(null);
  readonly showDefaultAi = input(true);
  readonly enableBranding = input(false);
  readonly brandingSectionExpanded = input(false);
  readonly brandSectionDescription = input(
    'Add your company logo, link, and a short description to brand this collection.'
  );
  readonly brandLogoUrl = input<string | null>(null);
  readonly uploadingBrandLogo = input(false);
  readonly brandLogoUploadError = input<string | null>(null);
  readonly brandSubtextWordCount = input(0);
  readonly brandSubtextLimit = input(50);
  readonly submitButtonLabel = input('Save Collection');
  readonly cancelButtonLabel = input('Cancel');
  readonly showPromptSection = input(true);

  readonly close = output<void>();
  readonly formSubmit = output<void>();
  readonly customUrlInput = output<string>();
  readonly promptSearchChange = output<string>();
  readonly promptSearchCleared = output<void>();
  readonly promptSelectionToggle = output<string>();
  readonly defaultAiChange = output<DirectLaunchTarget | null>();
  readonly brandLogoSelected = output<Event>();
  readonly brandLogoRemoved = output<void>();
  readonly toggleBrandingSection = output<void>();

  // Private collection feature
  readonly isPrivate = input(false);
  readonly canUsePrivateCollections = input(true);
  readonly togglePrivate = output<void>();

  onTogglePrivate(): void {
    this.togglePrivate.emit();
  }

  onClose(): void {
    this.close.emit();
  }

  stopPropagation(event: Event): void {
    event.stopPropagation();
  }

  onSubmit(): void {
    this.formSubmit.emit();
  }

  onCustomUrlInput(value: string): void {
    this.customUrlInput.emit(value);
  }

  onPromptSearch(value: string): void {
    this.promptSearchChange.emit(value);
  }

  onClearPromptSearch(): void {
    this.promptSearchCleared.emit();
  }

  onTogglePromptSelection(promptId: string): void {
    this.promptSelectionToggle.emit(promptId);
  }

  onDefaultAiChange(option: DirectLaunchTarget | null): void {
    this.defaultAiChange.emit(option);
  }

  onBrandLogoInput(event: Event): void {
    this.brandLogoSelected.emit(event);
  }

  onRemoveBrandLogo(): void {
    this.brandLogoRemoved.emit();
  }

  onToggleBrandingSection(): void {
    this.toggleBrandingSection.emit();
  }

  isPromptSelected(promptId: string): boolean {
    return (this.selectedPromptIds() ?? []).includes(promptId);
  }

  trackPromptById(_: number, prompt: CollectionPromptOption): string {
    return prompt.id;
  }

  promptTagLabel(prompt: CollectionPromptOption): string {
    if (prompt.tagLabel && prompt.tagLabel.trim().length > 0) {
      return prompt.tagLabel;
    }
    if (prompt.tag && prompt.tag.trim().length > 0) {
      return prompt.tag;
    }
    return 'General';
  }

  get customUrlValue(): string {
    const control = this.form().get('customUrl');
    const value = control?.value;
    return typeof value === 'string' ? value.trim() : '';
  }

  get shouldShowCustomUrlPreview(): boolean {
    return (
      !!this.customUrlValue &&
      !this.customUrlError() &&
      !this.isCheckingCustomUrl()
    );
  }

  get hasFilteredPrompts(): boolean {
    return (this.prompts()?.length ?? 0) > 0;
  }

  get isSearching(): boolean {
    return this.promptSearchTerm().trim().length > 0;
  }

  get promptIdsInvalid(): boolean {
    const control = this.form().get('promptIds');
    return !!control && control.invalid && (control.dirty || control.touched);
  }

  get promptIdsControlMissing(): boolean {
    return !this.form().get('promptIds');
  }
}
