import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * Intercepteur HTTP fonctionnel Angular qui :
 * - Injecte l'en-tête `Authorization: Bearer <token>` sur toutes les requêtes sortantes
 *   (sauf la route de login elle-même pour éviter une boucle).
 * - Déconnecte automatiquement l'utilisateur en cas de réponse `401 Unauthorized`.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // Ne pas ajouter le header sur la route de login elle-même
  const isLoginRequest = req.url.includes('/auth/login');
  const token = authService.getToken();

  const authReq = token && !isLoginRequest
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authReq).pipe(
    catchError((err) => {
      if (err.status === 401 && !isLoginRequest) {
        authService.logout();
      }
      return throwError(() => err);
    })
  );
};
