import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { map, switchMap, take } from 'rxjs/operators';
import { of } from 'rxjs';

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

export const adminGuard: CanActivateFn = (_route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.currentUser$.pipe(
    take(1),
    switchMap(user => {
      if (!user) {
        return of(router.createUrlTree(['/auth'], {
          queryParams: { redirectTo: state.url }
        }));
      }

      return authService.userProfile$(user.uid).pipe(
        take(1),
        map(profile => {
          if (profile?.role === 'admin' || profile?.admin) {
            return true;
          }

          return router.createUrlTree(['/home']);
        })
      );
    })
  );
};
