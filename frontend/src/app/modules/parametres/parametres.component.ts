import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { AppSetting, SyncLog, WorkItem, Iteration, TeamMember, ConnectionTestResult } from '../../core/models';

/**
 * Groupe de paramètres affichés dans une section de l'onglet "Paramètres".
 * Chaque groupe correspond à un domaine fonctionnel (AZDO, LLM, matrices, affichage).
 */
interface SettingGroup {
  id: string;
  label: string;
  icon: string;
  /** Clés `AppSetting.key` appartenant à ce groupe. */
  keys: string[];
}

/** Types de work items AZDO gérés dans l'application. */
const WORK_ITEM_TYPES = ['Feature', 'Enabler Story', 'Enabler', 'User Story', 'Bug', 'Task', 'Maintenance', 'Question'];

/** États AZDO disponibles pour le filtre des work items. */
const WORK_ITEM_STATES = ['New', 'Active', 'Resolved', 'Closed', 'Removed'];

/**
 * Composant Paramètres.
 *
 * Deux onglets principaux :
 * - **Paramètres** : configuration AZDO (org, project, team, PAT), LLM (provider, model,
 *   api_key, endpoint), matrices de capacité (JSON), couleurs des blocs.
 * - **Données synchronisées** : consultation des work items, iterations et membres
 *   importés depuis AZDO ; déclenchement de la synchronisation manuelle.
 *
 * Tous les paramètres sont stockés dans la table `app_settings` (clé/valeur).
 * La synchronisation est read-only côté AZDO : aucune écriture n'est effectuée.
 */
@Component({
  selector: 'app-parametres',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './parametres.component.html',
  styleUrl: './parametres.component.scss',
})
export class ParametresComponent implements OnInit {
  /** Onglet actif. */
  activeTab: 'settings' | 'sync-data' = 'settings';

  // ── Paramètres ────────────────────────────────────────────

  /** Liste de tous les paramètres chargés depuis l'API. */
  settings: AppSetting[] = [];

  /** Indique si la sauvegarde d'un paramètre est en cours, indexé par clé. */
  saving: Record<string, boolean> = {};

  /** Indique si la sauvegarde vient de réussir (feedback visuel temporaire), indexé par clé. */
  saved: Record<string, boolean> = {};

  /**
   * Définition des groupes de paramètres affichés dans l'onglet "Paramètres".
   * L'ordre des groupes détermine l'ordre d'affichage dans le template.
   */
  readonly settingGroups: SettingGroup[] = [
    { id: 'azdo', label: 'Azure DevOps', icon: '☁️', keys: ['azdo_organization', 'azdo_project', 'azdo_team', 'azdo_pat'] },
    { id: 'llm',  label: 'Intelligence Artificielle', icon: '🤖', keys: ['llm_provider', 'llm_model', 'llm_api_key', 'llm_endpoint'] },
    { id: 'matrices', label: 'Matrices de capacité', icon: '📊', keys: ['capacity_matrix_dev', 'capacity_matrix_qa', 'capacity_matrix_psm'] },
    { id: 'display', label: 'Affichage', icon: '🎨', keys: ['block_colors'] },
  ];

  // ── Test de connexion AZDO ────────────────────────────────

  /** Résultat du dernier test de connexion AZDO. */
  connectionTest: ConnectionTestResult | null = null;

  /** Vrai pendant le test de connexion. */
  connectionTesting = false;

  // ── Synchronisation ───────────────────────────────────────

  /** Vrai pendant une synchronisation AZDO en cours. */
  syncLoading = false;

  /** Historique des synchronisations passées. */
  syncLogs: SyncLog[] = [];

  /**
   * Date de référence pour la synchronisation incrémentale (format ISO).
   * Si vide, la synchronisation incrémentale utilise la date du dernier log.
   */
  syncSinceDate = '';

  // ── Work Items synchronisés ───────────────────────────────

  /** Page courante de work items chargés (pagination par offset). */
  workItems: WorkItem[] = [];

  /** Vrai pendant le chargement des work items. */
  workItemsLoading = false;

  /** Nombre total de work items correspondant aux filtres actifs. */
  workItemsTotal = 0;

  /** Offset courant pour la pagination (`workItems.length`). */
  workItemsSkip = 0;

