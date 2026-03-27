import {
  Component, OnInit, OnDestroy, AfterViewChecked,
  ViewChildren, QueryList, ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import {
  Chart, BarController, BarElement, CategoryScale, LinearScale,
  Tooltip, Legend, Title,
} from 'chart.js';
import { ApiService } from '../../core/services/api.service';
import { PI, SuiviTask, SprintMemberKpi, SuiviOverview, SprintCapacity } from '../../core/models';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend, Title);

/** Identifiants des onglets de navigation du module Suivi. */
type Tab = 'general' | 'sp1' | 'sp2' | 'sp3' | 'piall' | 'capacites';

interface StoryMember { id: number; name: string; profile: string; }

interface PlannedStory {
  id: number;
  title: string;
  type: string;
  state: string;
  members: StoryMember[];
  total_days: number;
  total_hours: number;
  pbr_item_id: number | null;
  dor_note: number | null;
  dor_comment: string | null;
  dor_analyzed_at: string | null;
}

interface PlannedGroup {
  parent_id: number;
  parent_title: string;
  parent_type: string;
  parent_state: string;
  stories: PlannedStory[];
}

interface PlannedStoriesData {
  groups: PlannedGroup[];
  orphans: PlannedStory[];
}

/**
 * Groupe de tâches partageant le même parent (User Story / Enabler Story / Maintenance).
 * Agrège les heures estimées, réalisées et restantes pour l'affichage et les graphiques.
 */
interface TaskGroup {
  parentId: number | null;
  parentTitle: string;
  parentType: string;
  tasks: SuiviTask[];
  totalEstimate: number;
  totalCompleted: number;
  totalRemaining: number;
  /** Vrai si le réalisé dépasse l'estimation. */
  overrun: boolean;
}

/**
 * Groupe de stories partageant la même Feature ou Enabler parent (niveau "grand-parent").
 * Utilisé pour l'agrégation à la maille Feature dans les graphiques et tableaux.
 */
interface FeatureGroup {
  featureId: number | null;
  featureTitle: string;
  featureType: string;
  totalEstimate: number;
  totalCompleted: number;
  /** Vrai si le réalisé dépasse l'estimation. */
  overrun: boolean;
}

/**
 * Composant Suivi & KPIs.
 *
 * Fournit quatre niveaux de lecture :
 * - **Général** : toutes les tâches du PI filtrables par sprint, assigné, type de parent.
 * - **Sprint 1/2/3** : KPIs par collaborateur (capacité vs réalisé) avec graphiques Chart.js.
 * - **PI All** : vue synthétique story points par état.
 * - **Capacités** : saisie et import manuel des capacités par sprint (`SprintCapacity`).
 *
 * La gestion des graphiques Chart.js repose sur le lifecycle Angular :
 * `ngAfterViewChecked` reconstruit les graphiques après chaque changement d'onglet
 * via le flag `chartsNeedRebuild`.
 */
@Component({
  selector: 'app-suivi',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './suivi.component.html',
  styleUrl: './suivi.component.scss',
})
export class SuiviComponent implements OnInit, OnDestroy, AfterViewChecked {
  // ── Données de référence ──────────────────────────────────

  /** Liste de tous les PIs disponibles. */
  piList: PI[] = [];

  /** Identifiant du PI actuellement sélectionné. */
  selectedPiId: number | null = null;

  /** Onglet actif. */
  activeTab: Tab = 'general';

  // ── Configuration AZDO ────────────────────────────────────

  /** Racines d'iteration AZDO disponibles pour l'association PI ↔ iteration path. */
  azdoRoots: string[] = [];

  /** Chemin d'iteration AZDO sélectionné dans le sélecteur de configuration. */
  selectedAzdoPath = '';

  /** Vrai si la bannière de configuration du chemin AZDO doit être affichée. */
  showAzdoConfig = false;

  // ── Données chargées ──────────────────────────────────────

  /** Toutes les tâches AZDO du PI sélectionné. */
  tasks: SuiviTask[] = [];

  /** KPIs par sprint (1, 2, 3) et par membre. */
  sprintKpis: { [sprint: number]: SprintMemberKpi[] } = {};

  /** Vue d'ensemble PI (KPI cards + story points par état). */
  overview: SuiviOverview | null = null;

  // ── États UI ──────────────────────────────────────────────

  /** Vrai pendant le chargement principal des données. */
  loading = false;

  // ── Onglet Capacités ──────────────────────────────────────

  /** Numéro du sprint affiché dans l'onglet capacités (1, 2 ou 3). */
  capacitesSprintNum = 1;

  /** Lignes de capacité en cours d'édition (copie locale avant sauvegarde). */
  editCapacities: SprintCapacity[] = [];

  /** Vrai pendant la sauvegarde des capacités. */
  capacitesSaving = false;

