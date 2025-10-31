import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { map, take } from 'rxjs/operators';

export const verifiedUserGuard: CanActivateFn = (_route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.currentUser$.pipe(
    take(1),
    map(user => {
      if (user && user.emailVerified) {
        return true;
      }

      if (user && !user.emailVerified) {
        return router.createUrlTree(['/verify-email'], {
          queryParams: { redirectTo: state.url }
        });
      }

      return router.createUrlTree(['/auth'], {
        queryParams: { redirectTo: state.url }
      });
    })
  );
};

export const requireAuthGuard: CanActivateFn = (_route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.currentUser$.pipe(
    take(1),
    map(user => {
      if (user) {
        return true;
      }

      return router.createUrlTree(['/auth'], {
        queryParams: { redirectTo: state.url }
      });
    })
  );
};
