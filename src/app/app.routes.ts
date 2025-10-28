import { Routes } from '@angular/router';
import { LandingPageComponent } from './pages/landing/landing-page.component';
import { AuthPageComponent } from './pages/auth/auth-page.component';
import { VerifyEmailComponent } from './pages/verify-email/verify-email.component';
import { HomeComponent } from './pages/home/home.component';
import { requireAuthGuard, verifiedUserGuard } from './guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    component: LandingPageComponent
  },
  {
    path: 'auth',
    component: AuthPageComponent
  },
  {
    path: 'verify-email',
    component: VerifyEmailComponent,
    canActivate: [requireAuthGuard]
  },
  {
    path: 'home',
    component: HomeComponent,
    canActivate: [verifiedUserGuard]
  },
  {
    path: '**',
    redirectTo: 'auth'
  }
];