  /** Vrai pendant l'import des capacités depuis le PI Planning. */
  capacitesImporting = false;

  // ── Analyse productivité ──────────────────────────────────

  /** ID du membre dont l'analyse LLM est en cours de génération. */
  analyzingMemberId: number | null = null;

  /** ID du membre dont le rapport sauvegardé est en cours de chargement. */
  loadingReportMemberId: number | null = null;

  /** Rapport d'analyse affiché dans la modale. */
  analysisReport: { member: string; sprint: string; text: string } | null = null;

  /** Contrôle la visibilité de la modale d'analyse. */
  showAnalysisModal = false;

  /**
   * Ensemble des clés pour lesquelles un rapport sauvegardé existe.
   * Clé : `${piId}-${sprintNum}-${memberId}`.
   */
  savedReportExists: Set<string> = new Set();

  // ── Planned stories ─────────────────────────────────────────────────────
  plannedStoriesData: { [sprint: number]: PlannedStoriesData } = {};
  plannedStoriesLoading: { [sprint: number]: boolean } = {};
  storyFilterMember = '';
  storyFilterState = '';
  analyzingStoryId: number | null = null;
  azdoOrg = '';
  azdoProject = '';

  // ── Filtres onglet Général ────────────────────────────────

  /** Filtre sur le numéro de sprint (null = tous les sprints). */
  filterSprint: number | null = null;

  /** Filtre textuel sur le nom de l'assigné. */
  filterAssignee = '';

  /** Filtre sur le type de parent de la tâche (User Story, Feature, etc.). */
  filterParentType = '';

  // ── Charts ────────────────────────────────────────────────

  /** Références aux éléments `<canvas>` du template pour Chart.js. */
  @ViewChildren('chartCanvas') chartCanvases!: QueryList<ElementRef<HTMLCanvasElement>>;

  /** Instances Chart.js actives, indexées par leur identifiant canvas. */
  private charts = new Map<string, Chart>();

  /**
   * Flag posé lors d'un changement d'onglet ou d'un rechargement de données.
   * `ngAfterViewChecked` le consomme pour reconstruire les graphiques une seule fois.
   */
  private chartsNeedRebuild = false;

  constructor(private api: ApiService) {}

  // ── Initialisation ────────────────────────────────────────

