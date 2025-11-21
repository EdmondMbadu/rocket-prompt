import { Routes } from '@angular/router';
import { adminGuard, requireAuthGuard, verifiedUserGuard } from './guards/auth.guard';
import { promptLaunchMatcher } from './routes/prompt-launch.matcher';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/landing/landing-page.component').then(m => m.LandingPageComponent)
  },
  {
    path: 'try-rocketprompt',
    loadComponent: () =>
      import('./pages/demo-prompt/demo-prompt.component').then(m => m.DemoPromptComponent)
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
    path: 'pricing',
    canActivate: [verifiedUserGuard],
    loadComponent: () =>
      import('./pages/pricing/pricing-page.component').then(m => m.PricingPageComponent)
  },
  {
    path: 'profile',
    loadComponent: () =>
      import('./pages/profile/profile-page.component').then(m => m.ProfilePageComponent)
  },
  {
    path: 'profile/:username',
    loadComponent: () =>
      import('./pages/profile/profile-page.component').then(m => m.ProfilePageComponent)
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
    path: 'collection/:customUrl',
    // Collection by custom URL (e.g., /collection/my-custom-url)
    loadComponent: () =>
      import('./pages/collection-detail/collection-detail.component').then(m => m.CollectionDetailComponent)
  },
  {
    path: 'collections/:id',
    loadComponent: () =>
      import('./pages/collection-detail/collection-detail.component').then(m => m.CollectionDetailComponent)
  },
  {
    path: 'prompt/:id',
    // single prompt view — accepts full id, short prefix, or custom URL
    loadComponent: () => import('./pages/prompt/prompt-page.component').then(m => m.PromptPageComponent)
  },
  {
    path: 'prompt/:id/:target',
    loadComponent: () =>
      import('./pages/prompt-launch/prompt-launch.component').then(m => m.PromptLaunchComponent)
  },
  {
    path: 'admin',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./pages/admin-dashboard/admin-dashboard.component').then(m => m.AdminDashboardComponent)
  },
  {
    path: 'community-guidelines',
    loadComponent: () =>
      import('./pages/community-guidelines/community-guidelines.component').then(m => m.CommunityGuidelinesComponent)
  },
  {
    path: 'organizations',
    loadComponent: () =>
      import('./pages/organizations/organizations-page.component').then(m => m.OrganizationsPageComponent)
  },
  {
    path: 'organization/:username',
    loadComponent: () =>
      import('./pages/organization-profile/organization-profile.component').then(m => m.OrganizationProfileComponent)
  },
  {
    path: 'organizations/create',
    loadComponent: () =>
      import('./pages/create-organization/create-organization.component').then(m => m.CreateOrganizationComponent)
  },
  {
    path: ':customUrl',
    // Catch-all for custom URLs (e.g., /my-custom-url)
    // This route must come after all specific routes but before the final ** catch-all
    loadComponent: () => import('./pages/prompt/prompt-page.component').then(m => m.PromptPageComponent)
  },
  {
    matcher: promptLaunchMatcher,
    loadComponent: () =>
      import('./pages/prompt-launch/prompt-launch.component').then(m => m.PromptLaunchComponent)
  },
  {
    path: '**',
    redirectTo: 'auth'
  }
];
