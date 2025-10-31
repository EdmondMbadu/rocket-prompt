import { CommonModule } from '@angular/common';
import { Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { Router } from '@angular/router';
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
    private readonly router = inject(Router);
    private readonly fb = inject(FormBuilder);
    private readonly destroyRef = inject(DestroyRef);

    readonly currentUser$ = this.authService.currentUser$;

    readonly profile = signal<UserProfile | null>(null);
    readonly profileLoaded = signal(false);

    readonly collections = signal<CollectionCard[]>([]);
    readonly availablePrompts = signal<PromptOption[]>([]);
    readonly searchTerm = signal('');
    readonly isLoadingCollections = signal(true);
    readonly loadCollectionsError = signal<string | null>(null);
    readonly isLoadingPrompts = signal(true);
    readonly loadPromptsError = signal<string | null>(null);
    readonly newCollectionModalOpen = signal(false);
    readonly isSavingCollection = signal(false);
    readonly collectionFormError = signal<string | null>(null);
    readonly menuOpen = signal(false);

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
        })
    });

    readonly filteredCollections = computed(() => {
        const term = this.searchTerm().trim().toLowerCase();
        const collections = this.collections();

        if (!term) {
            return collections;
        }

        return collections.filter(collection => {
            const haystack = [collection.name, collection.tag, collection.tagLabel].join(' ').toLowerCase();
            return haystack.includes(term);
        });
    });

    constructor() {
        this.observeCollections();
        this.observePrompts();

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

        this.menuOpen.update(open => !open);
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

    openCreateCollectionModal() {
        if (!this.profile()) {
            this.goToAuth();
            return;
        }

        this.closeMenu();
        this.collectionForm.reset({
            name: '',
            tag: '',
            promptIds: []
        });
        this.collectionForm.markAsPristine();
        this.collectionForm.markAsUntouched();
        this.collectionFormError.set(null);
        this.newCollectionModalOpen.set(true);
    }

    closeCreateCollectionModal() {
        if (this.isSavingCollection()) {
            return;
        }

        this.newCollectionModalOpen.set(false);
        this.collectionFormError.set(null);
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

    async submitCollectionForm() {
        if (this.collectionForm.invalid) {
            this.collectionForm.markAllAsTouched();
            return;
        }

        const { name, tag, promptIds } = this.collectionForm.getRawValue();

        this.isSavingCollection.set(true);
        this.collectionFormError.set(null);

        try {
            await this.collectionService.createCollection({
                name,
                tag,
                promptIds
            });

            this.newCollectionModalOpen.set(false);
            this.collectionForm.reset({
                name: '',
                tag: '',
                promptIds: []
            });
            this.collectionForm.markAsPristine();
            this.collectionForm.markAsUntouched();
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

    trackPromptOptionById(_: number, prompt: PromptOption) {
        return prompt.id;
    }

    navigateToCollection(collection: CollectionCard) {
        if (!collection?.id) {
            return;
        }

        void this.router.navigate(['/collections', collection.id]);
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
        return {
            id: collection.id,
            name: collection.name,
            tag,
            tagLabel: this.formatTagLabel(tag),
            promptCount: Array.isArray(collection.promptIds) ? collection.promptIds.length : 0
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
}