  /** Nombre de work items chargés par page. */
  readonly workItemsLimit = 50;

  /** Texte saisi dans la barre de recherche des work items. */
  wiSearchText = '';

  /** Ensemble des types AZDO sélectionnés comme filtre. */
  wiSelectedTypes: Set<string> = new Set();

  /** Ensemble des états AZDO sélectionnés comme filtre. */
  wiSelectedStates: Set<string> = new Set();

  /** Chemin d'iteration AZDO sélectionné comme filtre (`''` = tous). */
  wiSelectedIteration = '';

  /** Liste fixe des types de work items disponibles pour le filtre. */
  readonly workItemTypes = WORK_ITEM_TYPES;

  /** Liste fixe des états AZDO disponibles pour le filtre. */
  readonly workItemStates = WORK_ITEM_STATES;

  // ── Données synchronisées — Iterations et Équipe ─────────

  /** Iterations AZDO synchronisées. */
  iterations: Iteration[] = [];

  /** Membres de l'équipe synchronisés depuis AZDO. */
  teamMembers: TeamMember[] = [];

  /** Indique si la sauvegarde du profil d'un membre est en cours, indexé par ID membre. */
  profileSaving: Record<number, boolean> = {};

  // ── Changement de mot de passe ────────────────────────────

  /** Mot de passe actuel saisi dans le formulaire. */
  pwdCurrent = '';

  /** Nouveau mot de passe saisi. */
  pwdNew = '';

  /** Confirmation du nouveau mot de passe. */
  pwdNew2 = '';

  /** Vrai pendant la requête de changement de mot de passe. */
  pwdSaving = false;

  /** Message de succès affiché après un changement réussi. */
  pwdSuccess = '';

  /** Message d'erreur affiché en cas d'échec du changement de mot de passe. */
  pwdError = '';

  constructor(private api: ApiService, private authService: AuthService) {}

  // ── Initialisation ────────────────────────────────────────

  /**
   * Charge les paramètres applicatifs et l'historique de synchronisation au démarrage.
   */
  ngOnInit(): void {
    this.api.getSettings().subscribe((s) => (this.settings = s));
    this.loadSyncLogs();
  }

  // ── Paramètres ────────────────────────────────────────────

  /**
   * Retourne les `AppSetting` correspondant aux clés d'un groupe.
   * Les clés absentes de `settings` sont ignorées.
   * @param group Groupe de paramètres à filtrer.
   */
  getSettingsForGroup(group: SettingGroup): AppSetting[] {
    return group.keys
      .map((k) => this.settings.find((s) => s.key === k))
      .filter((s): s is AppSetting => !!s);
  }

  /**
   * Indique si un paramètre doit être affiché avec un `<textarea>` plutôt qu'un `<input>`.
   * Vrai pour les matrices de capacité (JSON multiligne) et les couleurs de blocs.
   * @param key Clé du paramètre.
   */
  isTextarea(key: string): boolean {
    return key.startsWith('capacity_matrix') || key === 'block_colors';
  }

  /**
   * Indique si un paramètre est sensible (PAT, clé API) et doit être masqué dans l'UI.
   * @param key Clé du paramètre.
   */
  isSensitive(key: string): boolean {
    return key.includes('pat') || key.includes('api_key');
  }

  /**
   * Sauvegarde un paramètre via l'API et affiche un feedback visuel temporaire.
   * @param setting Paramètre à sauvegarder avec sa nouvelle valeur.
   */
  saveSetting(setting: AppSetting): void {
    if (setting.value === null || setting.value === undefined) return;
    this.saving[setting.key] = true;
    this.api.updateSetting(setting.key, setting.value).subscribe({
      next: () => {
        this.saving[setting.key] = false;
        this.saved[setting.key] = true;
        setTimeout(() => delete this.saved[setting.key], 2000);
      },
      error: () => { this.saving[setting.key] = false; },
    });
  }

  // ── Test de connexion AZDO ────────────────────────────────

