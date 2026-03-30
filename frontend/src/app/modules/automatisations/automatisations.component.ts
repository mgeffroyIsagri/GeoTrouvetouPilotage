import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';

/** Représente un trigger d'automatisation planifiée. */
interface TriggerItem {
  id: number;
  name: string;
  action_type: string;
  action_params: Record<string, any>;
  schedule_type: 'interval' | 'daily' | 'cron';
  schedule_value: string;
  enabled: boolean;
  last_run_at: string | null;
  last_run_status: 'success' | 'error' | 'running' | null;
  last_run_summary: string | null;
  next_run_at: string | null;
  created_at: string;
}

/** Entrée de log d'exécution d'un trigger. */
interface TriggerLog {
  id: number;
  ran_at: string;
  status: 'success' | 'error';
  duration_ms: number | null;
  result_summary: string | null;
  result_detail: any;
}

/** Modèle du formulaire de création/édition. */
interface TriggerForm {
  name: string;
  action_type: string;
  lookback_days: number;
  schedule_type: 'interval' | 'daily' | 'cron';
  schedule_value: string;
  enabled: boolean;
}

/**
 * Composant de gestion des triggers d'automatisation planifiée.
 *
 * Permet de créer, modifier, activer/désactiver et exécuter manuellement
 * des triggers tels que la synchronisation AZDO incrémentale.
 */
@Component({
  selector: 'app-automatisations',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './automatisations.component.html',
  styleUrl: './automatisations.component.scss',
})
export class AutomatisationsComponent implements OnInit {
  // ── Données ───────────────────────────────────────────────

  triggers: TriggerItem[] = [];
  loading = false;
  error = '';

  // ── Sélection & logs ──────────────────────────────────────

  /** Trigger dont le panneau de logs est affiché. */
  selectedTriggerId: number | null = null;
  triggerLogs: TriggerLog[] = [];
  logsLoading = false;

  /** Log dont le détail JSON est affiché. */
  selectedLog: TriggerLog | null = null;

  // ── Formulaire ────────────────────────────────────────────

  showForm = false;
  /** ID du trigger en cours d'édition (null = création). */
  editingTriggerId: number | null = null;

  form: TriggerForm = {
    name: '',
    action_type: 'azdo_sync_incremental',
    lookback_days: 1,
    schedule_type: 'interval',
    schedule_value: '60',
    enabled: true,
  };

  formError = '';
  formSaving = false;

  // ── État des actions ──────────────────────────────────────

