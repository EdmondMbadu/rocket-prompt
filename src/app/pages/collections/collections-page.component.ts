import { CommonModule } from '@angular/common';
import { Component, DestroyRef, HostListener, ViewChild, ElementRef, computed, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { CollectionService } from '../../services/collection.service';
import { PromptService } from '../../services/prompt.service';
import type { PromptCollection } from '../../models/collection.model';
import type { Prompt } from '../../models/prompt.model';
import type { UserProfile } from '../../models/user-profile.model';

interface CollectionCard {
    readonly id: string;
    readonly name: string;
    readonly tag: string;
    readonly tagLabel: string;
    readonly promptCount: number;
    readonly bookmarkCount: number;
    readonly heroImageUrl?: string;
    readonly customUrl?: string;
}

interface PromptOption {
    readonly id: string;
    readonly title: string;
    readonly tag: string;
    readonly tagLabel: string;
}

@Component({
    selector: 'app-collections-page',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule],
    templateUrl: './collections-page.component.html',
    styleUrl: './collections-page.component.css'
})
export class CollectionsPageComponent {
    private readonly authService = inject(AuthService);
    private readonly collectionService = inject(CollectionService);
    private readonly promptService = inject(PromptService);
    private readonly route = inject(ActivatedRoute);
    readonly router = inject(Router);
    private readonly fb = inject(FormBuilder);
    private readonly destroyRef = inject(DestroyRef);

    readonly currentUser$ = this.authService.currentUser$;

    readonly profile = signal<UserProfile | null>(null);
    readonly profileLoaded = signal(false);

    readonly viewMode = signal<'all' | 'bookmarked'>('all');
    readonly pageTitle = computed(() =>
        this.viewMode() === 'bookmarked' ? 'Bookmarked Collections' : 'Collections'
    );
    readonly searchPlaceholder = computed(() =>
        this.viewMode() === 'bookmarked' ? 'Search bookmarked collections…' : 'Search collections…'
    );
    readonly emptyStateTitle = computed(() =>
        this.viewMode() === 'bookmarked' ? 'No bookmarked prompts' : 'No collections yet'
    );
    readonly emptyStateDescription = computed(() =>
        this.viewMode() === 'bookmarked'
            ? 'Bookmark collections to see them here.'
            : 'Start by creating a collection to group your saved prompts.'
    );
    readonly showCreateButton = computed(() => this.viewMode() === 'all');

    readonly collections = signal<CollectionCard[]>([]);
    readonly availablePrompts = signal<PromptOption[]>([]);
    readonly searchTerm = signal('');
    readonly promptSearchTerm = signal('');
    readonly isLoadingCollections = signal(true);
    readonly loadCollectionsError = signal<string | null>(null);
    readonly isLoadingPrompts = signal(true);
    readonly loadPromptsError = signal<string | null>(null);
    readonly newCollectionModalOpen = signal(false);
    readonly isSavingCollection = signal(false);
    readonly collectionFormError = signal<string | null>(null);
    readonly customUrlError = signal<string | null>(null);
    readonly isCheckingCustomUrl = signal(false);
    private customUrlTimer: ReturnType<typeof setTimeout> | null = null;
    readonly uploadingBrandLogo = signal(false);
    readonly deletingBrandLogo = signal(false);
    readonly brandLogoUploadError = signal<string | null>(null);
    readonly brandLogoUrl = signal<string | null>(null);
    private brandLogoFile: File | null = null;
    readonly brandingSectionExpanded = signal(false);
    readonly menuOpen = signal(false);
    readonly menuTop = signal<number | null>(null);
    readonly menuRight = signal<number | null>(null);
    @ViewChild('avatarButton') avatarButtonRef?: ElementRef<HTMLButtonElement>;
    readonly clientId = signal('');
    readonly bookmarkedCollections = signal<Set<string>>(new Set());
    readonly bookmarkingCollections = signal<Set<string>>(new Set());