  /**
   * Déclenche un test de connexion AZDO avec les paramètres actuellement sauvegardés.
   * Affiche le résultat (succès ou message d'erreur détaillé) dans `connectionTest`.
   */
  testConnection(): void {
    this.connectionTesting = true;
    this.connectionTest = null;
    this.api.testAzdoConnection().subscribe({
      next: (result) => {
        this.connectionTesting = false;
        this.connectionTest = result;
      },
      error: () => {
        this.connectionTesting = false;
        this.connectionTest = { ok: false, error: 'Erreur inattendue', details: null };
      },
    });
  }

  // ── Synchronisation ───────────────────────────────────────

  /**
   * Déclenche une synchronisation AZDO.
   * - `fullSync = true` : synchronisation complète (toutes les données).
   * - `fullSync = false` : synchronisation incrémentale depuis `syncSinceDate` (ou dernière sync).
   *
   * Après la sync, recharge les logs et les données synchronisées.
   * @param fullSync Vrai pour une synchronisation complète.
   */
  triggerSync(fullSync = false): void {
    this.syncLoading = true;
    this.api.syncAzdo(fullSync, fullSync ? undefined : (this.syncSinceDate || undefined)).subscribe({
      next: () => {
        this.syncLoading = false;
        this.loadSyncLogs();
        this.loadSyncData();
      },
      error: (err) => {
        this.syncLoading = false;
        this.loadSyncLogs();
        console.error('Sync error:', err);
      },
    });
  }

  /** Recharge l'historique des synchronisations. */
  loadSyncLogs(): void {
    this.api.getSyncLogs().subscribe((logs) => (this.syncLogs = logs));
  }

  /**
   * Formate le détail JSON d'un log de synchronisation en texte lisible.
   * Retourne une chaîne vide si `details` est null ou non parseable.
   * @param details Contenu JSON du champ `SyncLog.details`.
   */
  parseSyncDetails(details: string | null): string {
    if (!details) return '';
    try {
      const d = JSON.parse(details);
      const parts = [];
      if (d.iterations) parts.push(`${d.iterations} itération(s)`);
      if (d.members)    parts.push(`${d.members} membre(s)`);
      if (d.work_items) parts.push(`${d.work_items} work item(s)`);
      if (d.since)      parts.push(`depuis ${new Date(d.since).toLocaleDateString('fr-FR')}`);
      return parts.join(' · ') || details;
    } catch {
      return details;
    }
  }

  /**
   * Retourne le mode de synchronisation lisible ("Complète" ou "Incrémentale")
   * à partir du champ `details` d'un log.
   * @param details Contenu JSON du champ `SyncLog.details`.
   */
  parseSyncMode(details: string | null): string {
    if (!details) return '';
    try {
      const d = JSON.parse(details);
      return d.mode === 'full' ? 'Complète' : 'Incrémentale';
    } catch { return ''; }
  }

  // ── Onglet données synchronisées ──────────────────────────

  /**
   * Bascule entre les onglets et charge les données synchronisées au premier accès.
   * @param tab Onglet cible.
   */
  onTabChange(tab: 'settings' | 'sync-data'): void {
    this.activeTab = tab;
    if (tab === 'sync-data' && this.workItems.length === 0) {
      this.loadSyncData();
    }
  }

  /**
   * Charge en parallèle les work items (page 1), les iterations et les membres.
   * Également mis à jour après chaque synchronisation réussie.
   */
  loadSyncData(): void {
    this.loadWorkItems(true);
    this.api.getIterations().subscribe((it) => (this.iterations = it));
    this.api.listTeamMembers().subscribe((m) => (this.teamMembers = m));
    this.api.getWorkItemsCount().subscribe((r) => (this.workItemsTotal = r.count));
  }

  /**
   * Construit l'objet de paramètres de filtre à partir des sélections UI courantes.
   * Les champs non renseignés sont omis (undefined) pour ne pas polluer la requête.
   */
  private buildWiFilterParams() {
    return {
      search: this.wiSearchText || undefined,
      type: this.wiSelectedTypes.size > 0 ? [...this.wiSelectedTypes].join(',') : undefined,
      state: this.wiSelectedStates.size > 0 ? [...this.wiSelectedStates].join(',') : undefined,
      iteration_path: this.wiSelectedIteration || undefined,
    };
  }

