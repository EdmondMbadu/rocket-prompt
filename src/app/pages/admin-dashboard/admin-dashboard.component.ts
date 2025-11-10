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
import type { User } from 'firebase/auth';

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
    readonly isProcessingBulkUpload = signal(false);
    readonly bulkUploadProgress = signal({ processed: 0, total: 0, success: 0, failed: 0 });

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

    readonly promptCountsByUserId = computed(() => {
        const prompts = this.prompts();
        const counts = new Map<string, number>();
        
        prompts.forEach(prompt => {
            if (prompt.authorId) {
                counts.set(prompt.authorId, (counts.get(prompt.authorId) || 0) + 1);
            }
        });
        
        return counts;
    });

    getPromptCount(user: UserProfile): number {
        // Match by user.id (document ID, which is the Firebase Auth UID) or user.userId
        return this.promptCountsByUserId().get(user.id) || 
               this.promptCountsByUserId().get(user.userId) || 
               0;
    }

    navigateToUserProfile(user: UserProfile, event: Event): void {
        event.preventDefault();
        event.stopPropagation();
        
        if (user.username) {
            void this.router.navigate(['/profile', user.username]);
        } else {
            // Fallback to userId if username not available
            const userId = user.id || user.userId;
            if (userId) {
                void this.router.navigate(['/profile'], { queryParams: { userId } });
            }
        }
    }

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

    async onBulkUploadCSV(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];

        if (!file) {
            return;
        }

        // Reset file input
        input.value = '';

        // Get current user
        const user = await new Promise<User | null>((resolve) => {
            const sub = this.currentUser$.subscribe(u => {
                resolve(u);
                sub.unsubscribe();
            });
        });

        if (!user) {
            this.promptsError.set('You must be logged in to upload prompts.');
            return;
        }

        this.isProcessingBulkUpload.set(true);
        this.promptsError.set(null);
        this.bulkUploadProgress.set({ processed: 0, total: 0, success: 0, failed: 0 });

        try {
            const text = await file.text();
            const rows = this.parseCSV(text);

            if (rows.length === 0) {
                throw new Error('CSV file is empty or invalid.');
            }

            // Validate header row
            const headers = rows[0];
            const requiredHeaders = ['title', 'content', 'tag'];
            const missingHeaders = requiredHeaders.filter(h => !headers.includes(h.toLowerCase()));

            if (missingHeaders.length > 0) {
                throw new Error(`Missing required columns: ${missingHeaders.join(', ')}. Required columns are: title, content, tag. Optional columns: customUrl, views, likes, launchGpt, launchGemini, launchClaude, copied, isInvisible`);
            }

            // Process data rows (skip header)
            const dataRows = rows.slice(1);
            this.bulkUploadProgress.set({ processed: 0, total: dataRows.length, success: 0, failed: 0 });

            let successCount = 0;
            let failedCount = 0;
            const errors: string[] = [];

            for (let i = 0; i < dataRows.length; i++) {
                const row = dataRows[i];
                const rowData: Record<string, string> = {};

                // Map row values to headers
                headers.forEach((header, index) => {
                    rowData[header.toLowerCase()] = row[index]?.trim() || '';
                });

                try {
                    const title = rowData['title'];
                    const content = rowData['content'];
                    const tag = rowData['tag'];
                    const customUrl = rowData['customurl'] || rowData['custom_url'] || '';
                    const views = this.parseNumber(rowData['views'], 0);
                    const likes = this.parseNumber(rowData['likes'], 0);
                    const launchGpt = this.parseNumber(rowData['launchgpt'] || rowData['launch_gpt'], 0);
                    const launchGemini = this.parseNumber(rowData['launchgemini'] || rowData['launch_gemini'], 0);
                    const launchClaude = this.parseNumber(rowData['launchclaude'] || rowData['launch_claude'], 0);
                    const copied = this.parseNumber(rowData['copied'], 0);
                    const isInvisible = this.parseBoolean(rowData['isinvisible'] || rowData['is_invisible'], false);

                    if (!title || !content || !tag) {
                        throw new Error(`Row ${i + 2}: Missing required fields (title, content, or tag)`);
                    }

                    const promptId = await this.promptService.createPrompt({
                        authorId: user.uid,
                        title,
                        content,
                        tag,
                        customUrl: customUrl || undefined,
                        views,
                        likes,
                        launchGpt,
                        launchGemini,
                        launchClaude,
                        copied
                    });

                    // If isInvisible is true, update the prompt after creation
                    if (isInvisible) {
                        await this.promptService.bulkToggleVisibility([promptId], true);
                    }

                    successCount++;
                } catch (error) {
                    failedCount++;
                    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                    errors.push(`Row ${i + 2}: ${errorMsg}`);
                }

                this.bulkUploadProgress.set({
                    processed: i + 1,
                    total: dataRows.length,
                    success: successCount,
                    failed: failedCount
                });
            }

            if (failedCount > 0) {
                this.promptsError.set(
                    `Upload completed with ${failedCount} error(s). ${successCount} prompt(s) created successfully. ` +
                    `Errors: ${errors.slice(0, 5).join('; ')}${errors.length > 5 ? ` (and ${errors.length - 5} more)` : ''}`
                );
            } else {
                this.promptsError.set(null);
                // Show success message briefly
                setTimeout(() => {
                    if (this.promptsError() === null) {
                        // Could show a success toast here
                    }
                }, 100);
            }
        } catch (error) {
            console.error('Failed to process CSV', error);
            this.promptsError.set(error instanceof Error ? error.message : 'Failed to process CSV file.');
        } finally {
            this.isProcessingBulkUpload.set(false);
        }
    }

    private parseCSV(text: string): string[][] {
        const rows: string[][] = [];
        let currentRow: string[] = [];
        let currentField = '';
        let inQuotes = false;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const nextChar = text[i + 1];

            if (char === '"') {
                if (inQuotes && nextChar === '"') {
                    // Escaped quote
                    currentField += '"';
                    i++; // Skip next quote
                } else {
                    // Toggle quote state
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                // End of field
                currentRow.push(currentField);
                currentField = '';
            } else if ((char === '\n' || char === '\r') && !inQuotes) {
                // End of row
                if (char === '\r' && nextChar === '\n') {
                    i++; // Skip \n in \r\n
                }
                if (currentField || currentRow.length > 0) {
                    currentRow.push(currentField);
                    rows.push(currentRow);
                    currentRow = [];
                    currentField = '';
                }
            } else {
                currentField += char;
            }
        }

        // Add last field and row if any
        if (currentField || currentRow.length > 0) {
            currentRow.push(currentField);
            rows.push(currentRow);
        }

        return rows;
    }

    private parseNumber(value: string, defaultValue: number): number {
        if (!value) return defaultValue;
        const parsed = parseInt(value, 10);
        return isNaN(parsed) ? defaultValue : Math.max(0, parsed);
    }

    private parseBoolean(value: string, defaultValue: boolean): boolean {
        if (!value) return defaultValue;
        const lower = value.toLowerCase().trim();
        return lower === 'true' || lower === '1' || lower === 'yes';
    }
}

