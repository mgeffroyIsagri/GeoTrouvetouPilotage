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

type Tab = 'general' | 'sp1' | 'sp2' | 'sp3' | 'piall' | 'capacites';

interface TaskGroup {
  parentId: number | null;
  parentTitle: string;
  parentType: string;
  tasks: SuiviTask[];
  totalEstimate: number;
  totalCompleted: number;
  totalRemaining: number;
  overrun: boolean;
}

interface FeatureGroup {
  featureId: number | null;
  featureTitle: string;
  featureType: string;
  totalEstimate: number;
  totalCompleted: number;
  overrun: boolean;
}

@Component({
  selector: 'app-suivi',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './suivi.component.html',
  styleUrl: './suivi.component.scss',
})
export class SuiviComponent implements OnInit, OnDestroy, AfterViewChecked {
  piList: PI[] = [];
  selectedPiId: number | null = null;
  activeTab: Tab = 'general';

  // Configuration AZDO
  azdoRoots: string[] = [];
  selectedAzdoPath = '';
  showAzdoConfig = false;

  // Données
  tasks: SuiviTask[] = [];
  sprintKpis: { [sprint: number]: SprintMemberKpi[] } = {};
  overview: SuiviOverview | null = null;

  // États UI
  loading = false;

  // Capacités
  capacitesSprintNum = 1;
  editCapacities: SprintCapacity[] = [];
  capacitesSaving = false;
  capacitesImporting = false;

  // Analyse productivité
  analyzingMemberId: number | null = null;
  loadingReportMemberId: number | null = null;
  analysisReport: { member: string; sprint: string; text: string } | null = null;
  showAnalysisModal = false;
  savedReportExists: Set<string> = new Set(); // clé: `${piId}-${sprint}-${memberId}`

  // Filtres onglet Général
  filterSprint: number | null = null;
  filterAssignee = '';
  filterParentType = '';

  // Charts
  @ViewChildren('chartCanvas') chartCanvases!: QueryList<ElementRef<HTMLCanvasElement>>;
  private charts = new Map<string, Chart>();
  private chartsNeedRebuild = false;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
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

  get selectedPi(): PI | null {
    return this.piList.find((p) => p.id === this.selectedPiId) ?? null;
  }

  checkAzdoConfig(): void {
    this.showAzdoConfig = !!this.selectedPi && !this.selectedPi.azdo_iteration_path;
    this.selectedAzdoPath = this.azdoRoots[0] ?? '';
  }

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

  ngOnDestroy(): void {
    this.charts.forEach((c) => c.destroy());
    this.charts.clear();
  }

  ngAfterViewChecked(): void {
    if (this.chartsNeedRebuild) {
      this.chartsNeedRebuild = false;
      this.buildCharts();
    }
  }

  onPiChange(): void {
    this.checkAzdoConfig();
    this.loadData();
    if (this.activeTab === 'capacites') this.loadCapacities();
  }

  setTab(tab: Tab): void {
    this.activeTab = tab;
    this.chartsNeedRebuild = true;
    if (tab === 'capacites') this.loadCapacities();
    if (tab === 'sp1' || tab === 'sp2' || tab === 'sp3') {
      setTimeout(() => this.loadSavedReports(), 0);
    }
  }

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

  // ── Onglet Général ────────────────────────────────────────────────────────

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

  get parentTypes(): string[] {
    const types = new Set<string>();
    for (const t of this.tasks) {
      if (t.parent_type) types.add(t.parent_type);
    }
    return [...types].sort();
  }

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

  get assignees(): string[] {
    return [...new Set(this.tasks.map((t) => t.assigned_to ?? '').filter(Boolean))].sort();
  }

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

  // ── KPIs Sprint ───────────────────────────────────────────────────────────

  kpisForCurrentSprint(): SprintMemberKpi[] {
    const n = this.activeTab === 'sp1' ? 1 : this.activeTab === 'sp2' ? 2 : 3;
    return this.sprintKpis[n] ?? [];
  }

  // ── Analyse productivité ─────────────────────────────────────────────────

  private reportKey(sprintNum: number, memberId: number): string {
    return `${this.selectedPiId}-${sprintNum}-${memberId}`;
  }

  hasSavedReport(memberId: number): boolean {
    const sprintNum = this.activeTab === 'sp1' ? 1 : this.activeTab === 'sp2' ? 2 : 3;
    return this.savedReportExists.has(this.reportKey(sprintNum, memberId));
  }

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

  closeAnalysisModal(): void {
    this.showAnalysisModal = false;
    this.analysisReport = null;
  }

  copyAnalysisToClipboard(): void {
    if (!this.analysisReport) return;
    navigator.clipboard.writeText(this.analysisReport.text);
  }

  // ── Capacités ─────────────────────────────────────────────────────────────

  loadCapacities(): void {
    if (!this.selectedPiId) return;
    this.api.getSprintCapacities(this.selectedPiId, this.capacitesSprintNum).subscribe((rows) => {
      this.editCapacities = rows.map((r) => ({ ...r }));
    });
  }

  onCapacitesSprintChange(n: number): void {
    this.capacitesSprintNum = n;
    this.loadCapacities();
  }

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

  resetCapacities(): void {
    if (!this.selectedPiId) return;
    if (!confirm('Réinitialiser supprimera toutes les capacités saisies pour ce sprint. Continuer ?')) return;
    this.api.resetSprintCapacities(this.selectedPiId, this.capacitesSprintNum).subscribe(() => {
      this.editCapacities = [];
      this.loadData();
    });
  }

  capaTotalRow(row: SprintCapacity): number {
    return row.capa_stories_h + row.capa_bugs_h + row.capa_imprevus_h
      + row.capa_agility_h + row.capa_reunions_h + row.capa_psm_h + row.capa_montee_h;
  }

  capaColumnTotal(field: keyof SprintCapacity): number {
    return this.editCapacities.reduce((s, r) => s + (Number(r[field]) || 0), 0);
  }

  // ── Charts ────────────────────────────────────────────────────────────────

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

  private getCanvas(id: string): HTMLCanvasElement | null {
    const el = this.chartCanvases?.find((c) => c.nativeElement.id === id);
    return el?.nativeElement ?? null;
  }

  private createChart(id: string, config: any): void {
    this.charts.get(id)?.destroy();
    const canvas = this.getCanvas(id);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    this.charts.set(id, new Chart(ctx, config));
  }

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

  private truncate(s: string, n: number): string {
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  // ── Helpers template ──────────────────────────────────────────────────────

  typeCss(type: string): string {
    return type.toLowerCase().replace(/\s+/g, '-');
  }

  piName(id: number | null): string {
    return this.piList.find((p) => p.id === id)?.name ?? `PI #${id}`;
  }

  fmt(v: number | null | undefined): string {
    if (v == null) return '—';
    return v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  }

  pctColor(pct: number | null): string {
    if (pct == null) return '';
    if (pct >= 100) return 'kpi-danger';
    if (pct >= 85)  return 'kpi-warning';
    return 'kpi-ok';
  }
}
