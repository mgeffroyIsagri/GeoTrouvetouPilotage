import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'pi-planning',
    pathMatch: 'full',
  },
  {
    path: 'pi-planning',
    loadComponent: () =>
      import('./modules/pi-planning/pi-planning.component').then((m) => m.PiPlanningComponent),
  },
  {
    path: 'pbr',
    loadComponent: () =>
      import('./modules/pbr/pbr.component').then((m) => m.PbrComponent),
  },
  {
    path: 'suivi',
    loadComponent: () =>
      import('./modules/suivi/suivi.component').then((m) => m.SuiviComponent),
  },
  {
    path: 'historique',
    loadComponent: () =>
      import('./modules/historique/historique.component').then((m) => m.HistoriqueComponent),
  },
  {
    path: 'parametres',
    loadComponent: () =>
      import('./modules/parametres/parametres.component').then((m) => m.ParametresComponent),
  },
  {
    path: 'logs',
    loadComponent: () =>
      import('./modules/logs/logs.component').then((m) => m.LogsComponent),
  },
  {
    path: '**',
    redirectTo: 'pi-planning',
  },
];
