import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { map, take } from 'rxjs/operators';

export const verifiedUserGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.currentUser$.pipe(
    take(1),
    map(user => {
      if (user && user.emailVerified) {
        return true;
      }

      if (user && !user.emailVerified) {
        return router.createUrlTree(['/verify-email']);
      }

      return router.createUrlTree(['/auth']);
    })
  );
};

export const requireAuthGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.currentUser$.pipe(
    take(1),
    map(user => {
      if (user) {
        return true;
      }

      return router.createUrlTree(['/auth']);
    })
  );
};