  /**
   * Charge une page de work items selon les filtres actifs.
   * @param reset Si vrai, réinitialise la liste et l'offset avant de charger.
   */
  loadWorkItems(reset = false): void {
    if (reset) {
      this.workItemsSkip = 0;
      this.workItems = [];
    }
    this.workItemsLoading = true;
    const params = this.buildWiFilterParams();
    this.api.getWorkItemsCount(params).subscribe((r) => (this.workItemsTotal = r.count));
    this.api
      .getWorkItems({ ...params, skip: this.workItemsSkip, limit: this.workItemsLimit })
      .subscribe({
        next: (items) => {
          this.workItems = reset ? items : [...this.workItems, ...items];
          this.workItemsSkip += items.length;
          this.workItemsLoading = false;
        },
        error: () => { this.workItemsLoading = false; },
      });
  }

  /** Charge la page suivante de work items (pagination infinie). */
  loadMoreWorkItems(): void {
    this.loadWorkItems(false);
  }

  /** Déclenche un rechargement depuis le début lors d'une saisie dans la recherche. */
  onWiSearch(): void {
    this.loadWorkItems(true);
  }

  /**
   * Ajoute ou retire un type AZDO du filtre actif et recharge.
   * @param type Type AZDO à basculer (ex : `"Feature"`, `"Bug"`).
   */
  toggleTypeFilter(type: string): void {
    if (this.wiSelectedTypes.has(type)) {
      this.wiSelectedTypes.delete(type);
    } else {
      this.wiSelectedTypes.add(type);
    }
    this.loadWorkItems(true);
  }

  /**
   * Ajoute ou retire un état AZDO du filtre actif et recharge.
   * @param state État AZDO à basculer (ex : `"Active"`, `"Closed"`).
   */
  toggleStateFilter(state: string): void {
    if (this.wiSelectedStates.has(state)) {
      this.wiSelectedStates.delete(state);
    } else {
      this.wiSelectedStates.add(state);
    }
    this.loadWorkItems(true);
  }

  /** Déclenche un rechargement lors du changement de filtre par iteration. */
  onIterationFilter(): void {
    this.loadWorkItems(true);
  }

  /**
   * Indique s'il reste des work items à charger (pagination incomplète).
   */
  hasMoreWorkItems(): boolean {
    return this.workItemsSkip < this.workItemsTotal;
  }

  // ── Équipe ────────────────────────────────────────────────

  /**
   * Met à jour le profil d'un membre de l'équipe.
   * Le profil détermine les blocs de capacité générés et la participation aux votes DoR.
   * @param member Membre à modifier.
   * @param profile Nouveau profil (`'Dev' | 'QA' | 'PSM' | 'Squad Lead' | 'Automate'`).
   */
  updateProfile(member: TeamMember, profile: string): void {
    this.profileSaving[member.id] = true;
    this.api.updateTeamMember(member.id, { profile: profile as 'Dev' | 'QA' | 'PSM' | 'Squad Lead' | 'Automate' }).subscribe({
      next: (updated) => {
        member.profile = updated.profile;
        this.profileSaving[member.id] = false;
      },
      error: () => { this.profileSaving[member.id] = false; },
    });
  }

  // ── Sécurité — Changement de mot de passe ─────────────────

  /**
   * Valide et soumet le formulaire de changement de mot de passe.
   * Vérifie que les deux saisies du nouveau mot de passe sont identiques.
   * Réinitialise les champs du formulaire en cas de succès.
   */
  changePassword(): void {
    this.pwdSuccess = '';
    this.pwdError = '';
    if (!this.pwdCurrent || !this.pwdNew || !this.pwdNew2) return;
    if (this.pwdNew !== this.pwdNew2) {
      this.pwdError = 'Les nouveaux mots de passe ne correspondent pas';
      return;
    }
    this.pwdSaving = true;
    this.authService.changePassword(this.pwdCurrent, this.pwdNew).subscribe({
      next: () => {
        this.pwdSaving = false;
        this.pwdSuccess = 'Mot de passe modifié avec succès';
        this.pwdCurrent = '';
        this.pwdNew = '';
        this.pwdNew2 = '';
      },
      error: (err) => {
        this.pwdSaving = false;
        this.pwdError = err.error?.detail ?? 'Erreur lors du changement de mot de passe';
      },
    });
  }
}
