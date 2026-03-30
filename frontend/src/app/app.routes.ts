import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

/**
 * Configuration des routes de l'application GeoTrouvetouPilotage.
 *
 * Toutes les routes fonctionnelles sont protégées par `authGuard`.
 * Les composants sont chargés en lazy-loading pour optimiser le bundle initial.
 * La route par défaut et le wildcard redirigent vers `pi-planning`.
 */
export const routes: Routes = [
  // ── Authentification ────────────────────────────────────────────────────────
  {
    path: 'login',
    loadComponent: () =>
      import('./modules/login/login.component').then((m) => m.LoginComponent),
  },

  // ── Redirection racine ───────────────────────────────────────────────────────
  {
    path: '',
    redirectTo: 'pi-planning',
    pathMatch: 'full',
  },

  // ── Modules protégés ─────────────────────────────────────────────────────────
  {
    path: 'pi-planning',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./modules/pi-planning/pi-planning.component').then((m) => m.PiPlanningComponent),
  },
  {
    path: 'pbr',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./modules/pbr/pbr.component').then((m) => m.PbrComponent),
  },
  {
    path: 'suivi',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./modules/suivi/suivi.component').then((m) => m.SuiviComponent),
  },
  {
    path: 'historique',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./modules/historique/historique.component').then((m) => m.HistoriqueComponent),
  },
  {
    path: 'parametres',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./modules/parametres/parametres.component').then((m) => m.ParametresComponent),
  },
  {
    path: 'logs',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./modules/logs/logs.component').then((m) => m.LogsComponent),
  },
  {
    path: 'train-kpi',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./modules/train-kpi/train-kpi.component').then((m) => m.TrainKpiComponent),
  },

  {
    path: 'automatisations',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./modules/automatisations/automatisations.component').then((m) => m.AutomatisationsComponent),
  },

  // ── Fallback ─────────────────────────────────────────────────────────────────
  {
    path: '**',
    redirectTo: 'pi-planning',
  },
];
