import { CommonModule } from '@angular/common';
import { Component, DestroyRef, HostListener, ViewChild, ElementRef, inject, signal, computed } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { OrganizationService } from '../../services/organization.service';
import type { Organization } from '../../models/organization.model';
import type { UserProfile } from '../../models/user-profile.model';

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
}

