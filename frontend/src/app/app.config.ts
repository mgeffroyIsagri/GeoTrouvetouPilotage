import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';

import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';

/**
 * Configuration racine de l'application Angular (standalone bootstrap).
 *
 * Fournit :
 * - `provideZoneChangeDetection` avec coalescence d'événements pour limiter les cycles de détection.
 * - `provideRouter` avec les routes lazy-loadées définies dans `app.routes.ts`.
 * - `provideHttpClient` avec l'intercepteur JWT `authInterceptor`.
 * - `provideAnimations` pour les transitions Angular Material / CSS.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideAnimations(),
  ],
};
