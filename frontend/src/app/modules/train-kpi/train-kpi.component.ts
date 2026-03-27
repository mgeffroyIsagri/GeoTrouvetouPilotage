import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, firstValueFrom } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ApiService } from '../../core/services/api.service';
import { PI, TrainTeam, TrainKpiEntry } from '../../core/models';

/** Onglets disponibles dans le module KPI du Train. */
type ActiveTab = 'kpi' | 'teams' | 'evolution';

/**
 * Composant principal du module KPI du Train.
 *
 * Permet de :
 * - Visualiser les KPIs Git/AZDO par équipe du train pour un PI sélectionné
 * - Configurer les équipes (repos, branche, couleur)
 * - Suivre l'évolution sur plusieurs PIs
 */
@Component({
  selector: 'app-train-kpi',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './train-kpi.component.html',
  styleUrl: './train-kpi.component.scss',
})
export class TrainKpiComponent implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();

  // ── État PI ──────────────────────────────────────────────────────────────────
  /** Liste de tous les PIs disponibles. */
  piList: PI[] = [];
  /** PI actuellement sélectionné. */
  activePI: PI | null = null;
  /** Identifiant du PI sélectionné dans le sélecteur. */
  selectedPiId: number | null = null;

  // ── Données KPI ──────────────────────────────────────────────────────────────
  /** Entrées KPI du train pour le PI sélectionné. */
  kpiEntries: TrainKpiEntry[] = [];
  /** Liste de toutes les équipes du train configurées. */
  teams: TrainTeam[] = [];

  // ── État UI ──────────────────────────────────────────────────────────────────
  /** Onglet actif. */
  activeTab: ActiveTab = 'kpi';
  /** Indique qu'une analyse globale est en cours. */
  analyzing = false;
  /** Identifiant de l'équipe dont l'analyse individuelle est en cours. */
  analyzingTeamId: number | null = null;
  /** Progression de l'analyse globale (null = pas d'analyse en cours). */
  analyzeProgress: {
    teamIndex: number; teamTotal: number; teamName: string;
    current: number; total: number; repo: string;
  } | null = null;
  /** Indique que les données KPI sont en cours de chargement. */
  loadingKpi = false;
  /** Indique que les équipes sont en cours de chargement. */
  loadingTeams = false;
  /** Dernier message d'erreur ou d'avertissement à afficher sous la toolbar. */
  analysisMessage: { type: 'error' | 'warning' | 'info'; text: string } | null = null;

  // ── Formulaire équipes ───────────────────────────────────────────────────────
  /** Équipe en cours d'édition (null = création). */
  editingTeam: TrainTeam | null = null;
  /** Affiche ou non le formulaire de création/édition d'équipe. */
  showTeamForm = false;
  /** Nom du formulaire d'équipe. */
  formName = '';
  /** Repos du formulaire (un par ligne). */
  formRepos = '';
  /** Filtre de branche du formulaire. */
  formBranch = 'main';
  /** Couleur du formulaire. */
  formColor = '#1a73e8';

  // ── Capacité inline ──────────────────────────────────────────────────────────
  /** Map des valeurs de capacité en cours d'édition, indexées par entry.id. */
  editingCapacity: Record<number, number | null> = {};

  // ── Évolution multi-PI ───────────────────────────────────────────────────────
  /** Map des entrées KPI par PI, pour l'onglet Évolution. */
  evolutionData: Map<number, TrainKpiEntry[]> = new Map();
  /** PIs qui ont des données d'analyse (pour l'onglet Évolution). */
  analyzedPIs: PI[] = [];

  constructor(private api: ApiService) {}

  /** Initialise le composant : charge les PIs et les équipes. */
  ngOnInit(): void {
    this.loadPIs();
    this.loadTeams();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ── Chargement ───────────────────────────────────────────────────────────────

  /** Charge la liste des PIs et sélectionne le PI actif par défaut. */
  loadPIs(): void {
    this.api.listPI().pipe(takeUntil(this.destroy$)).subscribe({
      next: (pis) => {
        this.piList = pis;
        const active = pis.find((p) => p.is_active) ?? pis[0] ?? null;
        if (active) {
          this.selectedPiId = active.id;
          this.activePI = active;
          this.loadKpiForSelectedPI();
        }
      },
      error: () => alert('Erreur lors du chargement des PIs.'),
    });
  }

  /** Charge les équipes du train depuis le backend. */
  loadTeams(): void {
    this.loadingTeams = true;
    this.api.getTrainTeams().pipe(takeUntil(this.destroy$)).subscribe({
      next: (teams) => {
        this.teams = teams;
        this.loadingTeams = false;
      },
      error: () => {
        alert('Erreur lors du chargement des équipes.');
        this.loadingTeams = false;
      },
    });
  }

  /** Charge les entrées KPI pour le PI sélectionné. */
  loadKpiForSelectedPI(): void {
    if (!this.selectedPiId) return;
    this.loadingKpi = true;
    this.api.getTrainKpiForPi(this.selectedPiId).pipe(takeUntil(this.destroy$)).subscribe({
      next: (entries) => {
        this.kpiEntries = entries;
        this.initEditingCapacity(entries);
        this.loadingKpi = false;
      },
      error: () => {
        alert('Erreur lors du chargement des KPIs.');
        this.loadingKpi = false;
      },
    });
  }

  /** Initialise la map d'édition de capacité à partir des entrées KPI. */
  private initEditingCapacity(entries: TrainKpiEntry[]): void {
    this.editingCapacity = {};
    for (const entry of entries) {
      this.editingCapacity[entry.id] = entry.capacity_days;
    }
  }

  // ── Sélection PI ─────────────────────────────────────────────────────────────

  /** Réagit au changement de PI dans le sélecteur. */
  onPiChange(): void {
    this.activePI = this.piList.find((p) => p.id === this.selectedPiId) ?? null;
    this.kpiEntries = [];
    this.loadKpiForSelectedPI();
  }

  // ── Onglets ──────────────────────────────────────────────────────────────────

  /** Change l'onglet actif. Charge les données d'évolution si nécessaire. */
  setTab(tab: ActiveTab): void {
    this.activeTab = tab;
    if (tab === 'evolution') {
      this.loadEvolutionData();
    }
  }

  // ── Analyse ──────────────────────────────────────────────────────────────────

  /**
   * Déclenche l'analyse KPI pour toutes les équipes du PI sélectionné.
   * Chaque équipe est analysée séquentiellement via le mécanisme de polling :
   * le backend lance la tâche en fond et renvoie un job_id immédiatement ;
   * le frontend interroge /jobs/{id} toutes les 500 ms pour afficher
   * la progression commit par commit.
   */
  async analyzeAll(): Promise<void> {
    if (!this.selectedPiId || this.teams.length === 0) return;
    this.analyzing = true;

    this.analysisMessage = null;
    const errors: string[] = [];

    for (let i = 0; i < this.teams.length; i++) {
      const team = this.teams[i];
      try {
        const { job_id } = await firstValueFrom(
          this.api.analyzeTrainKpiForTeamAsync(this.selectedPiId!, team.id)
        );
        const finalJob = await this.pollJob(job_id, i, this.teams.length, team.name);

        if (finalJob.status === 'error') {
          errors.push(`${team.name} : ${finalJob.error ?? 'erreur inconnue'}`);
        } else if (finalJob.status === 'done' && finalJob.result) {
          const entry = finalJob.result as TrainKpiEntry;
          this.upsertEntry(entry);
          if (entry.commits_count === 0) {
            errors.push(`${team.name} : 0 commit trouvé — vérifiez le nom du repo et la branche`);
          }
        }
      } catch (err: any) {
        errors.push(`${team.name} : ${err?.message ?? 'erreur réseau'}`);
      }
    }

    this.analyzeProgress = null;
    this.analyzing = false;
    if (errors.length > 0) {
      this.analysisMessage = { type: 'warning', text: errors.join('\n') };
    } else {
      this.analysisMessage = { type: 'info', text: 'Analyse terminée avec succès.' };
      setTimeout(() => { this.analysisMessage = null; }, 4000);
    }
  }

  /** Met à jour ou insère une entrée KPI dans la liste locale. */
  private upsertEntry(entry: TrainKpiEntry): void {
    const idx = this.kpiEntries.findIndex(e => e.team_id === entry.team_id);
    if (idx >= 0) {
      this.kpiEntries[idx] = entry;
    } else {
      this.kpiEntries = [...this.kpiEntries, entry];
    }
    this.editingCapacity[entry.id] = entry.capacity_days;
  }

  /**
   * Interroge l'endpoint de progression toutes les 500 ms jusqu'à ce que le job
   * soit terminé (status !== 'running'), en mettant à jour ``analyzeProgress``
   * à chaque tick pour alimenter la barre de progression.
   */
  private async pollJob(
    jobId: string,
    teamIndex: number,
    teamTotal: number,
    teamName: string,
  ): Promise<{ status: string; result: TrainKpiEntry | null; error: string | null }> {
    while (true) {
      await new Promise(r => setTimeout(r, 500));
      const progress = await firstValueFrom(this.api.getTrainKpiJobProgress(jobId));
      this.analyzeProgress = {
        teamIndex,
        teamTotal,
        teamName,
        current: progress.current_commit,
        total: progress.total_commits,
        repo: progress.current_repo,
      };
      if (progress.status !== 'running') {
        return { status: progress.status, result: progress.result, error: progress.error };
      }
    }
  }

  /** Déclenche l'analyse KPI pour une équipe précise via polling (bouton 🔄 du tableau). */
  async analyzeTeam(teamId: number): Promise<void> {
    if (!this.selectedPiId) return;
    const team = this.teams.find(t => t.id === teamId);
    this.analyzingTeamId = teamId;
    this.analysisMessage = null;
    try {
      const { job_id } = await firstValueFrom(
        this.api.analyzeTrainKpiForTeamAsync(this.selectedPiId, teamId)
      );
      const finalJob = await this.pollJob(job_id, 0, 1, team?.name ?? '');
      if (finalJob.status === 'error') {
        this.analysisMessage = { type: 'error', text: finalJob.error ?? 'Erreur inconnue' };
      } else if (finalJob.status === 'done' && finalJob.result) {
        const entry = finalJob.result as TrainKpiEntry;
        this.upsertEntry(entry);
        if (entry.commits_count === 0) {
          this.analysisMessage = { type: 'warning', text: '0 commit trouvé — vérifiez le nom du repo et la branche dans l\'onglet Équipes.' };
        } else {
          this.analysisMessage = { type: 'info', text: `Analyse de ${team?.name} terminée : ${entry.commits_count} commits.` };
          setTimeout(() => { this.analysisMessage = null; }, 4000);
        }
      }
    } catch (err: any) {
      this.analysisMessage = { type: 'error', text: err?.message ?? 'Erreur réseau lors de l\'analyse.' };
    } finally {
      this.analyzingTeamId = null;
      this.analyzeProgress = null;
    }
  }

  // ── Capacité inline ──────────────────────────────────────────────────────────

  /** Sauvegarde la capacité éditée inline pour une entrée KPI. */
  saveCapacity(entry: TrainKpiEntry): void {
    if (!this.selectedPiId) return;
    const val = this.editingCapacity[entry.id];
    const days = val !== null && val !== undefined ? Number(val) : 0;
    this.api.updateTrainKpiCapacity(this.selectedPiId, entry.team_id, days)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (updated) => {
          const idx = this.kpiEntries.findIndex((e) => e.id === entry.id);
          if (idx >= 0) this.kpiEntries[idx] = updated;
        },
        error: () => alert('Erreur lors de la sauvegarde de la capacité.'),
      });
  }

  // ── Calculs KPI ──────────────────────────────────────────────────────────────

  /** Retourne les lignes nettes (ajoutées - supprimées) d'une entrée. */
  netLines(entry: TrainKpiEntry): number {
    return entry.lines_added - entry.lines_deleted;
  }

  /** Retourne le ratio lignes nettes / jour de capacité, ou null si capacité = 0. */
  ratioLinesPerDay(entry: TrainKpiEntry): number | null {
    if (!entry.capacity_days || entry.capacity_days === 0) return null;
    return Math.round(this.netLines(entry) / entry.capacity_days);
  }

  /** Retourne la date de dernière analyse formatée, ou null. */
  formatAnalyzedAt(entry: TrainKpiEntry): string | null {
    if (!entry.analyzed_at) return null;
    return new Date(entry.analyzed_at).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  // ── Gestion équipes ──────────────────────────────────────────────────────────

  /** Ouvre le formulaire de création d'une nouvelle équipe. */
  openCreateTeamForm(): void {
    this.editingTeam = null;
    this.formName = '';
    this.formRepos = '';
    this.formBranch = 'main';
    this.formColor = '#1a73e8';
    this.showTeamForm = true;
  }

  /** Ouvre le formulaire d'édition d'une équipe existante. */
  openEditTeamForm(team: TrainTeam): void {
    this.editingTeam = team;
    this.formName = team.name;
    this.formRepos = (team.azdo_repos ?? []).join('\n');
    this.formBranch = team.branch_filter;
    this.formColor = team.color ?? '#1a73e8';
    this.showTeamForm = true;
  }

  /** Ferme le formulaire d'équipe sans sauvegarder. */
  cancelTeamForm(): void {
    this.showTeamForm = false;
    this.editingTeam = null;
  }

  /** Soumet le formulaire de création ou d'édition d'une équipe. */
  submitTeamForm(): void {
    const repos = this.formRepos
      .split('\n')
      .map((r) => r.trim())
      .filter((r) => r.length > 0);

    const payload: Partial<TrainTeam> = {
      name: this.formName.trim(),
      azdo_repos: repos,
      branch_filter: this.formBranch.trim() || 'main',
      color: this.formColor || null,
    };

    if (this.editingTeam) {
      this.api.updateTrainTeam(this.editingTeam.id, payload)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (updated) => {
            const idx = this.teams.findIndex((t) => t.id === updated.id);
            if (idx >= 0) this.teams[idx] = updated;
            this.showTeamForm = false;
            this.editingTeam = null;
          },
          error: () => alert('Erreur lors de la mise à jour de l\'équipe.'),
        });
    } else {
      this.api.createTrainTeam(payload)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (created) => {
            this.teams = [...this.teams, created];
            this.showTeamForm = false;
          },
          error: () => alert('Erreur lors de la création de l\'équipe.'),
        });
    }
  }

  /** Supprime une équipe après confirmation. */
  deleteTeam(team: TrainTeam): void {
    if (!confirm(`Supprimer l'équipe "${team.name}" ? Cette action est irréversible.`)) return;
    this.api.deleteTrainTeam(team.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.teams = this.teams.filter((t) => t.id !== team.id);
      },
      error: () => alert('Erreur lors de la suppression de l\'équipe.'),
    });
  }

  // ── Évolution multi-PI ───────────────────────────────────────────────────────

  /**
   * Charge les données KPI pour tous les PIs afin d'alimenter l'onglet Évolution.
   * Ne recharge que si les données ne sont pas déjà présentes.
   */
  loadEvolutionData(): void {
    const pisToLoad = this.piList.filter((pi) => !this.evolutionData.has(pi.id));
    if (pisToLoad.length === 0) {
      this.updateAnalyzedPIs();
      return;
    }
    let pending = pisToLoad.length;
    for (const pi of pisToLoad) {
      this.api.getTrainKpiForPi(pi.id).pipe(takeUntil(this.destroy$)).subscribe({
        next: (entries) => {
          this.evolutionData.set(pi.id, entries);
          pending--;
          if (pending === 0) this.updateAnalyzedPIs();
        },
        error: () => {
          this.evolutionData.set(pi.id, []);
          pending--;
          if (pending === 0) this.updateAnalyzedPIs();
        },
      });
    }
  }

  /** Met à jour la liste des PIs ayant des données d'analyse (pour l'affichage). */
  private updateAnalyzedPIs(): void {
    this.analyzedPIs = this.piList.filter((pi) => {
      const entries = this.evolutionData.get(pi.id) ?? [];
      return entries.some((e) => e.analyzed_at !== null);
    });
  }

  /**
   * Retourne les lignes nettes d'une équipe pour un PI donné dans l'onglet Évolution.
   * Retourne null si aucune donnée n'est disponible.
   */
  getEvolutionNetLines(teamId: number, piId: number): number | null {
    const entries = this.evolutionData.get(piId) ?? [];
    const entry = entries.find((e) => e.team_id === teamId);
    if (!entry || !entry.analyzed_at) return null;
    return entry.lines_added - entry.lines_deleted;
  }
}