    readonly actorId = computed(() => {
        const user = this.authService.currentUser;
        if (user?.uid) {
            return `u_${user.uid}`;
        }

        const cid = this.clientId();
        return cid ? `c_${cid}` : '';
    });

    // Check if user is logged in
    readonly isLoggedIn = computed(() => {
        return !!this.authService.currentUser;
    });

    private readonly promptSelectionValidator: ValidatorFn = (
        control: AbstractControl<string[] | null>
    ): ValidationErrors | null => {
        const value = control.value;
        if (Array.isArray(value) && value.length > 0) {
            return null;
        }

        return { required: true };
    };

    readonly collectionForm = this.fb.nonNullable.group({
        name: ['', [Validators.required, Validators.minLength(3)]],
        tag: ['', [Validators.required, Validators.minLength(2)]],
        promptIds: this.fb.nonNullable.control<string[]>([], {
            validators: [this.promptSelectionValidator]
        }),
        customUrl: [''],
        blurb: [''],
        brandLink: [''],
        brandSubtext: ['']
    });

    readonly filteredCollections = computed(() => {
        const term = this.searchTerm().trim().toLowerCase();
        const viewMode = this.viewMode();
        const bookmarked = this.bookmarkedCollections();
        let collections = this.collections();

        if (viewMode === 'bookmarked') {
            collections = collections.filter(collection => bookmarked.has(collection.id));
        }

        if (!term) {
            return collections;
        }

        return collections.filter(collection => {
            const haystack = [collection.name, collection.tag, collection.tagLabel].join(' ').toLowerCase();
            return haystack.includes(term);
        });
    });

    readonly filteredPrompts = computed(() => {
        const term = this.promptSearchTerm().trim().toLowerCase();
        const prompts = this.availablePrompts();

        if (!term) {
            return prompts;
        }

        return prompts.filter(prompt => {
            const haystack = [prompt.title, prompt.tag, prompt.tagLabel].join(' ').toLowerCase();
            return haystack.includes(term);
        });
    });

