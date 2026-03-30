import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

/** Entrée de navigation dans la barre latérale. */
interface NavItem {
  label: string;
  route: string;
  icon: string;
}

/**
 * Composant de navigation latérale de l'application.
 * Affiche les liens vers tous les modules et expose `authService`
 * pour permettre la déconnexion depuis le template.
 */
@Component({
  selector: 'app-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './nav.component.html',
  styleUrl: './nav.component.scss',
})
export class NavComponent {
  /** Liste des entrées de navigation affichées dans la barre latérale. */
  readonly navItems: NavItem[] = [
    { label: 'PI Planning', route: '/pi-planning', icon: '📅' },
    { label: 'PBR / Refinement', route: '/pbr', icon: '🔍' },
    { label: 'Suivi & KPIs', route: '/suivi', icon: '📊' },
    { label: 'Historique', route: '/historique', icon: '🕓' },
    { label: 'Paramètres', route: '/parametres', icon: '⚙️' },
    { label: 'Logs', route: '/logs', icon: '🔎' },
    { label: 'KPI Train', route: '/train-kpi', icon: '🚂' },
    { label: 'Automatisations', route: '/automatisations', icon: '⚡' },
  ];

  constructor(public authService: AuthService) {}
}
