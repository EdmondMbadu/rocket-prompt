import { CommonModule } from '@angular/common';
import { Component, input, output, signal, computed, effect, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { PromptService } from '../../services/prompt.service';
import { AuthService } from '../../services/auth.service';
import type { Prompt, CreatePromptInput, UpdatePromptInput } from '../../models/prompt.model';
import type { PromptCard } from '../../models/prompt-card.model';
import type { UserProfile } from '../../models/user-profile.model';

export interface PromptFormData {
  title: string;
  tag: string;
  customUrl: string;
  content: string;
  isPrivate: boolean;
  imageUrl?: string;
}

@Component({
  selector: 'app-prompt-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './prompt-form.component.html',
  styleUrl: './prompt-form.component.css'
})
export class PromptFormComponent {
  private readonly fb = inject(FormBuilder);
  private readonly promptService = inject(PromptService);
  private readonly authService = inject(AuthService);

  // Inputs
  readonly initialData = input<PromptFormData | null>(null);
  readonly isEditing = input<boolean>(false);
  readonly editingPromptId = input<string | null>(null);
  readonly forkingPromptId = input<string | null>(null);
  readonly forkingPromptTitle = input<string | null>(null);
  readonly canManagePrivate = input<boolean>(false);
  readonly showBulkUploadTab = input<boolean>(false);
  readonly createPromptMode = input<'single' | 'bulk'>('single');
  readonly profile = input<UserProfile | null | undefined>(null);
  readonly tagSuggestions = input<Array<{ label: string; value: string }>>([]);
  readonly customUrlError = input<string | null>(null);
  readonly isCheckingCustomUrl = input<boolean>(false);
  readonly promptFormError = input<string | null>(null);
  readonly isSaving = input<boolean>(false);
  readonly isProcessingBulkUpload = input<boolean>(false);

  // Outputs
  readonly formSubmit = output<{ data: PromptFormData; imageFile: File | null }>();
  readonly formCancel = output<void>();
  readonly modeChange = output<'single' | 'bulk'>();
  readonly tagInput = output<string>();
  readonly tagSuggestionSelect = output<string>();
  readonly customUrlInput = output<string>();

  // Internal state
  readonly promptImageFile = signal<File | null>(null);
  readonly promptImagePreview = signal<string | null>(null);
  readonly uploadingImage = signal(false);
  readonly imageError = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(3)]],
    tag: ['', [Validators.required]],
    customUrl: [''],
    content: [''],
    isPrivate: [false]
  });

  constructor() {
    // Update form when initialData changes
    effect(() => {
      const data = this.initialData();
      if (data) {
        this.form.setValue({
          title: data.title,
          tag: data.tag,
          customUrl: data.customUrl ?? '',
          content: data.content ?? '',
          isPrivate: data.isPrivate ?? false
        });
        // Set image preview if imageUrl exists
        if (data.imageUrl) {
          this.promptImagePreview.set(data.imageUrl);
          this.promptImageFile.set(null);
        } else {
          this.removePromptImage();
        }
      }
    });
  }

  onPromptImageSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      this.imageError.set('Only image files are allowed.');
      input.value = '';
      return;
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      this.imageError.set('Image size must be less than 10MB.');
      input.value = '';
      return;
    }

    this.imageError.set(null);
    this.promptImageFile.set(file);

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      this.promptImagePreview.set(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  }

  removePromptImage() {
    this.promptImageFile.set(null);
    this.promptImagePreview.set(null);
    this.imageError.set(null);
  }

  onSubmit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const formValue = this.form.getRawValue();
    const trimmedContent = (formValue.content ?? '').trim();
    const imageFile = this.promptImageFile();

    // Validate that either content or image is provided
    if (!trimmedContent && !imageFile && !this.initialData()?.imageUrl) {
      this.form.controls.content.setErrors({ required: true });
      this.form.controls.content.markAsTouched();
      return;
    }

    // Validate content length if provided
    if (trimmedContent && trimmedContent.length < 10) {
      this.form.controls.content.setErrors({ minlength: { requiredLength: 10, actualLength: trimmedContent.length } });
      this.form.controls.content.markAsTouched();
      return;
    }

    const formData: PromptFormData = {
      title: formValue.title,
      tag: formValue.tag,
      customUrl: formValue.customUrl,
      content: trimmedContent,
      isPrivate: formValue.isPrivate,
      imageUrl: this.initialData()?.imageUrl // Preserve existing imageUrl if no new file
    };

    this.formSubmit.emit({ data: formData, imageFile });
  }

  onCancel() {
    this.formCancel.emit();
  }

  onTagInput(value: string) {
    this.tagInput.emit(value);
  }

  onTagSuggestionSelect(value: string) {
    this.form.controls.tag.setValue(value);
    this.tagSuggestionSelect.emit(value);
  }

  onCustomUrlInput(value: string) {
    this.customUrlInput.emit(value);
  }

  onModeChange(mode: 'single' | 'bulk') {
    this.modeChange.emit(mode);
  }

}