  /**
   * Charge en parallèle la liste des PIs et les racines d'iteration AZDO.
   * Sélectionne automatiquement le PI actif (ou le premier de la liste).
   */
  ngOnInit(): void {
    this.api.getSettings().subscribe((settings: any[]) => {
      const org = settings.find((s: any) => s.key === 'azdo_organization')?.value ?? '';
      this.azdoOrg = org.replace(/^https?:\/\/dev\.azure\.com\//, '').replace(/\/$/, '');
      this.azdoProject = settings.find((s: any) => s.key === 'azdo_project')?.value ?? '';
    });
    forkJoin({
      pis: this.api.listPI(),
      roots: this.api.getAzdoIterationRoots(),
    }).subscribe(({ pis, roots }) => {
      this.piList = pis;
      this.azdoRoots = roots;
      const active = pis.find((p) => p.is_active) ?? pis[0];
      if (active) {
        this.selectedPiId = active.id;
        this.checkAzdoConfig();
        this.loadData();
      }
    });
  }

  // ── PI sélectionné ────────────────────────────────────────

  /**
   * Retourne le PI actuellement sélectionné, ou null si aucun.
   */
  get selectedPi(): PI | null {
    return this.piList.find((p) => p.id === this.selectedPiId) ?? null;
  }

  /**
   * Affiche la bannière de configuration AZDO si le PI n'a pas encore de chemin
   * d'iteration associé. Pré-sélectionne la première racine disponible.
   */
  checkAzdoConfig(): void {
    this.showAzdoConfig = !!this.selectedPi && !this.selectedPi.azdo_iteration_path;
    this.selectedAzdoPath = this.azdoRoots[0] ?? '';
  }

  /**
   * Associe le chemin AZDO sélectionné au PI courant et recharge les données.
   */
  saveAzdoPath(): void {
    if (!this.selectedPiId || !this.selectedAzdoPath) return;
    this.api.setPiAzdoPath(this.selectedPiId, this.selectedAzdoPath).subscribe((updated) => {
      this.piList = this.piList.map((p) =>
        p.id === updated.id ? { ...p, azdo_iteration_path: updated.azdo_iteration_path } : p
      );
      this.showAzdoConfig = false;
      this.loadData();
    });
  }

  /**
   * Dissocie le chemin AZDO du PI courant et vide les données de suivi.
   */
  dissociateAzdoPath(): void {
    if (!this.selectedPiId) return;
    this.api.clearPiAzdoPath(this.selectedPiId).subscribe(() => {
      this.piList = this.piList.map((p) =>
        p.id === this.selectedPiId ? { ...p, azdo_iteration_path: null } : p
      );
      this.checkAzdoConfig();
      this.tasks = [];
      this.sprintKpis = {};
      this.overview = null;
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────

  /** Détruit toutes les instances Chart.js pour éviter les fuites mémoire. */
  ngOnDestroy(): void {
    this.charts.forEach((c) => c.destroy());
    this.charts.clear();
  }

  /**
   * Reconstruit les graphiques après le rendu du DOM si `chartsNeedRebuild` est posé.
   * Utilise ce hook plutôt que `ngAfterViewInit` car les canvas sont conditionnels (ngIf).
   */
  ngAfterViewChecked(): void {
    if (this.chartsNeedRebuild) {
      this.chartsNeedRebuild = false;
      this.buildCharts();
    }
  }

  /**
   * Appelé lors du changement de PI sélectionné.
   * Recharge la configuration AZDO, les données et les capacités si l'onglet est actif.
   */
  onPiChange(): void {
    this.plannedStoriesData = {};
    this.plannedStoriesLoading = {};
    this.checkAzdoConfig();
    this.loadData();
    if (this.activeTab === 'capacites') this.loadCapacities();
  }

  /**
   * Change l'onglet actif et déclenche les chargements nécessaires.
   * - `capacites` : charge les capacités du sprint courant.
   * - `sp1/sp2/sp3` : vérifie les rapports sauvegardés existants.
   * @param tab Onglet à activer.
   */
  setTab(tab: Tab): void {
    this.activeTab = tab;
    this.chartsNeedRebuild = true;
    if (tab === 'capacites') this.loadCapacities();
    if (tab === 'sp1' || tab === 'sp2' || tab === 'sp3') {
      setTimeout(() => this.loadSavedReports(), 0);
    }
    if (tab === 'sp1') this.loadPlannedStories(1);
    if (tab === 'sp2') this.loadPlannedStories(2);
    if (tab === 'sp3') this.loadPlannedStories(3);
  }

  /**
   * Charge en parallèle les tâches, KPIs des 3 sprints et la vue d'ensemble du PI.
   * Pose `chartsNeedRebuild` une fois les données disponibles.
   */
  private loadData(): void {
    if (!this.selectedPiId) return;
    this.loading = true;
    const piId = this.selectedPiId;

    forkJoin({
      tasks: this.api.getSuiviTasks(piId),
      kpi1: this.api.getSprintKpis(piId, 1),
      kpi2: this.api.getSprintKpis(piId, 2),
      kpi3: this.api.getSprintKpis(piId, 3),
      overview: this.api.getSuiviOverview(piId),
    }).subscribe({
      next: ({ tasks, kpi1, kpi2, kpi3, overview }) => {
        this.tasks = tasks;
        this.sprintKpis = { 1: kpi1, 2: kpi2, 3: kpi3 };
        this.overview = overview;
        this.loading = false;
        this.chartsNeedRebuild = true;
      },
      error: () => { this.loading = false; },
    });
  }

  // ── Onglet Général ────────────────────────────────────────

  /**
   * Tâches filtrées selon les critères actifs (sprint, assigné, type de parent).
   */
  get filteredTasks(): SuiviTask[] {
    return this.tasks.filter((t) => {
      if (this.filterSprint !== null && t.sprint_number !== this.filterSprint) return false;
      if (this.filterAssignee && !(t.assigned_to ?? '').toLowerCase().includes(this.filterAssignee.toLowerCase())) return false;
      if (this.filterParentType) {
        if (this.filterParentType === '__orphan__') {
          if (t.parent_id !== null) return false;
        } else {
          if ((t.parent_type ?? '') !== this.filterParentType) return false;
        }
      }
      return true;
    });
  }

  /**
   * Liste dédupliquée et triée des types de parents présents dans les tâches.
   * Utilisée pour le sélecteur de filtre "Type de parent".
   */
  get parentTypes(): string[] {
    const types = new Set<string>();
    for (const t of this.tasks) {
      if (t.parent_type) types.add(t.parent_type);
    }
    return [...types].sort();
  }

  /**
   * Tâches filtrées regroupées par parent (story/enabler).
   * Chaque groupe agrège les heures estimées, réalisées et restantes,
   * et calcule le flag `overrun` (réalisé > estimation).
   * Trié par titre de parent.
   */
  get taskGroups(): TaskGroup[] {
    const map = new Map<string, TaskGroup>();
    for (const t of this.filteredTasks) {
      const key = String(t.parent_id ?? 'orphan');
      if (!map.has(key)) {
        map.set(key, {
          parentId: t.parent_id,
          parentTitle: t.parent_title ?? '(sans parent)',
          parentType: t.parent_type ?? '—',
          tasks: [],
          totalEstimate: 0,
          totalCompleted: 0,
          totalRemaining: 0,
          overrun: false,
        });
      }
      const g = map.get(key)!;
      g.tasks.push(t);
      g.totalEstimate  += t.original_estimate ?? 0;
      g.totalCompleted += t.completed_work ?? 0;
      g.totalRemaining += t.remaining_work ?? 0;
    }
    // Calcul overrun au niveau groupe
    for (const g of map.values()) {
      g.overrun = g.totalEstimate > 0 && g.totalCompleted > g.totalEstimate;
    }
    return Array.from(map.values()).sort((a, b) => (a.parentTitle ?? '').localeCompare(b.parentTitle ?? ''));
  }

  /**
   * Totaux agrégés (estimation, réalisé, restant) sur l'ensemble des groupes filtrés.
   * Affiché dans la ligne de pied de tableau "Général".
   */
  get generalTotals() {
    return this.taskGroups.reduce(
      (acc, g) => ({
        estimate: acc.estimate + g.totalEstimate,
        completed: acc.completed + g.totalCompleted,
        remaining: acc.remaining + g.totalRemaining,
      }),
      { estimate: 0, completed: 0, remaining: 0 },
    );
  }

  /**
   * Liste dédupliquée et triée des assignés présents dans les tâches.
   * Utilisée pour le sélecteur de filtre "Assigné".
   */
  get assignees(): string[] {
    return [...new Set(this.tasks.map((t) => t.assigned_to ?? '').filter(Boolean))].sort();
  }

  /**
   * Tâches regroupées par Feature/Enabler (grand-parent).
   * Filtre uniquement les groupes de type "User Story" ou "Enabler Story".
   * Utilisé pour le graphique "Par Feature".
   */
  get featureGroups(): FeatureGroup[] {
    const storyTypes = new Set(['User Story', 'Enabler Story']);
    const map = new Map<string, FeatureGroup>();
    for (const g of this.taskGroups) {
      if (!storyTypes.has(g.parentType)) continue;
      const task = g.tasks[0];
      const gpId = task?.grandparent_id ?? null;
      const gpTitle = task?.grandparent_title ?? '(sans Feature)';
      const gpType = task?.grandparent_type ?? '—';
      const key = String(gpId ?? 'none');
      if (!map.has(key)) {
        map.set(key, { featureId: gpId, featureTitle: gpTitle, featureType: gpType, totalEstimate: 0, totalCompleted: 0, overrun: false });
      }
      const fg = map.get(key)!;
      fg.totalEstimate += g.totalEstimate;
      fg.totalCompleted += g.totalCompleted;
    }
    for (const fg of map.values()) {
      fg.overrun = fg.totalEstimate > 0 && fg.totalCompleted > fg.totalEstimate;
    }
    return [...map.values()].sort((a, b) => a.featureTitle.localeCompare(b.featureTitle));
  }

  // ── KPIs Sprint ───────────────────────────────────────────

  /**
   * Retourne les KPIs du sprint correspondant à l'onglet actif (sp1/sp2/sp3).
   * Retourne un tableau vide si l'onglet n'est pas un onglet sprint.
   */
  kpisForCurrentSprint(): SprintMemberKpi[] {
    const n = this.activeTab === 'sp1' ? 1 : this.activeTab === 'sp2' ? 2 : 3;
    return this.sprintKpis[n] ?? [];
  }

  // ── Analyse productivité ──────────────────────────────────

  /**
   * Construit la clé unique identifiant un rapport sauvegardé.
   * @param sprintNum Numéro du sprint (1, 2 ou 3).
   * @param memberId Identifiant du membre.
   */
  private reportKey(sprintNum: number, memberId: number): string {
    return `${this.selectedPiId}-${sprintNum}-${memberId}`;
  }

  /**
   * Indique si un rapport sauvegardé existe pour le membre dans le sprint actif.
   * @param memberId Identifiant du membre.
   */
  hasSavedReport(memberId: number): boolean {
    const sprintNum = this.activeTab === 'sp1' ? 1 : this.activeTab === 'sp2' ? 2 : 3;
    return this.savedReportExists.has(this.reportKey(sprintNum, memberId));
  }

  /**
   * Vérifie en parallèle pour chaque membre du sprint s'il possède un rapport sauvegardé.
   * Alimente `savedReportExists` sans afficher de rapport.
   */
  loadSavedReports(): void {
    if (!this.selectedPiId) return;
    const piId = this.selectedPiId;
    const sprintNum = this.activeTab === 'sp1' ? 1 : this.activeTab === 'sp2' ? 2 : 3;
    const kpis = this.kpisForCurrentSprint();
    kpis.forEach((m) => {
      this.api.getLatestProductivityReport(piId, sprintNum, m.member_id).subscribe({
        next: () => this.savedReportExists.add(this.reportKey(sprintNum, m.member_id)),
        error: () => {},
      });
    });
  }

  /**
   * Déclenche une nouvelle analyse LLM de productivité pour un membre.
   * Le rapport est sauvegardé (upsert) et affiché dans la modale.
   * @param memberId Identifiant du membre à analyser.
   */
  analyzeProductivity(memberId: number): void {
    if (!this.selectedPiId) return;
    const sprintNum = this.activeTab === 'sp1' ? 1 : this.activeTab === 'sp2' ? 2 : 3;
    this.analyzingMemberId = memberId;
    this.api.analyzeProductivity(this.selectedPiId, sprintNum, memberId).subscribe({
      next: (res) => {
        this.analyzingMemberId = null;
        this.savedReportExists.add(this.reportKey(sprintNum, memberId));
        this.analysisReport = { member: res.member, sprint: res.sprint, text: res.analysis };
        this.showAnalysisModal = true;
      },
      error: (err) => {
        this.analyzingMemberId = null;
        alert(err.error?.detail ?? 'Erreur lors de l\'analyse LLM');
      },
    });
  }

  /**
   * Charge et affiche le dernier rapport sauvegardé pour un membre sans relancer l'analyse.
   * @param memberId Identifiant du membre.
   */
  showSavedReport(memberId: number): void {
    if (!this.selectedPiId) return;
    const sprintNum = this.activeTab === 'sp1' ? 1 : this.activeTab === 'sp2' ? 2 : 3;
    this.loadingReportMemberId = memberId;
    this.api.getLatestProductivityReport(this.selectedPiId, sprintNum, memberId).subscribe({
      next: (res) => {
        this.loadingReportMemberId = null;
        this.analysisReport = { member: res.member, sprint: res.sprint, text: res.analysis };
        this.showAnalysisModal = true;
      },
      error: () => { this.loadingReportMemberId = null; },
    });
  }

  /** Ferme la modale d'analyse et efface le rapport affiché. */
  closeAnalysisModal(): void {
    this.showAnalysisModal = false;
    this.analysisReport = null;
  }

  // ── Planned Stories ───────────────────────────────────────

  buildAzdoUrl(id: number): string {
    if (!this.azdoOrg || !this.azdoProject) return '';
    return `https://dev.azure.com/${this.azdoOrg}/${this.azdoProject}/_workitems/edit/${id}`;
  }

  loadPlannedStories(sprint: number): void {
    if (!this.selectedPiId || this.plannedStoriesData[sprint]) return;
    this.plannedStoriesLoading[sprint] = true;
    this.api.getPlannedStories(this.selectedPiId, sprint).subscribe({
      next: (data) => {
        this.plannedStoriesData[sprint] = data;
        this.plannedStoriesLoading[sprint] = false;
      },
      error: () => { this.plannedStoriesLoading[sprint] = false; },
    });
  }

  refreshPlannedStories(sprint: number): void {
    delete this.plannedStoriesData[sprint];
    this.loadPlannedStories(sprint);
  }

  analyzeStory(pbrItemId: number, storyId: number, sprint: number): void {
    this.analyzingStoryId = storyId;
    this.api.analyzePBRItem(pbrItemId).subscribe({
      next: (res: any) => {
        const data = this.plannedStoriesData[sprint];
        if (data) {
          const updateStory = (story: PlannedStory) => {
            if (story.id === storyId) {
              story.dor_note = res.ia_dor_note;
              story.dor_comment = res.ia_comment;
              story.dor_analyzed_at = res.ia_analyzed_at;
            }
          };
          data.groups.forEach(g => g.stories.forEach(updateStory));
          data.orphans.forEach(updateStory);
        }
        this.analyzingStoryId = null;
      },
      error: () => { this.analyzingStoryId = null; },
    });
  }

  filteredPlannedGroups(sprint: number): PlannedGroup[] {
    const data = this.plannedStoriesData[sprint];
    if (!data) return [];
    const filterGroup = (g: PlannedGroup): PlannedGroup => ({
      ...g,
      stories: g.stories.filter(s => this.storyMatchesFilter(s)),
    });
    return data.groups.map(filterGroup).filter(g => g.stories.length > 0);
  }

  filteredOrphans(sprint: number): PlannedStory[] {
    const data = this.plannedStoriesData[sprint];
    if (!data) return [];
    return data.orphans.filter(s => this.storyMatchesFilter(s));
  }

  private storyMatchesFilter(s: PlannedStory): boolean {
    if (this.storyFilterMember && !s.members.some(m => m.name === this.storyFilterMember)) return false;
    if (this.storyFilterState && s.state !== this.storyFilterState) return false;
    return true;
  }

  allMembers(sprint: number): string[] {
    const data = this.plannedStoriesData[sprint];
    if (!data) return [];
    const names = new Set<string>();
    data.groups.forEach(g => g.stories.forEach(s => s.members.forEach(m => names.add(m.name))));
    data.orphans.forEach(s => s.members.forEach(m => names.add(m.name)));
    return [...names].sort();
  }

  allStoryStates(sprint: number): string[] {
    const data = this.plannedStoriesData[sprint];
    if (!data) return [];
    const states = new Set<string>();
    data.groups.forEach(g => g.stories.forEach(s => { if (s.state) states.add(s.state); }));
    data.orphans.forEach(s => { if (s.state) states.add(s.state); });
    return [...states].sort();
  }

  getMemberNames(members: StoryMember[]): string {
    return members.map(m => m.name).join(', ');
  }

  /** Copie le texte du rapport d'analyse dans le presse-papier. */
  copyAnalysisToClipboard(): void {
    if (!this.analysisReport) return;
    navigator.clipboard.writeText(this.analysisReport.text);
  }

  // ── Capacités ─────────────────────────────────────────────

  /**
   * Charge les capacités (`SprintCapacity`) du sprint et du PI courants.
   * Les données sont copiées en local dans `editCapacities` pour édition.
   */
  loadCapacities(): void {
    if (!this.selectedPiId) return;
    this.api.getSprintCapacities(this.selectedPiId, this.capacitesSprintNum).subscribe((rows) => {
      this.editCapacities = rows.map((r) => ({ ...r }));
    });
  }

  /**
   * Change le sprint affiché dans l'onglet capacités et recharge les données.
   * @param n Numéro du sprint (1, 2 ou 3).
   */
  onCapacitesSprintChange(n: number): void {
    this.capacitesSprintNum = n;
    this.loadCapacities();
  }

  /**
   * Sauvegarde les capacités éditées via l'API, puis recharge les KPIs pour
   * mettre à jour les graphiques.
   */
  saveCapacities(): void {
    if (!this.selectedPiId) return;
    this.capacitesSaving = true;
    this.api.saveSprintCapacities(this.selectedPiId, this.capacitesSprintNum, this.editCapacities).subscribe({
      next: (rows) => {
        this.editCapacities = rows.map((r) => ({ ...r }));
        this.capacitesSaving = false;
        // Recharge les KPIs pour que les graphiques se mettent à jour
        this.loadData();
      },
      error: () => { this.capacitesSaving = false; },
    });
  }

  /**
   * Importe les capacités depuis les blocs Layer 1 du PI Planning après confirmation.
   * Écrase les capacités saisies manuellement pour le sprint courant.
   */
  importCapacities(): void {
    if (!this.selectedPiId) return;
    if (!confirm('Importer depuis PI Planning remplacera les capacités saisies pour ce sprint. Continuer ?')) return;
    this.capacitesImporting = true;
    this.api.importCapacitiesFromPlanning(this.selectedPiId, this.capacitesSprintNum).subscribe({
      next: (rows) => {
        this.editCapacities = rows.map((r) => ({ ...r }));
        this.capacitesImporting = false;
        this.loadData();
      },
      error: () => { this.capacitesImporting = false; },
    });
  }

  /**
   * Supprime toutes les capacités saisies pour le sprint courant après confirmation.
   */
  resetCapacities(): void {
    if (!this.selectedPiId) return;
    if (!confirm('Réinitialiser supprimera toutes les capacités saisies pour ce sprint. Continuer ?')) return;
    this.api.resetSprintCapacities(this.selectedPiId, this.capacitesSprintNum).subscribe(() => {
      this.editCapacities = [];
      this.loadData();
    });
  }

  /**
   * Calcule la capacité totale (en heures) d'une ligne de `SprintCapacity`.
   * @param row Ligne de capacité à totaliser.
   */
  capaTotalRow(row: SprintCapacity): number {
    return row.capa_stories_h + row.capa_bugs_h + row.capa_imprevus_h
      + row.capa_agility_h + row.capa_reunions_h + row.capa_psm_h + row.capa_montee_h;
  }

  /**
   * Calcule le total d'une colonne de capacité sur toutes les lignes éditées.
   * @param field Clé numérique d'une propriété de `SprintCapacity`.
   */
  capaColumnTotal(field: keyof SprintCapacity): number {
    return this.editCapacities.reduce((s, r) => s + (Number(r[field]) || 0), 0);
  }

  // ── Charts ────────────────────────────────────────────────

  /**
   * Délègue la construction des graphiques selon l'onglet actif.
   * Appelé par `ngAfterViewChecked` lorsque `chartsNeedRebuild` est posé.
   */
  private buildCharts(): void {
    if (this.activeTab === 'general') {
      this.buildGeneralChart();
      this.buildFeatureChart();
    } else if (['sp1', 'sp2', 'sp3'].includes(this.activeTab)) {
      this.buildSprintCharts();
    } else if (this.activeTab === 'piall') {
      this.buildOverviewChart();
    }
  }

  /**
   * Retrouve l'élément canvas par son identifiant parmi les `ViewChildren`.
   * @param id Valeur de l'attribut `id` du canvas dans le template.
   */
  private getCanvas(id: string): HTMLCanvasElement | null {
    const el = this.chartCanvases?.find((c) => c.nativeElement.id === id);
    return el?.nativeElement ?? null;
  }

  /**
   * Crée (ou recrée) une instance Chart.js sur le canvas identifié.
   * Détruit l'instance précédente si elle existe pour éviter les doublons.
   * @param id Identifiant du canvas cible.
   * @param config Configuration Chart.js complète.
   */
  private createChart(id: string, config: any): void {
    this.charts.get(id)?.destroy();
    const canvas = this.getCanvas(id);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    this.charts.set(id, new Chart(ctx, config));
  }

  /**
   * Construit le graphique "Par story" (onglet Général).
   * Affiche estimation vs réalisé pour les 40 premières stories/enablers.
   * Les barres sont colorées en rouge si le réalisé dépasse l'estimation.
   */
  private buildGeneralChart(): void {
    const storyTypes = new Set(['User Story', 'Enabler Story']);
    const groups = this.taskGroups
      .filter((g) => storyTypes.has(g.parentType))
      .slice(0, 40); // limite visuelle
    const labels = groups.map((g) => this.truncate(g.parentTitle, 20));
    const fullTitles = groups.map((g) => g.parentTitle);
    this.createChart('chart-general', {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Estimation (h)',
            data: groups.map((g) => g.totalEstimate),
            backgroundColor: groups.map((g) => g.overrun ? '#d93025cc' : '#34a853cc'),
            borderWidth: 0,
          },
          {
            label: 'Réalisé (h)',
            data: groups.map((g) => g.totalCompleted),
            backgroundColor: groups.map((g) => g.overrun ? '#d93025' : '#1e8e3e'),
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              title: (items: { dataIndex: number }[]) => fullTitles[items[0].dataIndex] ?? labels[items[0].dataIndex],
            },
          },
        },
        scales: {
          x: { ticks: { font: { size: 10 } } },
          y: { title: { display: true, text: 'Heures' } },
        },
      },
    });
  }

