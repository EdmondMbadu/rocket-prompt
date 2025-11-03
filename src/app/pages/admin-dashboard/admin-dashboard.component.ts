import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { AdminService, type AdminStats } from '../../services/admin.service';
import type { UserProfile } from '../../models/user-profile.model';

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

