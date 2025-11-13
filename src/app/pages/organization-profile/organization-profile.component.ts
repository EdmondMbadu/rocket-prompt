import { CommonModule } from '@angular/common';
import { Component, DestroyRef, HostListener, ViewChild, ElementRef, inject, signal, computed } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { OrganizationService } from '../../services/organization.service';
import { PromptService } from '../../services/prompt.service';
import type { Organization } from '../../models/organization.model';
import type { UserProfile } from '../../models/user-profile.model';
import type { CreatePromptInput } from '../../models/prompt.model';

@Component({
  selector: 'app-organization-profile',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './organization-profile.component.html',
  styleUrl: './organization-profile.component.css'
})
export class OrganizationProfileComponent {
  private readonly authService = inject(AuthService);
  private readonly organizationService = inject(OrganizationService);
  private readonly promptService = inject(PromptService);
  readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  private readonly fb = inject(FormBuilder);

  readonly currentUser$ = this.authService.currentUser$;
  readonly organization = signal<Organization | null>(null);
  readonly organizationLoaded = signal(false);
  readonly currentUserProfile = signal<UserProfile | null>(null);
  readonly editingName = signal(false);
  readonly editingDescription = signal(false);
  readonly isSaving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly showFullDescription = signal(false);
  
  // Menu state
  readonly menuOpen = signal(false);
  readonly menuTop = signal<number | null>(null);
  readonly menuRight = signal<number | null>(null);
  @ViewChild('avatarButton') avatarButtonRef?: ElementRef<HTMLButtonElement>;
  
  // Image upload state
  readonly uploadingLogo = signal(false);
  readonly uploadingCover = signal(false);
  readonly logoError = signal<string | null>(null);
  readonly coverError = signal<string | null>(null);

