import { Routes } from '@angular/router';
import { requireAuthGuard, verifiedUserGuard } from './guards/auth.guard';

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
    path: '**',
    redirectTo: 'auth'
  }
];
