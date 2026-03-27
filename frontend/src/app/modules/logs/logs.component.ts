import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { LLMLog } from '../../core/models';

/**
 * Composant de consultation des traces LLM et AZDO.
 *
 * Affiche la liste paginée des entrées `LLMLog` avec filtrage par type.
 * Un clic sur une entrée déroule son contenu complet (JSON formaté ou texte brut).
 *
 * Types de logs supportés :
 * - `LLM_REQUEST` : prompt envoyé au LLM
 * - `LLM_RESPONSE` : réponse reçue du LLM
 * - `AZDO_FETCH` : appel à l'API Azure DevOps
 * - `ERROR` : erreur survenue lors d'une opération LLM ou AZDO
 */
@Component({
  selector: 'app-logs',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './logs.component.html',
  styleUrl: './logs.component.scss',
})
export class LogsComponent implements OnInit {
  // ── Données ───────────────────────────────────────────────

  /** Logs chargés depuis l'API. */
  logs: LLMLog[] = [];

  /** Vrai pendant le chargement. */
  loading = false;

  /** Message d'erreur affiché si le chargement échoue. */
  error = '';

  /** Log dont le détail est actuellement affiché (toggle). */
  selectedLog: LLMLog | null = null;

  // ── Filtres ───────────────────────────────────────────────

  /** Type de log sélectionné pour le filtrage (`''` = tous les types). */
  filterType = '';

  /** Nombre maximum de logs à charger. */
  limit = 100;

  // ── Constantes de référence ───────────────────────────────

  /** Valeurs possibles pour le filtre de type (chaîne vide = pas de filtre). */
  readonly LOG_TYPES = ['', 'LLM_REQUEST', 'LLM_RESPONSE', 'AZDO_FETCH', 'ERROR'];

  /** Labels lisibles associés à chaque type de log. */
  readonly TYPE_LABELS: Record<string, string> = {
    LLM_REQUEST:  'Prompt LLM',
    LLM_RESPONSE: 'Réponse LLM',
    AZDO_FETCH:   'Fetch AZDO',
    ERROR:        'Erreur',
  };

  /** Classes CSS de badge associées à chaque type de log. */
  readonly TYPE_CLASSES: Record<string, string> = {
    LLM_REQUEST:  'badge--request',
    LLM_RESPONSE: 'badge--response',
    AZDO_FETCH:   'badge--azdo',
    ERROR:        'badge--error',
  };

  constructor(private api: ApiService) {}

  // ── Initialisation ────────────────────────────────────────

  /** Charge les logs au démarrage du composant. */
  ngOnInit(): void {
    this.load();
  }

  // ── Actions ───────────────────────────────────────────────

  /**
   * Charge (ou recharge) les logs depuis l'API selon les filtres actifs.
   * Efface le message d'erreur précédent avant chaque appel.
   */
  load(): void {
    this.loading = true;
    this.error = '';
    this.api.getLogs({
      log_type: this.filterType || undefined,
      limit: this.limit,
    }).subscribe({
      next: (logs) => { this.logs = logs; this.loading = false; },
      error: (err) => { this.error = err.message; this.loading = false; },
    });
  }

  /**
   * Sélectionne un log pour afficher son détail, ou le désélectionne s'il était déjà sélectionné.
   * @param log Log à afficher ou masquer.
   */
  select(log: LLMLog): void {
    this.selectedLog = this.selectedLog?.id === log.id ? null : log;
  }

  /**
   * Supprime tous les logs après confirmation utilisateur.
   */
  clearAll(): void {
    if (!confirm('Supprimer tous les logs ?')) return;
    this.api.clearLogs().subscribe(() => { this.logs = []; this.selectedLog = null; });
  }

  // ── Helpers template ──────────────────────────────────────

  /**
   * Tente de parser le contenu d'un log comme JSON et le reformate avec indentation.
   * Retourne le contenu brut si le parsing échoue.
   * @param content Contenu du log (`LLMLog.content`).
   */
  formatJson(content: string | null): string {
    if (!content) return '';
    try { return JSON.stringify(JSON.parse(content), null, 2); }
    catch { return content; }
  }

  /**
   * Formate une date ISO en locale française.
   * @param iso Chaîne de date ISO 8601.
   */
  formatDate(iso: string): string {
    return new Date(iso).toLocaleString('fr-FR');
  }

  /**
   * Retourne le label lisible d'un type de log.
   * @param t Valeur brute du type (ex : `"LLM_REQUEST"`).
   */
  typeLabel(t: string): string {
    return this.TYPE_LABELS[t] ?? t;
  }

  /**
   * Retourne la classe CSS de badge pour un type de log.
   * @param t Valeur brute du type (ex : `"AZDO_FETCH"`).
   */
  typeClass(t: string): string {
    return this.TYPE_CLASSES[t] ?? '';
  }
}
