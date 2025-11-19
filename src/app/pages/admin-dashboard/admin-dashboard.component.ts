import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { AdminService, type AdminStats } from '../../services/admin.service';
import { PromptService } from '../../services/prompt.service';
import { HomeContentService } from '../../services/home-content.service';
import type { UserProfile } from '../../models/user-profile.model';
import type { Prompt } from '../../models/prompt.model';
import type { HomeContent } from '../../models/home-content.model';
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
    private readonly homeContentService = inject(HomeContentService);
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

    // Home content management
    readonly isHomeContentExpanded = signal(false);
    readonly homeContent = signal<HomeContent | null>(null);
    readonly dailyTipText = signal('');
    readonly dailyTipAuthor = signal('');
    readonly promptOfTheDayId = signal('');
    readonly promptSearchTerm = signal('');
    readonly isSavingHomeContent = signal(false);
    readonly homeContentError = signal<string | null>(null);
    readonly homeContentSuccess = signal<string | null>(null);

    // Metrics for all prompts
    readonly totalLaunches = computed(() => {
        return this.prompts().reduce((sum, prompt) => sum + (prompt.totalLaunch || 0), 0);
    });
    readonly launchBreakdown = computed(() => {
        const prompts = this.prompts();
        const stats = [
            {
                id: 'gpt',
                label: 'ChatGPT',
                subtext: 'OpenAI',
                count: prompts.reduce((sum, prompt) => sum + (prompt.launchGpt || 0), 0),
                icon: 'assets/gpt.png',
                colorClass: 'bg-[#74AA9C]',
                bgClass: 'bg-emerald-50',
                isImage: true,
                emoji: '🤖'
            },
            {
                id: 'gemini',
                label: 'Gemini',
                subtext: 'Google',
                count: prompts.reduce((sum, prompt) => sum + (prompt.launchGemini || 0), 0),
                icon: 'assets/gemini.png',
                colorClass: 'bg-gradient-to-r from-blue-500 to-blue-600',
                bgClass: 'bg-blue-50',
                isImage: true
            },
            {
                id: 'claude',
                label: 'Claude',
                subtext: 'Anthropic',
                count: prompts.reduce((sum, prompt) => sum + (prompt.launchClaude || 0), 0),
                icon: 'assets/claude.jpeg',
                colorClass: 'bg-[#D97757]',
                bgClass: 'bg-orange-50',
                isImage: true
            },
            {
                id: 'grok',
                label: 'Grok',
                subtext: 'xAI',
                count: prompts.reduce((sum, prompt) => sum + (prompt.launchGrok || 0), 0),
                icon: 'assets/grok.jpg',
                colorClass: 'bg-slate-800',
                bgClass: 'bg-slate-100',
                isImage: true
            },
            {
                id: 'copied',
                label: 'Copied',
                subtext: 'Clipboard',
                count: prompts.reduce((sum, prompt) => sum + (prompt.copied || 0), 0),
                icon: 'copy-icon', // Special handling for SVG
                colorClass: 'bg-gray-500',
                bgClass: 'bg-gray-50',
                isImage: false
            }
        ];

        return stats.sort((a, b) => b.count - a.count);
    });



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

    readonly filteredPromptsForSelection = computed(() => {
        const prompts = this.prompts();
        const term = this.promptSearchTerm().trim().toLowerCase();

        if (!term) {
            return prompts.slice(0, 10); // Show first 10 if no search
        }

        return prompts.filter(prompt => {
            const title = prompt.title?.toLowerCase() || '';
            const tag = prompt.tag?.toLowerCase() || '';
            return title.includes(term) || tag.includes(term);
        }).slice(0, 20); // Limit to 20 results
    });

    readonly adminCount = computed(() =>
        this.users().filter(user => user.role === 'admin' || user.admin).length
    );

    readonly userGrowthMax = computed(() => {
        const stats = this.stats();
        if (!stats?.usersByMonth?.length) return 10; // Default max
        return Math.max(...stats.usersByMonth.map(d => d.count), 1);
    });

    readonly userGrowthPath = computed(() => {
        const stats = this.stats();
        if (!stats?.usersByMonth?.length) return '';
        return this.generateChartPath(stats.usersByMonth.map(d => d.count), this.userGrowthMax());
    });

    readonly userGrowthAreaPath = computed(() => {
        const stats = this.stats();
        if (!stats?.usersByMonth?.length) return '';
        return this.generateAreaPath(stats.usersByMonth.map(d => d.count), this.userGrowthMax());
    });

    readonly promptGrowthMax = computed(() => {
        const stats = this.stats();
        if (!stats?.promptsByMonth?.length) return 10; // Default max
        return Math.max(...stats.promptsByMonth.map(d => d.count), 1);
    });

    readonly promptGrowthPath = computed(() => {
        const stats = this.stats();
        if (!stats?.promptsByMonth?.length) return '';
        return this.generateChartPath(stats.promptsByMonth.map(d => d.count), this.promptGrowthMax());
    });

    readonly promptGrowthAreaPath = computed(() => {
        const stats = this.stats();
        if (!stats?.promptsByMonth?.length) return '';
        return this.generateAreaPath(stats.promptsByMonth.map(d => d.count), this.promptGrowthMax());
    });

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
        this.observeHomeContent();
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



    formatMonth(month: string): string {
        const [year, monthNum] = month.split('-');
        const date = new Date(parseInt(year), parseInt(monthNum) - 1);
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
    }

    getBarHeight(count: number, max: number): number {
        if (max === 0) return 0;
        // Ensure we don't exceed 100% and have a minimum visibility
        return Math.min(Math.max((count / max) * 100, 5), 100);
    }

    generateChartPath(data: number[], max: number): string {
        if (data.length < 2) return '';

        const points = data.map((val, index) => {
            const x = (index / (data.length - 1)) * 100;
            // Invert Y because SVG 0 is at top
            const y = 100 - (val / max) * 100;
            return `${x},${y}`;
        });

        return `M ${points.join(' L ')}`;
    }

    generateAreaPath(data: number[], max: number): string {
        if (data.length < 2) return '';
        const linePath = this.generateChartPath(data, max);
        return `${linePath} L 100,100 L 0,100 Z`;
    }

    getYAxisLabels(max: number): number[] {
        // Returns 3 labels: Max, Half, 0 (implied at bottom)
        // We'll just return [Max, Max/2] for display
        if (max <= 0) return [10, 5];
        return [max, Math.round(max / 2)];
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

    private observeHomeContent() {
        this.homeContentService
            .homeContent$()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (content) => {
                    this.homeContent.set(content);
                    if (content?.dailyTip) {
                        this.dailyTipText.set(content.dailyTip.text);
                        this.dailyTipAuthor.set(content.dailyTip.author || '');
                    } else {
                        this.dailyTipText.set('');
                        this.dailyTipAuthor.set('');
                    }
                    if (content?.promptOfTheDayId) {
                        this.promptOfTheDayId.set(content.promptOfTheDayId);
                        this.promptSearchTerm.set(''); // Clear search when prompt is loaded
                    } else {
                        this.promptOfTheDayId.set('');
                        this.promptSearchTerm.set('');
                    }
                },
                error: (error) => {
                    console.error('Failed to observe home content', error);
                }
            });
    }

    async saveHomeContent() {
        const currentUser = this.authService.currentUser;
        if (!currentUser) {
            this.homeContentError.set('You must be logged in to save home content.');
            return;
        }

        this.isSavingHomeContent.set(true);
        this.homeContentError.set(null);
        this.homeContentSuccess.set(null);

        try {
            // Normalize prompt ID to full ID if partial ID was entered
            let promptId = this.promptOfTheDayId().trim();
            if (promptId) {
                const prompt = this.prompts().find(p => p.id === promptId || p.id.startsWith(promptId));
                if (prompt) {
                    promptId = prompt.id; // Use full ID
                } else {
                    this.homeContentError.set('Prompt not found. Please check the prompt ID.');
                    this.isSavingHomeContent.set(false);
                    return;
                }
            }

            await this.homeContentService.updateHomeContent(
                {
                    dailyTip: {
                        text: this.dailyTipText().trim(),
                        author: this.dailyTipAuthor().trim() || undefined
                    },
                    promptOfTheDayId: promptId || undefined
                },
                currentUser.uid
            );

            this.homeContentSuccess.set('Home content saved successfully!');
            setTimeout(() => {
                this.homeContentSuccess.set(null);
            }, 3000);
        } catch (error) {
            console.error('Failed to save home content', error);
            this.homeContentError.set(
                error instanceof Error ? error.message : 'Failed to save home content. Please try again.'
            );
        } finally {
            this.isSavingHomeContent.set(false);
        }
    }

    getPromptTitle(promptId: string): string {
        if (!promptId.trim()) {
            return '';
        }
        // Support both full ID and partial ID (first 8 characters)
        const prompt = this.prompts().find(p => p.id === promptId.trim() || p.id.startsWith(promptId.trim()));
        return prompt?.title || 'Prompt not found';
    }

    getTodayDateString(): string {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    selectPromptForDay(prompt: Prompt) {
        this.promptOfTheDayId.set(prompt.id);
        this.promptSearchTerm.set(''); // Clear search after selection
    }

    onPromptSearch(term: string) {
        this.promptSearchTerm.set(term);
    }

    async clearAllHomeContent() {
        const currentUser = this.authService.currentUser;
        if (!currentUser) {
            this.homeContentError.set('You must be logged in to clear home content.');
            return;
        }

        // Clear local fields first
        this.dailyTipText.set('');
        this.dailyTipAuthor.set('');
        this.promptOfTheDayId.set('');
        this.promptSearchTerm.set('');
        this.homeContentError.set(null);
        this.homeContentSuccess.set(null);

        // Also save empty values to Firestore to persist the clear
        this.isSavingHomeContent.set(true);
        try {
            await this.homeContentService.updateHomeContent(
                {
                    dailyTip: {
                        text: '',
                        author: undefined
                    },
                    promptOfTheDayId: '' // Pass empty string to trigger clearing in service
                },
                currentUser.uid
            );

            this.homeContentSuccess.set('All fields cleared successfully!');
            setTimeout(() => {
                this.homeContentSuccess.set(null);
            }, 3000);
        } catch (error) {
            console.error('Failed to clear home content', error);
            this.homeContentError.set(
                error instanceof Error ? error.message : 'Failed to clear home content. Please try again.'
            );
        } finally {
            this.isSavingHomeContent.set(false);
        }
    }
}