  runningTriggers = new Set<number>();

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.loadTriggers();
  }

  // ── Chargement ────────────────────────────────────────────

  loadTriggers(): void {
    this.loading = true;
    this.error = '';
    this.api.getTriggers().subscribe({
      next: (data) => {
        this.triggers = data;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.detail || 'Erreur lors du chargement des triggers';
        this.loading = false;
      },
    });
  }

  // ── Formulaire ────────────────────────────────────────────

  openCreateForm(): void {
    this.editingTriggerId = null;
    this.form = {
      name: '',
      action_type: 'azdo_sync_incremental',
      lookback_days: 1,
      schedule_type: 'interval',
      schedule_value: '60',
      enabled: true,
    };
    this.formError = '';
    this.showForm = true;
  }

  openEditForm(trigger: TriggerItem): void {
    this.editingTriggerId = trigger.id;
    this.form = {
      name: trigger.name,
      action_type: trigger.action_type,
      lookback_days: trigger.action_params?.['lookback_days'] ?? 1,
      schedule_type: trigger.schedule_type,
      schedule_value: trigger.schedule_value,
      enabled: trigger.enabled,
    };
    this.formError = '';
    this.showForm = true;
    this.selectedTriggerId = null;
    this.triggerLogs = [];
  }

  cancelForm(): void {
    this.showForm = false;
    this.editingTriggerId = null;
    this.formError = '';
  }

  saveForm(): void {
    if (!this.form.name.trim()) {
      this.formError = 'Le nom est obligatoire.';
      return;
    }
    if (!this.form.schedule_value.trim()) {
      this.formError = 'La valeur de planification est obligatoire.';
      return;
    }

    this.formSaving = true;
    this.formError = '';

    const payload = {
      name: this.form.name.trim(),
      action_type: this.form.action_type,
      action_params: { lookback_days: this.form.lookback_days },
      schedule_type: this.form.schedule_type,
      schedule_value: this.form.schedule_value.trim(),
      enabled: this.form.enabled,
    };

    const obs = this.editingTriggerId !== null
      ? this.api.updateTrigger(this.editingTriggerId, payload)
      : this.api.createTrigger(payload);

    obs.subscribe({
      next: () => {
        this.formSaving = false;
        this.showForm = false;
        this.editingTriggerId = null;
        this.loadTriggers();
      },
      error: (err) => {
        this.formError = err?.error?.detail || 'Erreur lors de la sauvegarde.';
        this.formSaving = false;
      },
    });
  }

  // ── Actions ───────────────────────────────────────────────

  toggleTrigger(trigger: TriggerItem): void {
    this.api.toggleTrigger(trigger.id).subscribe({
      next: (updated) => {
        const idx = this.triggers.findIndex((t) => t.id === trigger.id);
        if (idx !== -1) this.triggers[idx] = updated;
      },
      error: () => {},
    });
  }

  runNow(trigger: TriggerItem): void {
    this.runningTriggers.add(trigger.id);
    this.api.runTrigger(trigger.id).subscribe({
      next: (updated) => {
        const idx = this.triggers.findIndex((t) => t.id === trigger.id);
        if (idx !== -1) this.triggers[idx] = updated;
        this.runningTriggers.delete(trigger.id);
        // Rafraîchir les logs si ce trigger est sélectionné
        if (this.selectedTriggerId === trigger.id) {
          this.loadLogs(trigger.id);
        }
      },
      error: () => {
        this.runningTriggers.delete(trigger.id);
        this.loadTriggers();
      },
    });
  }

  deleteTrigger(trigger: TriggerItem): void {
    if (!confirm(`Supprimer le trigger "${trigger.name}" ?`)) return;
    this.api.deleteTrigger(trigger.id).subscribe({
      next: () => {
        this.triggers = this.triggers.filter((t) => t.id !== trigger.id);
        if (this.selectedTriggerId === trigger.id) {
          this.selectedTriggerId = null;
          this.triggerLogs = [];
        }
      },
      error: () => {},
    });
  }

  // ── Logs ─────────────────────────────────────────────────

  toggleLogs(trigger: TriggerItem): void {
    if (this.selectedTriggerId === trigger.id) {
      this.selectedTriggerId = null;
      this.triggerLogs = [];
      this.selectedLog = null;
    } else {
      this.selectedTriggerId = trigger.id;
      this.loadLogs(trigger.id);
    }
  }

  loadLogs(triggerId: number): void {
    this.logsLoading = true;
    this.triggerLogs = [];
    this.selectedLog = null;
    this.api.getTriggerLogs(triggerId).subscribe({
      next: (data) => {
        this.triggerLogs = data;
        this.logsLoading = false;
      },
      error: () => {
        this.logsLoading = false;
      },
    });
  }

  toggleLogDetail(log: TriggerLog): void {
    this.selectedLog = this.selectedLog?.id === log.id ? null : log;
  }

  // ── Utilitaires d'affichage ──────────────────────────────

  formatSchedule(trigger: TriggerItem): string {
    if (trigger.schedule_type === 'interval') {
      return `Toutes les ${trigger.schedule_value} min`;
    }
    if (trigger.schedule_type === 'daily') {
      return `Quotidien à ${trigger.schedule_value}`;
    }
    return trigger.schedule_value;
  }

  formatActionType(type: string): string {
    if (type === 'azdo_sync_incremental') return 'Sync AZDO incrémentale';
    return type;
  }

  formatDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  }

  formatDuration(ms: number | null): string {
    if (ms === null || ms === undefined) return '—';
    if (ms < 1000) return `${ms} ms`;
    return `${(ms / 1000).toFixed(1)} s`;
  }

  formatDetailJson(detail: any): string {
    if (!detail) return '';
    try {
      return JSON.stringify(detail, null, 2);
    } catch {
      return String(detail);
    }
  }

  isRunning(triggerId: number): boolean {
    return this.runningTriggers.has(triggerId);
  }

  getScheduleHint(): string {
    if (this.form.schedule_type === 'interval') return 'Nombre de minutes entre chaque exécution (ex : 60)';
    if (this.form.schedule_type === 'daily') return 'Heure d\'exécution au format HH:MM (ex : 08:30)';
    return 'Expression cron 5 champs : min heure jour mois joursemaine (ex : 0 8 * * 1-5)';
  }
}