  readonly nameForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]]
  });

  readonly descriptionForm = this.fb.nonNullable.group({
    description: ['', [Validators.maxLength(10000)]]
  });
  
  readonly organizationUrlCopied = signal(false);

  // Prompt creation state
  readonly newPromptModalOpen = signal(false);
  readonly isSavingPrompt = signal(false);
  readonly promptFormError = signal<string | null>(null);
  readonly customUrlError = signal<string | null>(null);
  readonly isCheckingCustomUrl = signal(false);
  private customUrlTimer: ReturnType<typeof setTimeout> | null = null;

  readonly createPromptForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(3)]],
    tag: ['', [Validators.required]],
    customUrl: [''],
    content: ['', [Validators.required, Validators.minLength(10)]],
    isPrivate: [false]
  });

  readonly isViewingOwnOrganization = computed(() => {
    const currentUser = this.authService.currentUser;
    const org = this.organization();
    if (!currentUser || !org) return false;
    return org.createdBy === currentUser.uid || org.members.includes(currentUser.uid);
  });

  readonly truncatedDescription = computed(() => {
    const description = this.organization()?.description;
    if (!description) return '';
    
    const words = description.trim().split(/\s+/);
    if (words.length <= 50) return description;
    
    return words.slice(0, 50).join(' ') + '...';
  });

  readonly descriptionWordCount = computed(() => {
    const description = this.organization()?.description;
    if (!description) return 0;
    return description.trim().split(/\s+/).length;
  });

  constructor() {
    // Load organization based on route params
    this.route.params
      .pipe(
        switchMap(params => {
          const username = params['username'];
          if (username) {
            return this.organizationService.organizationByUsername$(username);
          }
          return of<Organization | undefined>(undefined);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(org => {
        if (org) {
          this.organization.set(org);
          // Initialize forms with current values
          this.nameForm.patchValue({ name: org.name });
          this.descriptionForm.patchValue({ description: org.description || '' });
        }
        this.organizationLoaded.set(true);
      });

    // Load current user profile
    this.currentUser$
      .pipe(
        switchMap(user => {
          if (!user) {
            return of<UserProfile | null>(null);
          }
          return this.authService.userProfile$(user.uid);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(profile => {
        this.currentUserProfile.set(profile ?? null);
      });
  }

  getOrganizationInitials(organization: Organization | null): string {
    if (!organization) return 'ORG';
    const name = organization.name?.trim() || '';
    if (name.length === 0) return 'ORG';
    
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  async navigateToHomeOrLanding() {
    const user = this.authService.currentUser;
    if (user) {
      await this.router.navigate(['/home']);
    } else {
      await this.router.navigate(['/']);
    }
  }

  startEditingName() {
    const org = this.organization();
    if (org) {
      this.nameForm.patchValue({ name: org.name });
      this.editingName.set(true);
    }
  }

  cancelEditingName() {
    const org = this.organization();
    if (org) {
      this.nameForm.patchValue({ name: org.name });
    }
    this.editingName.set(false);
    this.saveError.set(null);
  }

  async saveName() {
    if (this.nameForm.invalid) {
      this.nameForm.markAllAsTouched();
      return;
    }

    const org = this.organization();
    const currentUser = this.authService.currentUser;
    if (!org || !currentUser) {
      return;
    }

    const newName = this.nameForm.getRawValue().name.trim();
    if (newName === org.name) {
      this.editingName.set(false);
      return;
    }

    this.isSaving.set(true);
    this.saveError.set(null);

    try {
      await this.organizationService.updateOrganization(
        org.id,
        { name: newName },
        currentUser.uid
      );
      this.editingName.set(false);
    } catch (error) {
      console.error('Failed to update name', error);
      this.saveError.set(error instanceof Error ? error.message : 'Failed to update name. Please try again.');
    } finally {
      this.isSaving.set(false);
    }
  }

  startEditingDescription() {
    const org = this.organization();
    if (org) {
      this.descriptionForm.patchValue({ description: org.description || '' });
      this.editingDescription.set(true);
      this.showFullDescription.set(true);
    }
  }

  cancelEditingDescription() {
    const org = this.organization();
    if (org) {
      this.descriptionForm.patchValue({ description: org.description || '' });
    }
    this.editingDescription.set(false);
    this.showFullDescription.set(false);
    this.saveError.set(null);
  }

  async saveDescription() {
    if (this.descriptionForm.invalid) {
      this.descriptionForm.markAllAsTouched();
      return;
    }

    // Check word count
    const wordCount = this.getDescriptionWordCount();
    if (wordCount > 1000) {
      this.saveError.set('Description must be 1000 words or less.');
      return;
    }

    const org = this.organization();
    const currentUser = this.authService.currentUser;
    if (!org || !currentUser) {
      return;
    }

    const newDescription = this.descriptionForm.getRawValue().description.trim();
    if (newDescription === (org.description || '')) {
      this.editingDescription.set(false);
      return;
    }

    this.isSaving.set(true);
    this.saveError.set(null);

    try {
      await this.organizationService.updateOrganization(
        org.id,
        { description: newDescription || undefined },
        currentUser.uid
      );
      this.editingDescription.set(false);
      this.showFullDescription.set(false);
    } catch (error) {
      console.error('Failed to update description', error);
      this.saveError.set(error instanceof Error ? error.message : 'Failed to update description. Please try again.');
    } finally {
      this.isSaving.set(false);
    }
  }

  toggleDescription() {
    this.showFullDescription.update(v => !v);
  }

  getDescriptionWordCount(): number {
    const value = this.descriptionForm.controls.description.value;
    if (!value) return 0;
    const trimmed = value.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).filter(word => word.length > 0).length;
  }

  getOrganizationUrl(organization: Organization | null): string {
    if (!organization) return '';
    
    const username = organization.username;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    
    if (username) {
      return `${origin}/organization/${username}`;
    }
    
    // Fallback to ID if no username
    return `${origin}/organizations/${organization.id}`;
  }

  async copyOrganizationUrl() {
    const org = this.organization();
    if (!org) return;

    const url = this.getOrganizationUrl(org);

    try {
      await navigator.clipboard.writeText(url);
      this.showCopyMessage('Organization URL copied!');
      this.markOrganizationUrlAsCopied();
    } catch (e) {
      this.fallbackCopyTextToClipboard(url);
      this.showCopyMessage('Organization URL copied!');
      this.markOrganizationUrlAsCopied();
    }
  }

  private markOrganizationUrlAsCopied() {
    this.organizationUrlCopied.set(true);

    const DURATION = 2500;

    setTimeout(() => {
      this.organizationUrlCopied.set(false);
    }, DURATION);
  }

  private showCopyMessage(messageText: string) {
    const message = document.createElement('div');
    message.className = 'fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 transition-all';
    message.textContent = messageText;

    document.body.appendChild(message);

    setTimeout(() => {
      message.remove();
    }, 3000);
  }

  private fallbackCopyTextToClipboard(text: string) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
  }

  // Menu methods
  toggleMenu() {
    const isOpening = !this.menuOpen();
    this.menuOpen.update(open => !open);

    if (isOpening) {
      setTimeout(() => {
        this.updateMenuPosition();
      }, 0);
    }
  }

  private updateMenuPosition() {
    if (!this.avatarButtonRef?.nativeElement) {
      return;
    }

    const button = this.avatarButtonRef.nativeElement;
    const rect = button.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const isMobile = viewportWidth < 640;

    if (isMobile) {
      const menuHeight = 250;
      const spacing = 12;
      let topPosition = rect.bottom + spacing;

      if (topPosition + menuHeight > viewportHeight - 16) {
        topPosition = rect.top - menuHeight - spacing;
        if (topPosition < 16) {
          topPosition = 16;
        }
      }

      this.menuTop.set(Math.max(16, Math.min(topPosition, viewportHeight - menuHeight - 16)));
      this.menuRight.set(16);
    } else {
      this.menuTop.set(rect.bottom + 12);
      this.menuRight.set(Math.max(16, viewportWidth - rect.right));
    }
  }

  closeMenu() {
    this.menuOpen.set(false);
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

  async signOut() {
    if (!this.currentUserProfile()) {
      await this.router.navigate(['/auth'], {
        queryParams: { redirectTo: this.router.url }
      });
      return;
    }

    this.closeMenu();
    await this.authService.signOut();
    await this.router.navigate(['/']);
  }

  profileInitials(profile: UserProfile | null | undefined) {
    if (!profile) {
      return 'RP';
    }

    const firstInitial = profile.firstName?.charAt(0)?.toUpperCase() ?? '';
    const lastInitial = profile.lastName?.charAt(0)?.toUpperCase() ?? '';
    const initials = `${firstInitial}${lastInitial}`.trim();

    return initials || (profile.email?.charAt(0)?.toUpperCase() ?? 'R');
  }

  // Image upload methods
  async onLogoSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    
    if (!file) {
      return;
    }

    const org = this.organization();
    const currentUser = this.authService.currentUser;
    if (!org || !currentUser) {
      return;
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      this.logoError.set('Only image files are allowed.');
      return;
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      this.logoError.set('Image size must be less than 5MB.');
      return;
    }

    this.uploadingLogo.set(true);
    this.logoError.set(null);

    try {
      await this.organizationService.uploadLogo(org.id, file, currentUser.uid);
    } catch (error) {
      console.error('Failed to upload logo', error);
      this.logoError.set(error instanceof Error ? error.message : 'Failed to upload logo. Please try again.');
    } finally {
      this.uploadingLogo.set(false);
      // Reset the input
      input.value = '';
    }
  }

  async onCoverSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    
    if (!file) {
      return;
    }

    const org = this.organization();
    const currentUser = this.authService.currentUser;
    if (!org || !currentUser) {
      return;
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      this.coverError.set('Only image files are allowed.');
      return;
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      this.coverError.set('Image size must be less than 5MB.');
      return;
    }

    this.uploadingCover.set(true);
    this.coverError.set(null);

    try {
      await this.organizationService.uploadCoverImage(org.id, file, currentUser.uid);
    } catch (error) {
      console.error('Failed to upload cover image', error);
      this.coverError.set(error instanceof Error ? error.message : 'Failed to upload cover image. Please try again.');
    } finally {
      this.uploadingCover.set(false);
      // Reset the input
      input.value = '';
    }
  }

  // Prompt creation methods
  openCreatePromptModal() {
    this.closeMenu();
    this.promptFormError.set(null);
    this.customUrlError.set(null);
    this.clearCustomUrlDebounce();
    this.resetCreatePromptForm();
    this.newPromptModalOpen.set(true);
  }

  closeCreatePromptModal() {
    if (this.isSavingPrompt()) {
      return;
    }

    this.newPromptModalOpen.set(false);
    this.promptFormError.set(null);
    this.customUrlError.set(null);
    this.clearCustomUrlDebounce();
  }

  private resetCreatePromptForm() {
    this.createPromptForm.reset({
      title: '',
      tag: '',
      customUrl: '',
      content: '',
      isPrivate: false
    });
    this.promptFormError.set(null);
    this.customUrlError.set(null);
    this.clearCustomUrlDebounce();
    this.createPromptForm.markAsPristine();
    this.createPromptForm.markAsUntouched();
  }

  async submitPromptForm() {
    if (this.createPromptForm.invalid) {
      this.createPromptForm.markAllAsTouched();
      return;
    }

    const { title, tag, customUrl, content, isPrivate } = this.createPromptForm.getRawValue();
    const trimmedCustomUrl = (customUrl ?? '').trim();

    // Validate custom URL if provided
    if (trimmedCustomUrl) {
      // Check format
      const urlPattern = /^[a-z0-9-]+$/i;
      if (!urlPattern.test(trimmedCustomUrl)) {
        this.customUrlError.set('Custom URL can only contain letters, numbers, and hyphens.');
        return;
      }

      // Check reserved paths
      const reservedPaths = ['home', 'auth', 'prompt', 'prompts', 'collections', 'admin', 'verify-email', 'community-guidelines', 'organizations', 'organization'];
      if (reservedPaths.includes(trimmedCustomUrl.toLowerCase())) {
        this.customUrlError.set('This URL is reserved. Please choose a different one.');
        return;
      }

      // Final uniqueness check before submitting
      try {
        const isTaken = await this.promptService.isCustomUrlTaken(trimmedCustomUrl, null);
        if (isTaken) {
          this.customUrlError.set('This custom URL is already taken. Please choose a different one.');
          return;
        }
      } catch (error) {
        console.error('Failed to verify custom URL', error);
        this.promptFormError.set('Unable to verify custom URL availability. Please try again.');
        return;
      }
    }

    this.isSavingPrompt.set(true);
    this.promptFormError.set(null);
    this.customUrlError.set(null);

    try {
      const currentUser = this.authService.currentUser;
      if (!currentUser) {
        throw new Error('You must be signed in to create a prompt.');
      }

      const org = this.organization();
      if (!org) {
        throw new Error('Organization not found.');
      }

      // Check if user is admin
      const profile = await this.authService.fetchUserProfile(currentUser.uid);
      const isAdmin = profile && (profile.role === 'admin' || profile.admin);

      const createInput: CreatePromptInput = {
        authorId: currentUser.uid,
        title,
        content,
        tag,
        customUrl: trimmedCustomUrl || undefined,
        organizationId: org.id, // Associate prompt with organization
        ...(isAdmin && typeof isPrivate === 'boolean' ? { isPrivate } : {})
      };
      
      await this.promptService.createPrompt(createInput);

      this.resetCreatePromptForm();
      this.newPromptModalOpen.set(false);
    } catch (error) {
      console.error('Failed to save prompt', error);
      this.promptFormError.set(error instanceof Error ? error.message : 'Could not save the prompt. Please try again.');
    } finally {
      this.isSavingPrompt.set(false);
    }
  }

  onCustomUrlInput(value: string) {
    const trimmed = String(value ?? '').trim();
    this.createPromptForm.controls.customUrl.setValue(trimmed, { emitEvent: false });
    
    // Clear any existing timer
    if (this.customUrlTimer) {
      clearTimeout(this.customUrlTimer);
    }

    // Clear error if empty
    if (!trimmed) {
      this.customUrlError.set(null);
      this.isCheckingCustomUrl.set(false);
      return;
    }

    // Validate format first
    const urlPattern = /^[a-z0-9-]+$/i;
    if (!urlPattern.test(trimmed)) {
      this.customUrlError.set('Custom URL can only contain letters, numbers, and hyphens.');
      this.isCheckingCustomUrl.set(false);
      return;
    }

    // Check for reserved paths
    const reservedPaths = ['home', 'auth', 'prompt', 'prompts', 'collections', 'admin', 'verify-email', 'community-guidelines', 'organizations', 'organization'];
    if (reservedPaths.includes(trimmed.toLowerCase())) {
      this.customUrlError.set('This URL is reserved. Please choose a different one.');
      this.isCheckingCustomUrl.set(false);
      return;
    }

    // Debounce the uniqueness check
    this.isCheckingCustomUrl.set(true);
    this.customUrlError.set(null);
    
    this.customUrlTimer = setTimeout(async () => {
      try {
        const isTaken = await this.promptService.isCustomUrlTaken(trimmed, null);
        if (isTaken) {
          this.customUrlError.set('This custom URL is already taken. Please choose a different one.');
        } else {
          this.customUrlError.set(null);
        }
      } catch (error) {
        console.error('Failed to check custom URL', error);
        this.customUrlError.set('Unable to verify custom URL availability. Please try again.');
      } finally {
        this.isCheckingCustomUrl.set(false);
      }
    }, 500); // 500ms debounce
  }

  private clearCustomUrlDebounce() {
    if (this.customUrlTimer) {
      clearTimeout(this.customUrlTimer);
      this.customUrlTimer = null;
    }
  }
}