    constructor() {
        this.ensureClientId();
        this.observeCollections();
        this.observePrompts();

        this.route.data
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(data => {
                const view = data?.['view'] === 'bookmarked' ? 'bookmarked' : 'all';
                this.viewMode.set(view);
            });

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
                this.profile.set(profile ?? null);
                this.profileLoaded.set(true);

                if (!profile) {
                    this.menuOpen.set(false);
                }

                void this.refreshBookmarkedCollections(this.collections());
            });
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

    openMenu() {
        if (!this.profile()) {
            return;
        }

        this.menuOpen.set(true);
    }

    toggleMenu() {
        if (!this.profile()) {
            return;
        }

        if (this.newCollectionModalOpen()) {
            return;
        }

        const isOpening = !this.menuOpen();
        this.menuOpen.update(open => !open);
        
        if (isOpening) {
            // Use setTimeout to ensure ViewChild is available and DOM is updated
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
            // On mobile, position below the button with some spacing
            // Ensure it doesn't go off screen at the bottom
            const menuHeight = 250; // Approximate menu height (increased for safety)
            const spacing = 12;
            let topPosition = rect.bottom + spacing;
            
            // If menu would go off screen, position it above the button instead
            if (topPosition + menuHeight > viewportHeight - 16) {
                topPosition = rect.top - menuHeight - spacing;
                // Ensure it doesn't go off screen at the top either
                if (topPosition < 16) {
                    topPosition = 16;
                }
            }
            
            // Ensure menu is always visible and not cut off
            this.menuTop.set(Math.max(16, Math.min(topPosition, viewportHeight - menuHeight - 16)));
            // On mobile, align to right with some margin
            this.menuRight.set(16);
        } else {
            // Desktop: Position menu below the button with some spacing
            this.menuTop.set(rect.bottom + 12);
            // Align right edge of menu with right edge of button
            this.menuRight.set(Math.max(16, viewportWidth - rect.right));
        }
    }

    closeMenu() {
        this.menuOpen.set(false);
    }

    async signOut() {
        if (!this.profile()) {
            await this.router.navigate(['/auth'], {
                queryParams: { redirectTo: this.router.url }
            });
            return;
        }

        this.closeMenu();
        await this.authService.signOut();
        await this.router.navigate(['/']);
    }

    onSearch(value: string) {
        this.searchTerm.set(value);
    }

    onPromptSearch(value: string) {
        this.promptSearchTerm.set(value);
    }

    openCreateCollectionModal() {
        if (!this.showCreateButton()) {
            return;
        }

        if (!this.profile()) {
            this.goToAuth();
            return;
        }

        this.closeMenu();
        this.collectionForm.reset({
            name: '',
            tag: '',
            promptIds: [],
            customUrl: '',
            blurb: '',
            brandLink: '',
            brandSubtext: ''
        });
        this.collectionForm.markAsPristine();
        this.collectionForm.markAsUntouched();
        this.collectionFormError.set(null);
        this.brandLogoUrl.set(null);
        this.brandLogoUploadError.set(null);
        this.brandLogoFile = null;
        this.promptSearchTerm.set(''); // Reset prompt search when opening modal
        this.newCollectionModalOpen.set(true);
    }

    closeCreateCollectionModal() {
        if (this.isSavingCollection()) {
            return;
        }

        this.newCollectionModalOpen.set(false);
        this.collectionFormError.set(null);
        this.brandLogoUrl.set(null);
        this.brandLogoUploadError.set(null);
        this.brandLogoFile = null;
        this.brandingSectionExpanded.set(false);
        this.collectionForm.markAsPristine();
        this.collectionForm.markAsUntouched();
    }

    togglePromptSelection(promptId: string) {
        const control = this.collectionForm.controls.promptIds;
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
        return this.collectionForm.controls.promptIds.value.includes(promptId);
    }

    readonly brandSubtextWordCount = computed(() => {
        const text = this.collectionForm.controls.brandSubtext.value?.trim() || '';
        if (!text) return 0;
        return text.split(/\s+/).filter(word => word.length > 0).length;
    });

    async submitCollectionForm() {
        if (this.collectionForm.invalid || this.customUrlError()) {
            this.collectionForm.markAllAsTouched();
            return;
        }

        const { name, tag, promptIds, customUrl, blurb, brandLink, brandSubtext } = this.collectionForm.getRawValue();
        
        // Validate brand subtext word limit (50 words)
        if (brandSubtext?.trim()) {
            const wordCount = brandSubtext.trim().split(/\s+/).filter(word => word.length > 0).length;
            if (wordCount > 50) {
                this.collectionFormError.set('Brand description must be 50 words or less.');
                return;
            }
        }
        const currentUser = this.authService.currentUser;
        const authorId = currentUser?.uid;

        this.isSavingCollection.set(true);
        this.collectionFormError.set(null);

        try {
            // Create collection first
            const collectionId = await this.collectionService.createCollection({
                name,
                tag,
                promptIds,
                customUrl: customUrl?.trim() || undefined,
                blurb: blurb?.trim() || undefined,
                brandLink: brandLink?.trim() || undefined,
                brandSubtext: brandSubtext?.trim() || undefined
            }, authorId);

            // Upload brand logo if file was selected
            if (this.brandLogoFile && authorId) {
                try {
                    const logoUrl = await this.collectionService.uploadBrandLogo(collectionId, this.brandLogoFile, authorId);
                    // Update collection with logo URL
                    await this.collectionService.updateCollection(collectionId, { brandLogoUrl: logoUrl }, authorId);
                } catch (logoError) {
                    console.error('Failed to upload brand logo', logoError);
                    // Don't fail the whole operation if logo upload fails
                }
            }

            this.newCollectionModalOpen.set(false);
            this.collectionForm.reset({
                name: '',
                tag: '',
                promptIds: [],
                customUrl: '',
                blurb: '',
                brandLink: '',
                brandSubtext: ''
            });
            this.collectionForm.markAsPristine();
            this.collectionForm.markAsUntouched();
            this.customUrlError.set(null);
            this.brandLogoUrl.set(null);
            this.brandLogoUploadError.set(null);
            this.brandLogoFile = null;
            this.clearCustomUrlDebounce();
        } catch (error) {
            console.error('Failed to create collection', error);
            this.collectionFormError.set(
                error instanceof Error ? error.message : 'Could not create the collection. Please try again.'
            );
        } finally {
            this.isSavingCollection.set(false);
        }
    }

    trackCollectionById(_: number, collection: CollectionCard) {
        return collection.id;
    }

    onCustomUrlInput(value: string) {
        const trimmed = String(value ?? '').trim();
        this.collectionForm.controls.customUrl.setValue(trimmed, { emitEvent: false });
        
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

        // Check for reserved paths (note: 'collection' is reserved for /collection/:customUrl route)
        const reservedPaths = ['home', 'auth', 'prompt', 'prompts', 'collections', 'collection', 'admin', 'verify-email', 'community-guidelines', 'profile'];
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
                const isTaken = await this.collectionService.isCustomUrlTaken(trimmed);
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

    trackPromptOptionById(_: number, prompt: PromptOption) {
        return prompt.id;
    }

    navigateToCollection(collection: CollectionCard) {
        if (!collection?.id) {
            return;
        }

        if (collection.customUrl) {
            void this.router.navigate(['/collection', collection.customUrl]);
        } else {
            void this.router.navigate(['/collections', collection.id]);
        }
    }

    navigateToSignUp() {
        this.router.navigate(['/auth'], { queryParams: { mode: 'signup' } });
    }

    goToAuth(mode: 'login' | 'signup' = 'login') {
        const redirect = this.router.url || '/collections';
        void this.router.navigate(['/auth'], {
            queryParams: {
                mode: mode === 'signup' ? 'signup' : 'login',
                redirectTo: redirect
            }
        });
    }

    private observeCollections() {
        this.collectionService
            .collections$()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: collections => {
                    const cards = collections.map(collection => this.mapCollectionToCard(collection));
                    this.collections.set(cards);
                    this.isLoadingCollections.set(false);
                    this.loadCollectionsError.set(null);
                    void this.refreshBookmarkedCollections(cards);
                },
                error: error => {
                    console.error('Failed to load collections', error);
                    this.isLoadingCollections.set(false);
                    this.loadCollectionsError.set('We could not load your collections. Please try again.');
                }
            });
    }

    private observePrompts() {
        this.promptService
            .prompts$()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: prompts => {
                    const options = prompts.map(prompt => this.mapPromptToOption(prompt));
                    this.availablePrompts.set(options);
                    this.isLoadingPrompts.set(false);
                    this.loadPromptsError.set(null);
                },
                error: error => {
                    console.error('Failed to load prompts for collection selection', error);
                    this.isLoadingPrompts.set(false);
                    this.loadPromptsError.set('We could not load your prompts. Creating a collection requires prompts.');
                }
            });
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
        if (this.newCollectionModalOpen()) {
            this.closeCreateCollectionModal();
            return;
        }

        if (this.menuOpen()) {
            this.closeMenu();
        }
    }

    private mapCollectionToCard(collection: PromptCollection): CollectionCard {
        const tag = collection.tag || 'general';
        // Always calculate from the current promptIds array to ensure accuracy
        const promptIds = collection.promptIds ?? [];
        const promptCount = Array.isArray(promptIds) ? promptIds.length : 0;
        return {
            id: collection.id,
            name: collection.name,
            tag,
            tagLabel: this.formatTagLabel(tag),
            promptCount,
            bookmarkCount: collection.bookmarkCount ?? 0,
            heroImageUrl: collection.heroImageUrl,
            customUrl: collection.customUrl
        };
    }

    private mapPromptToOption(prompt: Prompt): PromptOption {
        const tag = prompt.tag || 'general';
        return {
            id: prompt.id,
            title: prompt.title,
            tag,
            tagLabel: this.formatTagLabel(tag)
        };
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

    isCollectionBookmarked(id: string) {
        return this.bookmarkedCollections().has(id);
    }

    isCollectionBookmarking(id: string) {
        return this.bookmarkingCollections().has(id);
    }

    async toggleCollectionBookmark(collection: CollectionCard, event?: Event) {
        event?.stopPropagation();

        if (!collection?.id) {
            return;
        }

        const actor = this.actorId();
        if (!actor) {
            // Unable to identify actor (for example local storage disabled)
            return;
        }

        if (this.isCollectionBookmarking(collection.id)) {
            return;
        }

        this.bookmarkingCollections.update(prev => {
            const next = new Set(prev);
            next.add(collection.id);
            return next;
        });

        try {
            const result = await this.collectionService.toggleBookmark(collection.id, actor);

            this.bookmarkedCollections.update(prev => {
                const next = new Set(prev);
                if (result.bookmarked) {
                    next.add(collection.id);
                } else {
                    next.delete(collection.id);
                }
                return next;
            });

            this.collections.update(prev =>
                prev.map(item =>
                    item.id === collection.id
                        ? { ...item, bookmarkCount: result.bookmarkCount }
                        : item
                )
            );
        } catch (error) {
            console.error('Failed to toggle collection bookmark', error);
        } finally {
            this.bookmarkingCollections.update(prev => {
                const next = new Set(prev);
                next.delete(collection.id);
                return next;
            });
        }
    }

    private ensureClientId() {
        try {
            const key = 'rp_client_id';
            let id = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;

            if (!id) {
                id = `c_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
                try {
                    window.localStorage.setItem(key, id);
                } catch {
                    // ignore storage write failures
                }
            }

            this.clientId.set(id ?? '');
        } catch (error) {
            console.error('Failed to resolve client id', error);
            this.clientId.set('');
        }
    }

    private async refreshBookmarkedCollections(collections: readonly CollectionCard[]) {
        const actor = this.actorId();

        if (!actor) {
            this.bookmarkedCollections.set(new Set());
            return;
        }

        const ids = collections
            .map(collection => collection.id)
            .filter((id): id is string => typeof id === 'string' && id.length > 0);

        if (!ids.length) {
            this.bookmarkedCollections.set(new Set());
            return;
        }

        try {
            const results = await Promise.all(
                ids.map(async id => {
                    try {
                        const bookmarked = await this.collectionService.hasBookmarked(id, actor);
                        return bookmarked ? id : null;
                    } catch (error) {
                        console.error('Failed to determine bookmark state for collection', id, error);
                        return null;
                    }
                })
            );

            const bookmarkedSet = new Set(results.filter((id): id is string => !!id));
            this.bookmarkedCollections.set(bookmarkedSet);
        } catch (error) {
            console.error('Failed to refresh collection bookmarks', error);
        }
    }

    async onBrandLogoSelected(event: Event) {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        
        if (!file) {
            return;
        }

        // We need a collection ID to upload, but we're creating a new collection
        // So we'll store the file temporarily and upload it after collection creation
        // For now, let's just validate and show preview
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
                const result = e.target?.result as string;
                if (result) {
                    this.brandLogoUrl.set(result);
                }
            };
            reader.readAsDataURL(file);
        } catch (error) {
            console.error('Failed to process brand logo', error);
            this.brandLogoUploadError.set(
                error instanceof Error ? error.message : 'Failed to process image. Please try again.'
            );
        } finally {
            this.uploadingBrandLogo.set(false);
            // Reset the input
            input.value = '';
        }
    }

    async deleteBrandLogo() {
        if (!confirm('Are you sure you want to remove the brand logo?')) {
            return;
        }

        this.brandLogoUrl.set(null);
        this.brandLogoUploadError.set(null);
        this.brandLogoFile = null;
    }
}

