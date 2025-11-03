import { Routes } from '@angular/router';
import { adminGuard, requireAuthGuard, verifiedUserGuard } from './guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/landing/landing-page.component').then(m => m.LandingPageComponent)
  },
  {
    path: 'auth',
    loadComponent: () =>
      import('./pages/auth/auth-page.component').then(m => m.AuthPageComponent)
  },
  {
    path: 'verify-email',
    canActivate: [requireAuthGuard],
    loadComponent: () =>
      import('./pages/verify-email/verify-email.component').then(m => m.VerifyEmailComponent)
  },
  {
    path: 'home',
    canActivate: [verifiedUserGuard],
    loadComponent: () =>
      import('./pages/home/home.component').then(m => m.HomeComponent)
  },
  {
    path: 'prompts/liked',
    loadComponent: () =>
      import('./pages/liked-prompts/liked-prompts-page.component').then(m => m.LikedPromptsPageComponent)
  },
  {
    path: 'collections',
    loadComponent: () =>
      import('./pages/collections/collections-page.component').then(m => m.CollectionsPageComponent)
  },
  {
    path: 'collections/bookmarked',
    loadComponent: () =>
      import('./pages/collections/collections-page.component').then(m => m.CollectionsPageComponent),
    data: {
      view: 'bookmarked'
    }
  },
  {
    path: 'collections/:id',
    loadComponent: () =>
      import('./pages/collection-detail/collection-detail.component').then(m => m.CollectionDetailComponent)
  },
  {
    path: 'prompt/:id',
    // single prompt view — accepts full id or short prefix
    loadComponent: () => import('./pages/prompt/prompt-page.component').then(m => m.PromptPageComponent)
  },
  {
    path: 'admin',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./pages/admin-dashboard/admin-dashboard.component').then(m => m.AdminDashboardComponent)
  },
  {
    path: '**',
    redirectTo: 'auth'
  }
];
