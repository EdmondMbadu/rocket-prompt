import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { AdminService, type AdminStats } from '../../services/admin.service';
import { PromptService } from '../../services/prompt.service';
import type { UserProfile } from '../../models/user-profile.model';
import type { Prompt } from '../../models/prompt.model';

@Component({
    selector: 'app-admin-dashboard',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './admin-dashboard.component.html',
    styleUrl: './admin-dashboard.component.css'
})
export class AdminDashboardComponent {
    private readonly authService = inject(AuthService);
    private readonly adminService = inject(AdminService);
    private readonly promptService = inject(PromptService);
    readonly router = inject(Router);
    private readonly destroyRef = inject(DestroyRef);

    readonly currentUser$ = this.authService.currentUser$;
    readonly profile$ = this.currentUser$.pipe(
        switchMap(user => {
            if (!user) {
                return of<UserProfile | undefined>(undefined);
            }
            return this.authService.userProfile$(user.uid);
        })
    );

    readonly users = signal<UserProfile[]>([]);
    readonly stats = signal<AdminStats | null>(null);
    readonly isLoading = signal(true);
    readonly error = signal<string | null>(null);
    readonly searchTerm = signal('');
    readonly isUsersExpanded = signal(false);

    // Prompts management
    readonly prompts = signal<Prompt[]>([]);
    readonly selectedPromptIds = signal<Set<string>>(new Set());
    readonly isPromptsExpanded = signal(false);
    readonly assignedAuthorId = signal('');
    readonly isProcessingBulkAction = signal(false);
    readonly promptsError = signal<string | null>(null);

    readonly filteredUsers = computed(() => {
        const users = this.users();
        const term = this.searchTerm().trim().toLowerCase();

        if (!term) {
            return users;
        }

        return users.filter(user => {
            const fullName = `${user.firstName} ${user.lastName}`.toLowerCase();
            const email = user.email?.toLowerCase() || '';
            return fullName.includes(term) || email.includes(term);
        });
    });

    readonly adminCount = computed(() =>
        this.users().filter(user => user.role === 'admin' || user.admin).length
    );

    constructor() {
        this.loadData();
        this.observeUsers();
        this.observePrompts();
    }

    loadData() {
        this.isLoading.set(true);
        this.error.set(null);

        Promise.all([
            this.adminService.fetchAdminStats(),
            this.adminService.fetchAllUsers()
        ])
            .then(([stats, users]) => {
                this.stats.set(stats);
                this.users.set(users);
                this.isLoading.set(false);
            })
            .catch(error => {
                console.error('Failed to load admin data', error);
                this.error.set('Failed to load admin data. Please try again.');
                this.isLoading.set(false);
            });
    }

    private observeUsers() {
        this.adminService
            .users$()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: users => {
                    this.users.set(users);
                },
                error: error => {
                    console.error('Failed to observe users', error);
                }
            });
    }

    private observePrompts() {
        this.promptService
            .allPrompts$()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: prompts => {
                    this.prompts.set(prompts);
                },
                error: error => {
                    console.error('Failed to observe prompts', error);
                    this.promptsError.set('Failed to load prompts.');
                }
            });
    }

    togglePromptSelection(promptId: string) {
        const selected = new Set(this.selectedPromptIds());
        if (selected.has(promptId)) {
            selected.delete(promptId);
        } else {
            selected.add(promptId);
        }
        this.selectedPromptIds.set(selected);
    }

    toggleSelectAll() {
        const selected = this.selectedPromptIds();
        const prompts = this.prompts();
        
        if (selected.size === prompts.length) {
            this.selectedPromptIds.set(new Set());
        } else {
            this.selectedPromptIds.set(new Set(prompts.map(p => p.id)));
        }
    }

    get allSelected(): boolean {
        const prompts = this.prompts();
        const selected = this.selectedPromptIds();
        return prompts.length > 0 && selected.size === prompts.length;
    }

    get someSelected(): boolean {
        const selected = this.selectedPromptIds();
        return selected.size > 0 && selected.size < this.prompts().length;
    }

    async onBulkAssignAuthor() {
        const selectedIds = Array.from(this.selectedPromptIds());
        const authorId = this.assignedAuthorId().trim();

        if (selectedIds.length === 0) {
            this.promptsError.set('Please select at least one prompt.');
            return;
        }

        if (!authorId) {
            this.promptsError.set('Please enter an author ID.');
            return;
        }

        this.isProcessingBulkAction.set(true);
        this.promptsError.set(null);

        try {
            await this.promptService.bulkAssignAuthor(selectedIds, authorId);
            this.selectedPromptIds.set(new Set());
            this.assignedAuthorId.set('');
        } catch (error) {
            console.error('Failed to assign author', error);
            this.promptsError.set(error instanceof Error ? error.message : 'Failed to assign author.');
        } finally {
            this.isProcessingBulkAction.set(false);
        }
    }

    async onBulkDelete() {
        const selectedIds = Array.from(this.selectedPromptIds());

        if (selectedIds.length === 0) {
            this.promptsError.set('Please select at least one prompt.');
            return;
        }

        const confirmed = window.confirm(
            `Are you sure you want to delete ${selectedIds.length} prompt(s)? This action cannot be undone.`
        );

        if (!confirmed) {
            return;
        }

        this.isProcessingBulkAction.set(true);
        this.promptsError.set(null);

        try {
            await this.promptService.bulkDeletePrompts(selectedIds);
            this.selectedPromptIds.set(new Set());
        } catch (error) {
            console.error('Failed to delete prompts', error);
            this.promptsError.set(error instanceof Error ? error.message : 'Failed to delete prompts.');
        } finally {
            this.isProcessingBulkAction.set(false);
        }
    }

    async onBulkToggleVisibility(isInvisible: boolean) {
        const selectedIds = Array.from(this.selectedPromptIds());

        if (selectedIds.length === 0) {
            this.promptsError.set('Please select at least one prompt.');
            return;
        }

        this.isProcessingBulkAction.set(true);
        this.promptsError.set(null);

        try {
            await this.promptService.bulkToggleVisibility(selectedIds, isInvisible);
            this.selectedPromptIds.set(new Set());
        } catch (error) {
            console.error('Failed to toggle visibility', error);
            this.promptsError.set(error instanceof Error ? error.message : 'Failed to toggle visibility.');
        } finally {
            this.isProcessingBulkAction.set(false);
        }
    }

    onSearch(term: string) {
        this.searchTerm.set(term);
    }

    formatDate(date: unknown): string {
        if (!date) return 'N/A';

        let d: Date | null = null;
        if (date instanceof Date) {
            d = date;
        } else if (date && typeof date === 'object') {
            if ('toDate' in date && typeof (date as { toDate: () => Date }).toDate === 'function') {
                d = (date as { toDate: () => Date }).toDate();
            }
        }

        if (!d) return 'N/A';

        return d.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }

    formatTag(tag: string): string {
        return tag
            .split(/[\s_-]+/)
            .filter(Boolean)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
    }

    getMaxValue(data: Array<{ count: number }>): number {
        if (data.length === 0) return 100;
        return Math.max(...data.map(d => d.count), 1);
    }

    getBarHeight(count: number, max: number): number {
        if (max === 0) return 0;
        return Math.max((count / max) * 100, 5);
    }

    formatMonth(month: string): string {
        const [year, monthNum] = month.split('-');
        const date = new Date(parseInt(year), parseInt(monthNum) - 1);
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
    }
}