  /**
   * Construit le graphique "Par Feature" (onglet Général).
   * Agrège les heures à la maille Feature/Enabler (grand-parent des stories).
   */
  private buildFeatureChart(): void {
    const groups = this.featureGroups.slice(0, 40);
    if (!groups.length) return;
    const labels = groups.map((g) => this.truncate(g.featureTitle, 20));
    const fullTitles = groups.map((g) => g.featureTitle);
    this.createChart('chart-feature', {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Estimation (h)',
            data: groups.map((g) => g.totalEstimate),
            backgroundColor: groups.map((g) => g.overrun ? '#d93025cc' : '#f6ae2dcc'),
            borderWidth: 0,
          },
          {
            label: 'Réalisé (h)',
            data: groups.map((g) => g.totalCompleted),
            backgroundColor: groups.map((g) => g.overrun ? '#d93025' : '#e37400'),
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              title: (items: { dataIndex: number }[]) => fullTitles[items[0].dataIndex] ?? labels[items[0].dataIndex],
            },
          },
        },
        scales: {
          x: { ticks: { font: { size: 10 } } },
          y: { title: { display: true, text: 'Heures' } },
        },
      },
    });
  }

  /**
   * Construit les 4 graphiques des onglets Sprint (sp1/sp2/sp3) :
   * 1. Stories — capacité vs réalisé
   * 2. Bugs & Maintenance — capacité vs réalisé
   * 3. Imprévus & PSM — capacité vs réalisé (barres empilées)
   * 4. Total — capacité vs réalisé global
   */
  private buildSprintCharts(): void {
    const kpis = this.kpisForCurrentSprint();
    if (!kpis.length) return;
    const labels = kpis.map((m) => m.display_name.split(' ').pop() ?? m.display_name);

    const BLUE_LIGHT = '#4285f4cc';
    const BLUE_DARK  = '#1a73e8';
    const GREEN_LIGHT = '#34a853cc';
    const GREEN_DARK  = '#1e8e3e';
    const RED_DARK    = '#d93025';
    const ORANGE      = '#e37400';

    // Chart 1 — Stories
    this.createChart('chart-stories', {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Capa Stories (h)', data: kpis.map((m) => m.capa_stories_h), backgroundColor: BLUE_LIGHT },
          { label: 'Réalisé Stories (h)', data: kpis.map((m) => m.work_stories_h), backgroundColor: BLUE_DARK },
        ],
      },
      options: this.groupedBarOptions('Stories — Capacité vs Réalisé par collaborateur'),
    });

    // Chart 2 — Bugs & Maintenance
    this.createChart('chart-bugs', {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Capa Bugs/Maint (h)', data: kpis.map((m) => m.capa_bugs_h), backgroundColor: BLUE_LIGHT },
          { label: 'Réalisé Bugs (h)',     data: kpis.map((m) => m.work_bugs_h), backgroundColor: RED_DARK },
          { label: 'Réalisé Maint (h)',    data: kpis.map((m) => m.work_maint_h), backgroundColor: ORANGE },
        ],
      },
      options: this.groupedBarOptions('Bugs & Maintenance — Capacité vs Réalisé par collaborateur'),
    });

    // Chart 3 — Imprévus + PSM (PSM empilé sur Imprévus)
    this.createChart('chart-imprevus', {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Capa Imprévus (h)', data: kpis.map((m) => m.capa_imprevus_h), backgroundColor: BLUE_LIGHT, stack: 'capa' },
          { label: 'Capa PSM (h)',       data: kpis.map((m) => m.capa_psm_h),      backgroundColor: GREEN_LIGHT, stack: 'capa' },
          { label: 'Réalisé Imprévus (h)', data: kpis.map((m) => m.work_orphan_h), backgroundColor: BLUE_DARK, stack: 'work' },
        ],
      },
      options: this.groupedBarOptions('Imprévus & PSM — Capacité vs Réalisé par collaborateur'),
    });

    // Chart 4 — Total
    this.createChart('chart-total', {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Capa Totale (h)',  data: kpis.map((m) => m.capa_total_h), backgroundColor: BLUE_LIGHT },
          { label: 'Réalisé Total (h)', data: kpis.map((m) => m.work_total_h), backgroundColor: BLUE_DARK },
        ],
      },
      options: this.groupedBarOptions('Capacité totale vs Réalisé total par collaborateur'),
    });
  }

  /**
   * Construit le graphique de l'onglet "PI All" : story points par état AZDO.
   */
  private buildOverviewChart(): void {
    if (!this.overview) return;
    const byState = this.overview.story_points.by_state;
    if (!byState.length) return;
    this.createChart('chart-sp-state', {
      type: 'bar',
      data: {
        labels: byState.map((s) => s.state),
        datasets: [{
          label: 'Story Points',
          data: byState.map((s) => s.points),
          backgroundColor: '#4285f4cc',
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { title: { display: true, text: 'SP' } } },
      },
    });
  }

  /**
   * Retourne les options Chart.js communes aux graphiques groupés des onglets sprint.
   * @param title Titre affiché au-dessus du graphique.
   */
  private groupedBarOptions(title: string): any {
    return {
      responsive: true,
      plugins: {
        legend: { position: 'top', labels: { font: { size: 11 } } },
        title: { display: true, text: title, font: { size: 12, weight: 'bold' } },
      },
      scales: {
        x: { ticks: { font: { size: 10 } } },
        y: { title: { display: true, text: 'Heures' } },
      },
    };
  }

  /**
   * Tronque une chaîne à `n` caractères en ajoutant une ellipse si nécessaire.
   * Utilisé pour les étiquettes des axes X des graphiques.
   * @param s Chaîne à tronquer.
   * @param n Longueur maximale.
   */
  private truncate(s: string, n: number): string {
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  // ── Helpers template ──────────────────────────────────────

  /**
   * Convertit un type de work item en classe CSS (minuscules, espaces remplacés par tirets).
   * Exemple : `"User Story"` → `"user-story"`.
   * @param type Type AZDO du work item.
   */
  typeCss(type: string): string {
    return type.toLowerCase().replace(/\s+/g, '-');
  }

  /**
   * Retourne le nom lisible d'un PI à partir de son identifiant.
   * @param id Identifiant du PI.
   */
  piName(id: number | null): string {
    return this.piList.find((p) => p.id === id)?.name ?? `PI #${id}`;
  }

  /**
   * Formate une valeur numérique en français avec au plus 1 décimale.
   * Retourne `'—'` si la valeur est nulle ou indéfinie.
   * @param v Valeur à formater.
   */
  fmt(v: number | null | undefined): string {
    if (v == null) return '—';
    return v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  }

  /**
   * Retourne la classe CSS de coloration d'un pourcentage KPI.
   * - `kpi-danger` : ≥ 100 % (dépassement)
   * - `kpi-warning` : ≥ 85 %
   * - `kpi-ok` : < 85 %
   * @param pct Pourcentage (0–100+), ou null si non calculable.
   */
  pctColor(pct: number | null): string {
    if (pct == null) return '';
    if (pct >= 100) return 'kpi-danger';
    if (pct >= 85)  return 'kpi-warning';
    return 'kpi-ok';
  }
}
