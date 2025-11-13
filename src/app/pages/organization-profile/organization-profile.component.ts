import { CommonModule } from '@angular/common';
import { Component, DestroyRef, HostListener, ViewChild, ElementRef, inject, signal, computed } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { getApp } from 'firebase/app';
import { AuthService } from '../../services/auth.service';
import { OrganizationService } from '../../services/organization.service';
import { PromptService } from '../../services/prompt.service';
import { CollectionService } from '../../services/collection.service';
import type { Organization } from '../../models/organization.model';
import type { UserProfile } from '../../models/user-profile.model';
import type { CreatePromptInput, Prompt, UpdatePromptInput } from '../../models/prompt.model';
import type { PromptCollection } from '../../models/collection.model';

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
  private readonly collectionService = inject(CollectionService);
  readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  private readonly fb = inject(FormBuilder);

  readonly currentUser$ = this.authService.currentUser$;
  readonly organization = signal<Organization | null>(null);
  readonly organizationLoaded = signal(false);
  readonly currentUserProfile = signal<UserProfile | null>(null);
  
  // Organization prompts
  readonly organizationPrompts = signal<Prompt[]>([]);
  readonly isLoadingPrompts = signal(false);
  readonly loadPromptsError = signal<string | null>(null);
  readonly authorProfiles = signal<Map<string, UserProfile>>(new Map());
  
  // Search functionality
  readonly searchTerm = signal('');
  readonly filteredPrompts = computed(() => {
    const prompts = this.organizationPrompts();
    const term = this.searchTerm().trim().toLowerCase();

    if (!term) {
      return prompts;
    }

    return prompts.filter(prompt => {
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
  
  // Invite functionality
  readonly inviteQuery = signal('');
  readonly inviteSuggestions = signal<UserProfile[]>([]);
  readonly isSearchingUsers = signal(false);
  readonly inviteError = signal<string | null>(null);
  readonly inviteSuccess = signal<string | null>(null);
  readonly isInviting = signal(false);
  private inviteSearchTimer: ReturnType<typeof setTimeout> | null = null;
  
  // Prompt card functionality state
  readonly shareModalOpen = signal(false);
  readonly sharePrompt = signal<Prompt | null>(null);
  readonly isEditingPrompt = signal(false);
  readonly editingPromptId = signal<string | null>(null);
  readonly forkingPromptId = signal<string | null>(null);
  readonly deletingPromptId = signal<string | null>(null);
  readonly deleteError = signal<string | null>(null);
  readonly recentlyCopied = signal<Set<string>>(new Set());
  readonly recentlyCopiedUrl = signal<Set<string>>(new Set());
  private readonly copyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly copyUrlTimers = new Map<string, ReturnType<typeof setTimeout>>();
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

  readonly canInviteMembers = computed(() => {
    const profile = this.currentUserProfile();
    if (!profile) return false;
    return profile.role === 'admin' || profile.admin === true;
  });

  readonly isCreator = computed(() => {
    const currentUser = this.authService.currentUser;
    const org = this.organization();
    if (!currentUser || !org) return false;
    return org.createdBy === currentUser.uid;
  });
  
  // Members list
  readonly organizationMembers = signal<UserProfile[]>([]);
  readonly isLoadingMembers = signal(false);
  readonly membersSectionExpanded = signal(false);
  readonly membersListExpanded = signal(false);
  readonly inviteSectionExpanded = signal(false);
  
  // Tabs
  readonly activeTab = signal<'prompts' | 'collections'>('prompts');
  
  // Collections
  readonly organizationCollections = signal<PromptCollection[]>([]);
  readonly isLoadingCollections = signal(false);
  readonly loadCollectionsError = signal<string | null>(null);
  
  // Collection creation state
  readonly newCollectionModalOpen = signal(false);
  readonly isSavingCollection = signal(false);
  readonly collectionFormError = signal<string | null>(null);
  readonly collectionCustomUrlError = signal<string | null>(null);
  readonly isCheckingCollectionCustomUrl = signal(false);
  private collectionCustomUrlTimer: ReturnType<typeof setTimeout> | null = null;
  readonly collectionPromptSearchTerm = signal('');
  readonly uploadingBrandLogo = signal(false);
  readonly brandLogoUploadError = signal<string | null>(null);
  readonly brandLogoUrl = signal<string | null>(null);
  private brandLogoFile: File | null = null;
  readonly brandingSectionExpanded = signal(false);
  
  readonly createCollectionForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(3)]],
    tag: ['', [Validators.required, Validators.minLength(2)]],
    promptIds: this.fb.nonNullable.control<string[]>([], {
      validators: [Validators.required]
    }),
    customUrl: [''],
    blurb: [''],
    brandLink: [''],
    brandSubtext: ['']
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
          // Load organization prompts
          this.loadOrganizationPrompts(org.id);
          // Load organization collections
          this.loadOrganizationCollections(org);
          // Load organization members if user is creator
          if (this.isCreator()) {
            this.loadOrganizationMembers(org);
          }
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
    
    // Fallback to organizations list page if no username
    return `${origin}/organizations`;
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

    if (this.newCollectionModalOpen()) {
      this.closeCreateCollectionModal();
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
    this.isEditingPrompt.set(false);
    this.editingPromptId.set(null);
    this.forkingPromptId.set(null);
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
    this.isEditingPrompt.set(false);
    this.editingPromptId.set(null);
    this.forkingPromptId.set(null);
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

      if (this.isEditingPrompt() && this.editingPromptId()) {
        const updateInput: UpdatePromptInput = {
          title,
          content,
          tag,
          customUrl: trimmedCustomUrl,
          ...(isAdmin && typeof isPrivate === 'boolean' ? { isPrivate } : {})
        };
        await this.promptService.updatePrompt(this.editingPromptId()!, updateInput, currentUser.uid);
      } else if (this.forkingPromptId()) {
        // Forking a prompt
        const originalPrompt = this.organizationPrompts().find(p => p.id === this.forkingPromptId());
        if (originalPrompt) {
          const createInput: CreatePromptInput = {
            authorId: currentUser.uid,
            title,
            content,
            tag,
            customUrl: trimmedCustomUrl || undefined,
            forkedFromPromptId: originalPrompt.id,
            forkedFromAuthorId: originalPrompt.authorId,
            forkedFromTitle: originalPrompt.title,
            forkedFromCustomUrl: originalPrompt.customUrl,
            ...(isAdmin && typeof isPrivate === 'boolean' ? { isPrivate } : {})
          };
          await this.promptService.createPrompt(createInput);
        } else {
          throw new Error('Original prompt not found.');
        }
      } else {
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
      }

      this.resetCreatePromptForm();
      this.isEditingPrompt.set(false);
      this.editingPromptId.set(null);
      this.forkingPromptId.set(null);
      this.newPromptModalOpen.set(false);
      // Reload prompts to show the new one
      if (org) {
        this.loadOrganizationPrompts(org.id);
      }
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

  private loadOrganizationPrompts(organizationId: string) {
    this.isLoadingPrompts.set(true);
    this.loadPromptsError.set(null);

    this.promptService.promptsByOrganization$(organizationId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (prompts) => {
          this.organizationPrompts.set(prompts);
          this.loadAuthorProfiles(prompts);
          this.isLoadingPrompts.set(false);
          this.loadPromptsError.set(null);
        },
        error: (error) => {
          console.error('Failed to load organization prompts', error);
          this.isLoadingPrompts.set(false);
          this.loadPromptsError.set('Failed to load organization prompts. Please try again.');
        }
      });
  }

  private loadAuthorProfiles(prompts: readonly Prompt[]) {
    const uniqueAuthorIds = new Set<string>();
    prompts.forEach(prompt => {
      if (prompt.authorId) {
        uniqueAuthorIds.add(prompt.authorId);
      }
    });

    const profilesMap = new Map(this.authorProfiles());
    const profilesToLoad: string[] = [];

    uniqueAuthorIds.forEach(authorId => {
      if (!profilesMap.has(authorId)) {
        profilesToLoad.push(authorId);
      }
    });

    if (profilesToLoad.length === 0) {
      return;
    }

    // Load profiles in parallel
    Promise.all(
      profilesToLoad.map(authorId =>
        this.authService.fetchUserProfile(authorId).then(profile => ({
          authorId,
          profile
        }))
      )
    ).then(results => {
      const updatedMap = new Map(profilesMap);
      results.forEach(({ authorId, profile }) => {
        if (profile) {
          updatedMap.set(authorId, profile);
        }
      });
      this.authorProfiles.set(updatedMap);
    });
  }

  getAuthorProfile(authorId: string): UserProfile | undefined {
    return this.authorProfiles().get(authorId);
  }

  getAuthorInitials(authorId: string): string {
    const profile = this.getAuthorProfile(authorId);
    if (!profile) {
      return 'RP';
    }
    const firstInitial = profile.firstName?.charAt(0)?.toUpperCase() ?? '';
    const lastInitial = profile.lastName?.charAt(0)?.toUpperCase() ?? '';
    const initials = `${firstInitial}${lastInitial}`.trim();
    return initials || (profile.email?.charAt(0)?.toUpperCase() ?? 'R');
  }

  async navigateToAuthorProfile(authorId: string, event: Event, prompt?: Prompt) {
    event.stopPropagation();
    
    // If prompt belongs to an organization, navigate to organization profile
    if (prompt?.organizationId) {
      const org = this.organization();
      if (org && org.id === prompt.organizationId) {
        // Already on this organization's page, no need to navigate
        return;
      }
      
      // Load organization and navigate to it
      try {
        const orgData = await this.organizationService.fetchOrganization(prompt.organizationId);
        if (orgData?.username) {
          void this.router.navigate(['/organization', orgData.username]);
        } else if (orgData) {
          // Fallback to ID if username not available
          void this.router.navigate(['/organization', orgData.id]);
        }
      } catch (error) {
        console.error('Failed to load organization', error);
      }
      return;
    }
    
    // Otherwise, navigate to user profile
    if (authorId) {
      const profile = await this.authService.fetchUserProfile(authorId);
      if (profile?.username) {
        void this.router.navigate(['/profile', profile.username]);
      } else {
        void this.router.navigate(['/profile'], { queryParams: { userId: authorId } });
      }
    }
  }

  buildPreview(content: string): string {
    const normalized = content?.trim() ?? '';
    if (normalized.length <= 240) {
      return normalized;
    }
    return `${normalized.slice(0, 240).trimEnd()}…`;
  }

  formatTagLabel(tag: string): string {
    if (!tag) {
      return 'General';
    }
    return tag
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  getPromptUrl(prompt: Prompt): string {
    const short = prompt.id ? prompt.id.slice(0, 8) : '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return prompt.customUrl ? `${origin}/${prompt.customUrl}` : `${origin}/prompt/${short}`;
  }

  openPrompt(prompt: Prompt) {
    if (prompt.customUrl) {
      void this.router.navigate([`/${prompt.customUrl}`]);
    } else {
      const short = (prompt?.id ?? '').slice(0, 8);
      if (!short) return;
      void this.router.navigate(['/prompt', short]);
    }
  }

  // Copy prompt functionality
  async copyPrompt(prompt: Prompt) {
    if (!prompt) return;

    const text = prompt.content ?? '';

    try {
      await navigator.clipboard.writeText(text);
      this.showCopyMessage('Prompt copied!');
      this.markPromptAsCopied(prompt.id);
    } catch (e) {
      this.fallbackCopyTextToClipboard(text);
      this.showCopyMessage('Prompt copied!');
      this.markPromptAsCopied(prompt.id);
    }
  }

  private markPromptAsCopied(id: string) {
    if (!id) return;

    this.recentlyCopied.update(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

    const existing = this.copyTimers.get(id);
    if (existing) {
      clearTimeout(existing);
    }

    const DURATION = 2500;
    const timer = setTimeout(() => {
      this.recentlyCopied.update(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      this.copyTimers.delete(id);
    }, DURATION);

    this.copyTimers.set(id, timer);
  }

  async copyPromptUrl(prompt: Prompt) {
    if (!prompt) return;

    const short = prompt.id ? prompt.id.slice(0, 8) : '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const url = prompt.customUrl ? `${origin}/${prompt.customUrl}` : `${origin}/prompt/${short}`;

    try {
      await navigator.clipboard.writeText(url);
      this.showCopyMessage('Prompt URL copied!');
      this.markPromptUrlAsCopied(prompt.id);
    } catch (e) {
      this.fallbackCopyTextToClipboard(url);
      this.showCopyMessage('Prompt URL copied!');
      this.markPromptUrlAsCopied(prompt.id);
    }
  }

  private markPromptUrlAsCopied(id: string) {
    if (!id) return;

    this.recentlyCopiedUrl.update(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

    const existing = this.copyUrlTimers.get(id);
    if (existing) {
      clearTimeout(existing);
    }

    const DURATION = 2500;
    const timer = setTimeout(() => {
      this.recentlyCopiedUrl.update(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      this.copyUrlTimers.delete(id);
    }, DURATION);

    this.copyUrlTimers.set(id, timer);
  }

  getPromptDisplayUrl(prompt: Prompt): string {
    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'rocketprompt.io';
    const short = prompt.id ? prompt.id.slice(0, 8) : '';
    return prompt.customUrl ? `${hostname}/${prompt.customUrl}` : `${hostname}/prompt/${short}`;
  }

  // Share modal functionality
  openShareModal(prompt: Prompt) {
    this.sharePrompt.set(prompt);
    this.shareModalOpen.set(true);
  }

  closeShareModal() {
    this.shareModalOpen.set(false);
    this.sharePrompt.set(null);
  }

  createChatGPTUrl(prompt: string): string {
    const encodedPrompt = encodeURIComponent(prompt);
    const timestamp = Date.now();
    return `https://chat.openai.com/?q=${encodedPrompt}&t=${timestamp}`;
  }

  createGeminiUrl(prompt: string): string {
    return 'https://gemini.google.com/app';
  }

  createClaudeUrl(prompt: string): string {
    const encodedPrompt = encodeURIComponent(prompt);
    return `https://claude.ai/?prompt=${encodedPrompt}`;
  }

  async openChatbot(url: string, chatbotName: string) {
    const promptText = this.sharePrompt()?.content || '';
    
    if (chatbotName === 'ChatGPT') {
      window.open(url, '_blank');
      return;
    }

    try {
      if (promptText) {
        await navigator.clipboard.writeText(promptText);
        this.showCopyMessage(`${chatbotName} prompt copied!`);
      }
    } catch (e) {
      if (promptText) {
        this.fallbackCopyTextToClipboard(promptText);
        this.showCopyMessage(`${chatbotName} prompt copied!`);
      }
    }

    window.open(url, '_blank');
  }

  copyPromptPageUrl() {
    const prompt = this.sharePrompt();
    if (!prompt) return;

    const short = (prompt.id ?? '').slice(0, 8);
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const url = prompt.customUrl ? `${origin}/${prompt.customUrl}` : `${origin}/prompt/${short}`;

    navigator.clipboard.writeText(url).then(() => {
      this.showCopyMessage('Prompt URL copied!');
    }).catch(() => {
      this.fallbackCopyTextToClipboard(url);
      this.showCopyMessage('Prompt URL copied!');
    });
  }

  // Fork prompt functionality
  openForkPromptModal(prompt: Prompt) {
    const currentUser = this.authService.currentUser;
    if (!currentUser) {
      this.promptFormError.set('You must be signed in to fork a prompt.');
      return;
    }

    this.closeMenu();
    this.isEditingPrompt.set(false);
    this.editingPromptId.set(null);
    this.forkingPromptId.set(prompt.id);
    this.promptFormError.set(null);
    this.customUrlError.set(null);
    this.clearCustomUrlDebounce();
    
    this.createPromptForm.setValue({
      title: prompt.title,
      tag: prompt.tag,
      customUrl: '',
      content: prompt.content,
      isPrivate: false
    });
    this.createPromptForm.markAsPristine();
    this.createPromptForm.markAsUntouched();
    this.newPromptModalOpen.set(true);
  }

  // Edit prompt functionality
  openEditPromptModal(prompt: Prompt) {
    const currentUser = this.authService.currentUser;
    if (!currentUser) {
      this.promptFormError.set('You must be signed in to edit a prompt.');
      return;
    }

    if (prompt.authorId && prompt.authorId !== currentUser.uid) {
      this.promptFormError.set('You do not have permission to edit this prompt. Only the author can edit it.');
      return;
    }

    this.closeMenu();
    this.promptFormError.set(null);
    this.customUrlError.set(null);
    this.clearCustomUrlDebounce();
    this.isEditingPrompt.set(true);
    this.editingPromptId.set(prompt.id);
    this.forkingPromptId.set(null);
    this.createPromptForm.setValue({
      title: prompt.title,
      tag: prompt.tag,
      customUrl: prompt.customUrl ?? '',
      content: prompt.content,
      isPrivate: prompt.isPrivate ?? false
    });
    this.createPromptForm.markAsPristine();
    this.createPromptForm.markAsUntouched();
    this.newPromptModalOpen.set(true);
  }

  canEditPrompt(prompt: Prompt): boolean {
    const currentUser = this.authService.currentUser;
    if (!currentUser) {
      return false;
    }
    return !prompt.authorId || prompt.authorId === currentUser.uid;
  }

  // Delete prompt functionality
  async onDeletePrompt(prompt: Prompt) {
    if (this.deletingPromptId() === prompt.id) {
      return;
    }

    const currentUser = this.authService.currentUser;
    if (!currentUser) {
      this.deleteError.set('You must be signed in to delete a prompt.');
      return;
    }

    if (prompt.authorId && prompt.authorId !== currentUser.uid) {
      this.deleteError.set('You do not have permission to delete this prompt. Only the author can delete it.');
      return;
    }

    const confirmed = window.confirm(`Delete "${prompt.title}"? This action cannot be undone.`);

    if (!confirmed) {
      return;
    }

    this.deletingPromptId.set(prompt.id);
    this.deleteError.set(null);

    try {
      await this.promptService.deletePrompt(prompt.id, currentUser.uid);
      // Reload prompts after deletion
      const org = this.organization();
      if (org) {
        this.loadOrganizationPrompts(org.id);
      }
    } catch (error) {
      console.error('Failed to delete prompt', error);
      this.deleteError.set(
        error instanceof Error ? error.message : 'Could not delete the prompt. Please try again.'
      );
    } finally {
      this.deletingPromptId.set(null);
    }
  }

  getOriginalPromptUrl(prompt: Prompt): string | null {
    if (!prompt.forkedFromPromptId) {
      return null;
    }
    
    if (prompt.forkedFromCustomUrl) {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      return `${origin}/${prompt.forkedFromCustomUrl}`;
    }
    
    if (prompt.forkedFromPromptId) {
      const short = prompt.forkedFromPromptId.slice(0, 8);
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      return `${origin}/prompt/${short}`;
    }
    
    return null;
  }

  navigateToOriginalPrompt(prompt: Prompt, event: Event) {
    event.stopPropagation();
    const url = this.getOriginalPromptUrl(prompt);
    if (url) {
      void this.router.navigateByUrl(url.replace(window.location.origin, ''));
    }
  }

  getForkingPromptTitle(): string {
    const forkingId = this.forkingPromptId();
    if (!forkingId) {
      return 'Original prompt';
    }
    const prompt = this.organizationPrompts().find(p => p.id === forkingId);
    return prompt?.title || 'Original prompt';
  }

  // Search functionality
  onSearch(term: string) {
    this.searchTerm.set(term);
  }

  trackPromptById(_: number, prompt: Prompt) {
    return prompt.id;
  }

  // Invite functionality
  onInviteQueryChange(query: string) {
    this.inviteQuery.set(query);
    this.inviteError.set(null);
    this.inviteSuccess.set(null);
    
    // Clear existing timer
    if (this.inviteSearchTimer) {
      clearTimeout(this.inviteSearchTimer);
    }

    const trimmed = query.trim();
    if (!trimmed) {
      this.inviteSuggestions.set([]);
      return;
    }

    // Debounce search
    this.isSearchingUsers.set(true);
    this.inviteSearchTimer = setTimeout(async () => {
      try {
        await this.searchUsers(trimmed);
      } finally {
        this.isSearchingUsers.set(false);
      }
    }, 300);
  }

  private async searchUsers(query: string) {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      this.inviteSuggestions.set([]);
      return;
    }

    try {
      // Import firestore module directly
      const firestoreModule = await import('firebase/firestore');
      const firestore = firestoreModule.getFirestore(getApp());
      const usersRef = firestoreModule.collection(firestore, 'users');
      
      // Search by username (exact match first)
      const usernameQuery = firestoreModule.query(
        usersRef,
        firestoreModule.where('username', '==', trimmed),
        firestoreModule.limit(5)
      );
      
      const usernameSnapshot = await firestoreModule.getDocs(usernameQuery);
      const results: UserProfile[] = [];
      const seenIds = new Set<string>();

      // Add username matches
      usernameSnapshot.docs.forEach(doc => {
        const data = doc.data() as Omit<UserProfile, 'id'>;
        const profile: UserProfile = {
          id: doc.id,
          ...data
        };
        if (!seenIds.has(profile.id)) {
          results.push(profile);
          seenIds.add(profile.id);
        }
      });

      // Also search by name (partial match)
      // Note: Firestore doesn't support case-insensitive search, so we'll do client-side filtering
      // For better performance, we could use Algolia or similar, but for now we'll fetch a reasonable set
      const allUsersQuery = firestoreModule.query(
        usersRef,
        firestoreModule.limit(50) // Limit to avoid fetching too many
      );
      
      const allUsersSnapshot = await firestoreModule.getDocs(allUsersQuery);
      allUsersSnapshot.docs.forEach(doc => {
        if (seenIds.has(doc.id)) return;
        
        const data = doc.data() as Omit<UserProfile, 'id'>;
        const firstName = (data.firstName || '').toLowerCase();
        const lastName = (data.lastName || '').toLowerCase();
        const email = (data.email || '').toLowerCase();
        const username = (data.username || '').toLowerCase();
        
        if (firstName.includes(trimmed) || 
            lastName.includes(trimmed) || 
            `${firstName} ${lastName}`.includes(trimmed) ||
            email.includes(trimmed) ||
            username.includes(trimmed)) {
          const profile: UserProfile = {
            id: doc.id,
            ...data
          };
          results.push(profile);
          seenIds.add(profile.id);
        }
      });

      // Limit results
      this.inviteSuggestions.set(results.slice(0, 10));
    } catch (error) {
      console.error('Failed to search users', error);
      this.inviteSuggestions.set([]);
    }
  }

  async inviteUser(user: UserProfile) {
    const org = this.organization();
    const currentUser = this.authService.currentUser;
    
    if (!org || !currentUser) {
      this.inviteError.set('Organization or user not found.');
      return;
    }

    // Check if user is already a member
    if (org.members.includes(user.id)) {
      this.inviteError.set('User is already a member of this organization.');
      return;
    }

    // Check if current user is admin
    const profile = this.currentUserProfile();
    const isAdmin = profile && (profile.role === 'admin' || profile.admin === true);
    if (!isAdmin) {
      this.inviteError.set('Only admins can invite members.');
      return;
    }

    this.isInviting.set(true);
    this.inviteError.set(null);
    this.inviteSuccess.set(null);

    try {
      // Add user to members array
      const updatedMembers = [...org.members, user.id];
      await this.organizationService.updateOrganization(
        org.id,
        { members: updatedMembers },
        currentUser.uid
      );

      this.inviteSuccess.set(`${user.firstName} ${user.lastName} has been added to the organization.`);
      this.inviteQuery.set('');
      this.inviteSuggestions.set([]);
      
      // Reload members list if user is creator
      if (this.isCreator()) {
        const updatedOrg = this.organization();
        if (updatedOrg) {
          this.loadOrganizationMembers(updatedOrg);
        }
      }
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        this.inviteSuccess.set(null);
      }, 3000);
    } catch (error) {
      console.error('Failed to invite user', error);
      this.inviteError.set(error instanceof Error ? error.message : 'Failed to invite user. Please try again.');
    } finally {
      this.isInviting.set(false);
    }
  }

  async inviteByEmail(email: string) {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      this.inviteError.set('Please enter an email address.');
      return;
    }

    // Basic email validation
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(trimmed)) {
      this.inviteError.set('Please enter a valid email address.');
      return;
    }

    const org = this.organization();
    const currentUser = this.authService.currentUser;
    
    if (!org || !currentUser) {
      this.inviteError.set('Organization or user not found.');
      return;
    }

    // Check if current user is admin
    const profile = this.currentUserProfile();
    const isAdmin = profile && (profile.role === 'admin' || profile.admin === true);
    if (!isAdmin) {
      this.inviteError.set('Only admins can invite members.');
      return;
    }

    this.isInviting.set(true);
    this.inviteError.set(null);
    this.inviteSuccess.set(null);

    try {
      // Try to find user by email first
      const firestoreModule = await import('firebase/firestore');
      const firestore = firestoreModule.getFirestore(getApp());
      const usersRef = firestoreModule.collection(firestore, 'users');
      const emailQuery = firestoreModule.query(
        usersRef,
        firestoreModule.where('email', '==', trimmed),
        firestoreModule.limit(1)
      );
      
      const emailSnapshot = await firestoreModule.getDocs(emailQuery);
      
      if (!emailSnapshot.empty) {
        // User exists, add them directly
        const doc = emailSnapshot.docs[0];
        const data = doc.data() as Omit<UserProfile, 'id'>;
        const user: UserProfile = {
          id: doc.id,
          ...data
        };

        if (org.members.includes(user.id)) {
          this.inviteError.set('User is already a member of this organization.');
          return;
        }

        const updatedMembers = [...org.members, user.id];
        await this.organizationService.updateOrganization(
          org.id,
          { members: updatedMembers },
          currentUser.uid
        );

        this.inviteSuccess.set(`${user.firstName || user.email} has been added to the organization.`);
        
        // Reload members list if user is creator
        if (this.isCreator()) {
          const updatedOrg = this.organization();
          if (updatedOrg) {
            this.loadOrganizationMembers(updatedOrg);
          }
        }
      } else {
        // User doesn't exist - for now, just show a message
        // In a real app, you might want to send an email invitation
        this.inviteError.set('User not found. Email invitations are not yet implemented. Please ask the user to sign up first.');
      }

      this.inviteQuery.set('');
      this.inviteSuggestions.set([]);
      
      // Clear success message after 3 seconds
      if (this.inviteSuccess()) {
        setTimeout(() => {
          this.inviteSuccess.set(null);
        }, 3000);
      }
    } catch (error) {
      console.error('Failed to invite by email', error);
      this.inviteError.set(error instanceof Error ? error.message : 'Failed to invite user. Please try again.');
    } finally {
      this.isInviting.set(false);
    }
  }

  selectInviteSuggestion(user: UserProfile) {
    this.inviteUser(user);
  }

  private async loadOrganizationMembers(org: Organization) {
    this.isLoadingMembers.set(true);
    
    try {
      const memberProfiles: UserProfile[] = [];
      
      // Load creator profile
      if (org.createdBy) {
        const creatorProfile = await this.authService.fetchUserProfile(org.createdBy);
        if (creatorProfile) {
          memberProfiles.push(creatorProfile);
        }
      }
      
      // Load member profiles
      const memberPromises = org.members
        .filter(memberId => memberId !== org.createdBy) // Don't duplicate creator
        .map(memberId => this.authService.fetchUserProfile(memberId));
      
      const memberResults = await Promise.all(memberPromises);
      memberResults.forEach(profile => {
        if (profile) {
          memberProfiles.push(profile);
        }
      });
      
      this.organizationMembers.set(memberProfiles);
    } catch (error) {
      console.error('Failed to load organization members', error);
    } finally {
      this.isLoadingMembers.set(false);
    }
  }

  getMemberInitials(member: UserProfile): string {
    const firstInitial = member.firstName.charAt(0).toUpperCase();
    const lastInitial = member.lastName.charAt(0).toUpperCase();
    const initials = `${firstInitial}${lastInitial}`.trim();
    return initials || member.email.charAt(0).toUpperCase();
  }

  isMemberCreator(member: UserProfile): boolean {
    const org = this.organization();
    if (!org) return false;
    return org.createdBy === member.id;
  }

  toggleMembersSection() {
    this.membersSectionExpanded.update(v => !v);
  }

  toggleMembersList() {
    this.membersListExpanded.update(v => !v);
  }

  toggleInviteSection() {
    this.inviteSectionExpanded.update(v => !v);
  }

  selectTab(tab: 'prompts' | 'collections') {
    this.activeTab.set(tab);
  }

  private loadOrganizationCollections(org: Organization) {
    this.isLoadingCollections.set(true);
    this.loadCollectionsError.set(null);

    // Query collections by organizationId (collections specifically associated with the organization)
    this.collectionService.collectionsByOrganization$(org.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (collections) => {
          this.organizationCollections.set(collections);
          this.isLoadingCollections.set(false);
          this.loadCollectionsError.set(null);
        },
        error: (error) => {
          console.error('Failed to load organization collections', error);
          this.isLoadingCollections.set(false);
          this.loadCollectionsError.set('Failed to load collections. Please try again.');
        }
      });
  }

  readonly organizationCollectionCount = computed(() => {
    return this.organizationCollections().length;
  });

  // Collection creation methods
  openCreateCollectionModal() {
    this.closeMenu();
    this.collectionFormError.set(null);
    this.collectionCustomUrlError.set(null);
    this.clearCollectionCustomUrlDebounce();
    this.resetCreateCollectionForm();
    
    // Prefill branding with org info
    const org = this.organization();
    let hasPrefilledData = false;
    if (org) {
      if (org.logoUrl) {
        this.brandLogoUrl.set(org.logoUrl);
        hasPrefilledData = true;
      }
      if (org.description) {
        // Prefill brand subtext with org description (limited to 50 words)
        const words = org.description.trim().split(/\s+/);
        const limitedDescription = words.slice(0, 50).join(' ');
        this.createCollectionForm.patchValue({
          brandSubtext: limitedDescription
        });
        hasPrefilledData = true;
      }
    }
    
    // Expand branding section if we have prefilled data
    if (hasPrefilledData) {
      this.brandingSectionExpanded.set(true);
    }
    
    this.newCollectionModalOpen.set(true);
  }

  closeCreateCollectionModal() {
    if (this.isSavingCollection()) {
      return;
    }

    this.newCollectionModalOpen.set(false);
    this.collectionFormError.set(null);
    this.collectionCustomUrlError.set(null);
    this.brandLogoUrl.set(null);
    this.brandLogoUploadError.set(null);
    this.brandLogoFile = null;
    this.brandingSectionExpanded.set(false);
    this.clearCollectionCustomUrlDebounce();
  }

  private resetCreateCollectionForm() {
    this.createCollectionForm.reset({
      name: '',
      tag: '',
      promptIds: [],
      customUrl: '',
      blurb: '',
      brandLink: '',
      brandSubtext: ''
    });
    this.collectionFormError.set(null);
    this.collectionCustomUrlError.set(null);
    this.clearCollectionCustomUrlDebounce();
    this.collectionPromptSearchTerm.set('');
    this.createCollectionForm.markAsPristine();
    this.createCollectionForm.markAsUntouched();
  }

  readonly filteredOrganizationPrompts = computed(() => {
    const prompts = this.organizationPrompts();
    const term = this.collectionPromptSearchTerm().trim().toLowerCase();

    if (!term) {
      return prompts;
    }

    return prompts.filter(prompt => {
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

  togglePromptSelection(promptId: string) {
    const control = this.createCollectionForm.controls.promptIds;
    const current = new Set(control.value ?? []);

    if (current.has(promptId)) {
      current.delete(promptId);
    } else {
      current.add(promptId);
    }

    control.setValue(Array.from(current));
    control.markAsDirty();
    control.markAsTouched();
  }

  isPromptSelected(promptId: string) {
    return this.createCollectionForm.controls.promptIds.value.includes(promptId);
  }

  readonly brandSubtextWordCount = computed(() => {
    const text = this.createCollectionForm.controls.brandSubtext.value?.trim() || '';
    if (!text) return 0;
    return text.split(/\s+/).filter(word => word.length > 0).length;
  });

  async submitCollectionForm() {
    if (this.createCollectionForm.invalid || this.collectionCustomUrlError()) {
      this.createCollectionForm.markAllAsTouched();
      return;
    }

    const { name, tag, promptIds, customUrl, blurb, brandLink, brandSubtext } = this.createCollectionForm.getRawValue();
    
    // Validate brand subtext word limit (50 words)
    if (brandSubtext?.trim()) {
      const wordCount = brandSubtext.trim().split(/\s+/).filter(word => word.length > 0).length;
      if (wordCount > 50) {
        this.collectionFormError.set('Brand description must be 50 words or less.');
        return;
      }
    }

    const org = this.organization();
    if (!org) {
      this.collectionFormError.set('Organization not found.');
      return;
    }

    this.isSavingCollection.set(true);
    this.collectionFormError.set(null);

    try {
      // Determine brand logo URL - use org logo if it's a real URL (not a data URL from FileReader)
      const brandLogoUrlValue = this.brandLogoUrl();
      const isDataUrl = brandLogoUrlValue?.startsWith('data:');
      const orgLogoUrl = !isDataUrl && brandLogoUrlValue ? brandLogoUrlValue : undefined;
      
      // Create collection with organizationId set to org.id and authorId also set to org.id
      const collectionId = await this.collectionService.createCollection({
        name,
        tag,
        promptIds,
        customUrl: customUrl?.trim() || undefined,
        blurb: blurb?.trim() || undefined,
        brandLink: brandLink?.trim() || undefined,
        brandSubtext: brandSubtext?.trim() || undefined,
        organizationId: org.id,
        brandLogoUrl: orgLogoUrl
      }, org.id); // Set authorId to org.id

      // Upload brand logo if file was selected (new file upload)
      if (this.brandLogoFile) {
        try {
          const logoUrl = await this.collectionService.uploadBrandLogo(collectionId, this.brandLogoFile, org.id);
          // Update collection with logo URL
          await this.collectionService.updateCollection(collectionId, { brandLogoUrl: logoUrl }, org.id);
        } catch (logoError) {
          console.error('Failed to upload brand logo', logoError);
          // Don't fail the whole operation if logo upload fails
        }
      }

      this.newCollectionModalOpen.set(false);
      this.resetCreateCollectionForm();
      // Reload collections to show the new one
      this.loadOrganizationCollections(org);
    } catch (error) {
      console.error('Failed to create collection', error);
      this.collectionFormError.set(
        error instanceof Error ? error.message : 'Could not create the collection. Please try again.'
      );
    } finally {
      this.isSavingCollection.set(false);
    }
  }

  onCollectionCustomUrlInput(value: string) {
    const trimmed = String(value ?? '').trim();
    this.createCollectionForm.controls.customUrl.setValue(trimmed, { emitEvent: false });
    
    // Clear any existing timer
    if (this.collectionCustomUrlTimer) {
      clearTimeout(this.collectionCustomUrlTimer);
    }

    // Clear error if empty
    if (!trimmed) {
      this.collectionCustomUrlError.set(null);
      this.isCheckingCollectionCustomUrl.set(false);
      return;
    }

    // Validate format first
    const urlPattern = /^[a-z0-9-]+$/i;
    if (!urlPattern.test(trimmed)) {
      this.collectionCustomUrlError.set('Custom URL can only contain letters, numbers, and hyphens.');
      this.isCheckingCollectionCustomUrl.set(false);
      return;
    }

    // Check for reserved paths
    const reservedPaths = ['home', 'auth', 'prompt', 'prompts', 'collections', 'collection', 'admin', 'verify-email', 'community-guidelines', 'organizations', 'organization', 'profile'];
    if (reservedPaths.includes(trimmed.toLowerCase())) {
      this.collectionCustomUrlError.set('This URL is reserved. Please choose a different one.');
      this.isCheckingCollectionCustomUrl.set(false);
      return;
    }

    // Debounce the uniqueness check
    this.isCheckingCollectionCustomUrl.set(true);
    this.collectionCustomUrlError.set(null);
    
    this.collectionCustomUrlTimer = setTimeout(async () => {
      try {
        const isTaken = await this.collectionService.isCustomUrlTaken(trimmed);
        if (isTaken) {
          this.collectionCustomUrlError.set('This custom URL is already taken. Please choose a different one.');
        } else {
          this.collectionCustomUrlError.set(null);
        }
      } catch (error) {
        console.error('Failed to check custom URL', error);
        this.collectionCustomUrlError.set('Unable to verify custom URL availability. Please try again.');
      } finally {
        this.isCheckingCollectionCustomUrl.set(false);
      }
    }, 500); // 500ms debounce
  }

  private clearCollectionCustomUrlDebounce() {
    if (this.collectionCustomUrlTimer) {
      clearTimeout(this.collectionCustomUrlTimer);
      this.collectionCustomUrlTimer = null;
    }
  }

  async onBrandLogoSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    
    if (!file) {
      return;
    }

    this.uploadingBrandLogo.set(true);
    this.brandLogoUploadError.set(null);

    try {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        throw new Error('Only image files are allowed.');
      }

      // Validate file size (max 5MB)
      const maxSize = 5 * 1024 * 1024; // 5MB
      if (file.size > maxSize) {
        throw new Error('Image size must be less than 5MB.');
      }

      // Store the file for later upload
      this.brandLogoFile = file;

      // Create a preview URL
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result;
        if (typeof result === 'string') {
          this.brandLogoUrl.set(result);
        }
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Failed to process brand logo', error);
      this.brandLogoUploadError.set(error instanceof Error ? error.message : 'Failed to process logo. Please try again.');
      this.brandLogoFile = null;
    } finally {
      this.uploadingBrandLogo.set(false);
      // Reset the input
      input.value = '';
    }
  }

  removeBrandLogo() {
    this.brandLogoUrl.set(null);
    this.brandLogoFile = null;
    this.brandLogoUploadError.set(null);
  }

  async onDeleteCollection(collection: PromptCollection) {
    const currentUser = this.authService.currentUser;
    if (!currentUser) {
      return;
    }

    const confirmed = window.confirm(`Delete "${collection.name}"? This action cannot be undone.`);

    if (!confirmed) {
      return;
    }

    try {
      await this.collectionService.deleteCollection(collection.id, currentUser.uid);
      // Reload collections after deletion
      const org = this.organization();
      if (org) {
        this.loadOrganizationCollections(org);
      }
    } catch (error) {
      console.error('Failed to delete collection', error);
      alert(error instanceof Error ? error.message : 'Could not delete the collection. Please try again.');
    }
  }
}

