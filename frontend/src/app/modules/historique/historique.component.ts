import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Composant Historique.
 *
 * Module en cours de développement, prévu pour afficher l'historique
 * des sessions PBR et des changements de PI Planning.
 * Le contenu est délégué entièrement au template HTML.
 */
@Component({
  selector: 'app-historique',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './historique.component.html',
  styleUrl: './historique.component.scss',
})
export class HistoriqueComponent {}
