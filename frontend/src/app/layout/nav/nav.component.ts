import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

interface NavItem {
  label: string;
  route: string;
  icon: string;
}

@Component({
  selector: 'app-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './nav.component.html',
  styleUrl: './nav.component.scss',
})
export class NavComponent {
  readonly navItems: NavItem[] = [
    { label: 'PI Planning', route: '/pi-planning', icon: '📅' },
    { label: 'PBR / Refinement', route: '/pbr', icon: '🔍' },
    { label: 'Suivi & KPIs', route: '/suivi', icon: '📊' },
    { label: 'Historique', route: '/historique', icon: '🕓' },
    { label: 'Paramètres', route: '/parametres', icon: '⚙️' },
    { label: 'Logs', route: '/logs', icon: '🔎' },
  ];
}
