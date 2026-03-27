import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { PI } from '../../../core/models';
import { ApiService } from '../../../core/services/api.service';

/** Résultat générique d'une opération admin (close/move/update/create). */
interface AdminOpResult {
  updated?: number[];
  created?: (number | null)[];
  errors?: { id?: number; task?: string; path?: string; error: string }[];
}

/** Item d'itération AZDO (check tab 1). */
interface IterationStatus {
  label: string;
  path: string;
  exists: boolean;
}

/** Work item non clôturé (tab 2). */
interface UnclosedItem {
  id: number;
  title: string;
  type: string;
  state: string;
  assigned_to: string;
  iteration_path: string;
  selected?: boolean;
}

/** Item à mettre à jour (tabs 3 & 4). */
interface PathItem {
  id: number;
  title: string;
  type: string;
  current_path: string;
  new_path: string;
  sprint_number?: number;
  needs_update?: boolean;
  selected?: boolean;
}

/** Tâche enfant story à créer (tab 6). */
interface StoryTask {
  story_id: number;
  title: string;
  type: string;
  sprint_number: number;
  iteration_path: string;
  total_days: number;
  total_hours: number;
  has_existing_task: boolean;
  selected?: boolean;
}

/** Tâche Hors-Prod à créer (tab 5). */
interface HorsProdTask {
  member_name: string;
  sprint_number: number;
  category: string;
  category_label: string;
  duration_days: number;
  hours: number;
  iteration_path: string;
  assigned_to: string;
  title: string;
  selected?: boolean;
}

type AdminTab = 'iterations' | 'unclosed' | 'parents' | 'stories' | 'hors-prod' | 'story-tasks';

@Component({
  selector: 'app-admin-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-panel.component.html',
  styleUrl: './admin-panel.component.scss',
})
export class AdminPanelComponent implements OnChanges {
  @Input() pi!: PI;

  activeTab: AdminTab = 'iterations';

  // ── Tab 1 : Itérations ──────────────────────────────────────────────────────
  iterChecking = false;
  iterCreating = false;
  iterItems: IterationStatus[] = [];
  iterPiPath = '';
  iterTeam = '';
  iterResult: AdminOpResult | null = null;
  iterError = '';

  // ── Tab 2 : Items non clôturés ──────────────────────────────────────────────
  unclosedLoading = false;
  unclosedItems: UnclosedItem[] = [];
  unclosedPrevPi: { name: string; azdo_iteration_path: string } | null = null;
  unclosedCurrentPi: { name: string; azdo_iteration_path: string } | null = null;
  unclosedClosing = false;
  unclosedMoving = false;
  unclosedResult: AdminOpResult | null = null;
  unclosedError = '';
  unclosedFilter: 'all' | 'Task' | 'Bug' | 'Story' | 'Feature' | 'Enabler' | 'Question' = 'all';
  unclosedResolving = false;
  resolveReason = 'Réalisé';
  readonly resolveReasons = ['Réalisé', 'Reporté', 'Fractionné', 'Obsolète'];
  moveTargetSprint: string = '';  // '' = PI racine, 'Sprint 1'..'Sprint 4' = sprint précis
  readonly moveSprintOptions: { label: string; value: string }[] = [
    { label: 'PI (racine)', value: '' },
    { label: 'Sprint 1', value: 'Sprint 1' },
    { label: 'Sprint 2', value: 'Sprint 2' },
    { label: 'Sprint 3', value: 'Sprint 3' },
    { label: 'Sprint 4', value: 'Sprint 4' },
  ];

  // ── Tab 3 : Parents (Features/Enablers) ────────────────────────────────────
  parentsLoading = false;
  parentsItems: PathItem[] = [];
  parentsUpdating = false;
  parentsResult: AdminOpResult | null = null;
  parentsError = '';

  // ── Tab 4 : Stories ─────────────────────────────────────────────────────────
  storiesLoading = false;
  storiesItems: PathItem[] = [];
  storiesUpdating = false;
  storiesResult: AdminOpResult | null = null;
  storiesError = '';

  // ── Tab 6 : Tâches enfants stories ──────────────────────────────────────────
  storyTasksLoading = false;
  storyTasksItems: StoryTask[] = [];
  storyTasksCreating = false;
  storyTasksResult: AdminOpResult | null = null;
  storyTasksError = '';

  // ── Tab 5 : Hors-Prod ───────────────────────────────────────────────────────
  horsProdLoading = false;
  horsProdTasks: HorsProdTask[] = [];
  horsProdCreating = false;
  horsProdResult: AdminOpResult | null = null;
  horsProdError = '';

  // ── Confirmation dialog ──────────────────────────────────────────────────────
  confirmVisible = false;
  confirmMessage = '';
  confirmCallback: (() => void) | null = null;

  private readonly base = window.location.hostname === 'localhost'
    ? 'http://localhost:8002/api'
    : '/api';

  constructor(private http: HttpClient) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['pi']) {
      // Reset all state when PI changes
      this.iterItems = [];
      this.unclosedItems = [];
      this.parentsItems = [];
      this.storiesItems = [];
      this.horsProdTasks = [];
      this.storyTasksItems = [];
    }
  }

  selectTab(tab: AdminTab): void {
    this.activeTab = tab;
  }

  // ── Confirmation ─────────────────────────────────────────────────────────────

  confirm(message: string, callback: () => void): void {
    this.confirmMessage = message;
    this.confirmCallback = callback;
    this.confirmVisible = true;
  }

  onConfirmOk(): void {
    this.confirmVisible = false;
    this.confirmCallback?.();
    this.confirmCallback = null;
  }

  onConfirmCancel(): void {
    this.confirmVisible = false;
    this.confirmCallback = null;
  }

  // ── Tab 1 : Itérations ──────────────────────────────────────────────────────

  checkIterations(): void {
    this.iterChecking = true;
    this.iterError = '';
    this.iterResult = null;
    this.http.get<any>(`${this.base}/admin/pi/${this.pi.id}/iterations/check`).subscribe({
      next: (res) => {
        this.iterItems = res.items;
        this.iterPiPath = res.pi_path;
        this.iterTeam = res.team;
        this.iterChecking = false;
      },
      error: (err) => {
        this.iterError = err.error?.detail || 'Erreur lors de la vérification';
        this.iterChecking = false;
      },
    });
  }

  get iterMissingCount(): number {
    return this.iterItems.filter(i => !i.exists).length;
  }

  createMissingIterations(): void {
    const missing = this.iterItems.filter(i => !i.exists);
    if (!missing.length) return;
    this.confirm(
      `Créer ${missing.length} nœud(s) d'itération manquant(s) dans AZDO ?\n\n` +
      missing.map(m => `• ${m.label}`).join('\n'),
      () => this._doCreateIterations()
    );
  }

  private _doCreateIterations(): void {
    this.iterCreating = true;
    this.iterResult = null;
    this.http.post<any>(`${this.base}/admin/pi/${this.pi.id}/iterations/create`, {}).subscribe({
      next: (res) => {
        this.iterResult = res;
        this.iterCreating = false;
        this.checkIterations(); // refresh check
      },
      error: (err) => {
        this.iterError = err.error?.detail || 'Erreur lors de la création';
        this.iterCreating = false;
      },
    });
  }

  // ── Tab 2 : Items non clôturés ──────────────────────────────────────────────

  loadUnclosedItems(): void {
    this.unclosedLoading = true;
    this.unclosedError = '';
    this.unclosedResult = null;
    this.http.get<any>(`${this.base}/admin/pi/${this.pi.id}/unclosed-items`).subscribe({
      next: (res) => {
        this.unclosedPrevPi = res.prev_pi;
        this.unclosedCurrentPi = res.current_pi;
        this.unclosedItems = (res.items || []).map((i: UnclosedItem) => ({ ...i, selected: true }));
        this.unclosedLoading = false;
      },
      error: (err) => {
        this.unclosedError = err.error?.detail || 'Erreur lors du chargement';
        this.unclosedLoading = false;
      },
    });
  }

  get filteredUnclosedItems(): UnclosedItem[] {
    if (this.unclosedFilter === 'all') return this.unclosedItems;
    if (this.unclosedFilter === 'Story') {
      return this.unclosedItems.filter(i => i.type.includes('Story') || i.type === 'Maintenance');
    }
    if (this.unclosedFilter === 'Feature') {
      return this.unclosedItems.filter(i => i.type === 'Feature' || i.type === 'Enabler');
    }
    return this.unclosedItems.filter(i => i.type === this.unclosedFilter);
  }

  get selectedUnclosedIds(): number[] {
    return this.unclosedItems.filter(i => i.selected).map(i => i.id);
  }

  /** True si tous les items sélectionnés sont en état Resolved (prêts à être fermés). */
  get canCloseSelected(): boolean {
    const sel = this.unclosedItems.filter(i => i.selected);
    return sel.length > 0 && sel.every(i => i.state === 'Resolved');
  }

  /** True si au moins un item sélectionné n'est pas encore Resolved. */
  get canResolveSelected(): boolean {
    return this.unclosedItems.some(i => i.selected && i.state !== 'Resolved');
  }

  get resolveableCount(): number {
    return this.unclosedItems.filter(i => i.selected && i.state !== 'Resolved').length;
  }

  get closableCount(): number {
    return this.unclosedItems.filter(i => i.selected && i.state === 'Resolved').length;
  }

  closeTasks(): void {
    const ids = this.selectedUnclosedIds;
    if (!ids.length) return;
    this.confirm(
      `Fermer ${ids.length} work item(s) dans AZDO ? Cette action est irréversible.`,
      () => this._doCloseTasks(ids)
    );
  }

  resolveItems(): void {
    const ids = this.unclosedItems.filter(i => i.selected && i.state !== 'Resolved').map(i => i.id);
    if (!ids.length) return;
    this.confirm(
      `Passer ${ids.length} work item(s) à l'état Resolved avec la raison "${this.resolveReason}" dans AZDO ?`,
      () => this._doResolveItems(ids)
    );
  }

  private _doResolveItems(ids: number[]): void {
    this.unclosedResolving = true;
    this.unclosedResult = null;
    this.http.post<any>(`${this.base}/admin/pi/${this.pi.id}/resolve-tasks`, {
      work_item_ids: ids,
      resolved_reason: this.resolveReason,
    }).subscribe({
      next: (res) => {
        this.unclosedResult = res;
        this.unclosedResolving = false;
        const resolvedSet = new Set(res.updated || []);
        this.unclosedItems = this.unclosedItems.map(i =>
          resolvedSet.has(i.id) ? { ...i, state: 'Resolved' } : i
        );
      },
      error: (err) => {
        this.unclosedError = err.error?.detail || 'Erreur lors de la résolution';
        this.unclosedResolving = false;
      },
    });
  }

  private _doCloseTasks(ids: number[]): void {
    this.unclosedClosing = true;
    this.unclosedResult = null;
    this.http.post<any>(`${this.base}/admin/pi/${this.pi.id}/close-tasks`, { work_item_ids: ids }).subscribe({
      next: (res) => {
        this.unclosedResult = res;
        this.unclosedClosing = false;
        // Remove closed items from list
        const closedSet = new Set(res.updated || []);
        this.unclosedItems = this.unclosedItems.filter(i => !closedSet.has(i.id));
      },
      error: (err) => {
        this.unclosedError = err.error?.detail || 'Erreur lors de la fermeture';
        this.unclosedClosing = false;
      },
    });
  }

  moveToNewPi(): void {
    const ids = this.selectedUnclosedIds;
    if (!ids.length || !this.unclosedCurrentPi) return;
    const base = this.unclosedCurrentPi.azdo_iteration_path;
    const target = this.moveTargetSprint ? `${base}\\${this.moveTargetSprint}` : base;
    this.confirm(
      `Déplacer ${ids.length} work item(s) vers "${target}" ?\n\nLe chemin d'itération sera mis à jour dans AZDO.`,
      () => this._doMoveItems(ids, target)
    );
  }

  private _doMoveItems(ids: number[], target: string): void {
    this.unclosedMoving = true;
    this.unclosedResult = null;
    this.http.post<any>(`${this.base}/admin/pi/${this.pi.id}/move-items`, {
      work_item_ids: ids,
      target_iteration_path: target,
    }).subscribe({
      next: (res) => {
        this.unclosedResult = res;
        this.unclosedMoving = false;
        // Remove moved items from list
        const movedSet = new Set(res.updated || []);
        this.unclosedItems = this.unclosedItems.filter(i => !movedSet.has(i.id));
      },
      error: (err) => {
        this.unclosedError = err.error?.detail || 'Erreur lors du déplacement';
        this.unclosedMoving = false;
      },
    });
  }

  toggleAllUnclosed(checked: boolean): void {
    this.filteredUnclosedItems.forEach(i => i.selected = checked);
  }

  // ── Tab 3 : Parents ─────────────────────────────────────────────────────────

  checkParentIterations(): void {
    this.parentsLoading = true;
    this.parentsError = '';
    this.parentsResult = null;
    this.http.get<any>(`${this.base}/admin/pi/${this.pi.id}/parent-iterations/check`).subscribe({
      next: (res) => {
        this.parentsItems = (res.items || []).map((i: PathItem) => ({ ...i, selected: true }));
        this.parentsLoading = false;
      },
      error: (err) => {
        this.parentsError = err.error?.detail || 'Erreur lors de la vérification';
        this.parentsLoading = false;
      },
    });
  }

  get selectedParentIds(): number[] {
    return this.parentsItems.filter(i => i.selected).map(i => i.id);
  }

  updateParentIterations(): void {
    const ids = this.selectedParentIds;
    if (!ids.length) return;
    this.confirm(
      `Mettre à jour le chemin d'itération de ${ids.length} Feature(s)/Enabler(s) vers "${this.pi.azdo_iteration_path}" dans AZDO ?`,
      () => this._doUpdateParents(ids)
    );
  }

  private _doUpdateParents(ids: number[]): void {
    this.parentsUpdating = true;
    this.parentsResult = null;
    this.http.post<any>(`${this.base}/admin/pi/${this.pi.id}/parent-iterations/update`, {
      work_item_ids: ids,
    }).subscribe({
      next: (res) => {
        this.parentsResult = res;
        this.parentsUpdating = false;
        const updatedSet = new Set(res.updated || []);
        this.parentsItems = this.parentsItems.filter(i => !updatedSet.has(i.id));
      },
      error: (err) => {
        this.parentsError = err.error?.detail || 'Erreur lors de la mise à jour';
        this.parentsUpdating = false;
      },
    });
  }

  // ── Tab 4 : Stories ─────────────────────────────────────────────────────────

  checkStoryIterations(): void {
    this.storiesLoading = true;
    this.storiesError = '';
    this.storiesResult = null;
    this.http.get<any>(`${this.base}/admin/pi/${this.pi.id}/story-iterations/check`).subscribe({
      next: (res) => {
        this.storiesItems = (res.items || [])
          .filter((i: PathItem) => i.needs_update !== false)
          .map((i: PathItem) => ({ ...i, selected: true }));
        this.storiesLoading = false;
      },
      error: (err) => {
        this.storiesError = err.error?.detail || 'Erreur lors de la vérification';
        this.storiesLoading = false;
      },
    });
  }

  get selectedStoryItems(): PathItem[] {
    return this.storiesItems.filter(i => i.selected);
  }

  updateStoryIterations(): void {
    const items = this.selectedStoryItems;
    if (!items.length) return;
    this.confirm(
      `Mettre à jour le chemin d'itération de ${items.length} story(ies) vers leur sprint respectif dans AZDO ?`,
      () => this._doUpdateStories(items)
    );
  }

  private _doUpdateStories(items: PathItem[]): void {
    this.storiesUpdating = true;
    this.storiesResult = null;
    this.http.post<any>(`${this.base}/admin/pi/${this.pi.id}/story-iterations/update`, {
      items: items.map(i => ({ id: i.id, new_path: i.new_path })),
    }).subscribe({
      next: (res) => {
        this.storiesResult = res;
        this.storiesUpdating = false;
        const updatedSet = new Set(res.updated || []);
        this.storiesItems = this.storiesItems.filter(i => !updatedSet.has(i.id));
      },
      error: (err) => {
        this.storiesError = err.error?.detail || 'Erreur lors de la mise à jour';
        this.storiesUpdating = false;
      },
    });
  }

  // ── Tab 5 : Hors-Prod ───────────────────────────────────────────────────────

  previewHorsProd(): void {
    this.horsProdLoading = true;
    this.horsProdError = '';
    this.horsProdResult = null;
    this.http.get<any>(`${this.base}/admin/pi/${this.pi.id}/hors-prod/preview`).subscribe({
      next: (res) => {
        this.horsProdTasks = (res.tasks || []).map((t: HorsProdTask) => ({ ...t, selected: true }));
        this.horsProdLoading = false;
      },
      error: (err) => {
        this.horsProdError = err.error?.detail || 'Erreur lors de la prévisualisation';
        this.horsProdLoading = false;
      },
    });
  }

  get selectedHorsProdTasks(): HorsProdTask[] {
    return this.horsProdTasks.filter(t => t.selected);
  }

  createHorsProdTasks(): void {
    const tasks = this.selectedHorsProdTasks;
    if (!tasks.length) return;
    this.confirm(
      `Créer ${tasks.length} tâche(s) Hors-Prod dans AZDO ?\n\nCes tâches seront créées directement dans Azure DevOps.`,
      () => this._doCreateHorsProd(tasks)
    );
  }

  private _doCreateHorsProd(tasks: HorsProdTask[]): void {
    this.horsProdCreating = true;
    this.horsProdResult = null;
    this.http.post<any>(`${this.base}/admin/pi/${this.pi.id}/hors-prod/create`, { tasks }).subscribe({
      next: (res) => {
        this.horsProdResult = res;
        this.horsProdCreating = false;
        // Remove created tasks (by title matching)
        const errors = new Set((res.errors || []).map((e: any) => e.task));
        this.horsProdTasks = this.horsProdTasks.filter(t => errors.has(t.title));
      },
      error: (err) => {
        this.horsProdError = err.error?.detail || 'Erreur lors de la création';
        this.horsProdCreating = false;
      },
    });
  }

  // ── Tab 6 : Tâches enfants stories ──────────────────────────────────────────

  previewStoryTasks(): void {
    this.storyTasksLoading = true;
    this.storyTasksError = '';
    this.storyTasksResult = null;
    this.http.get<any>(`${this.base}/admin/pi/${this.pi.id}/story-tasks/preview`).subscribe({
      next: (res) => {
        this.storyTasksItems = (res.items || []).map((t: StoryTask) => ({ ...t, selected: !t.has_existing_task }));
        this.storyTasksLoading = false;
      },
      error: (err) => {
        this.storyTasksError = err.error?.detail || 'Erreur lors de la prévisualisation';
        this.storyTasksLoading = false;
      },
    });
  }

  get selectedStoryTasks(): StoryTask[] {
    return this.storyTasksItems.filter(t => t.selected);
  }

  createStoryTasks(): void {
    const tasks = this.selectedStoryTasks;
    if (!tasks.length) return;
    this.confirm(
      `Créer ${tasks.length} tâche(s) enfant dans AZDO ?\n\nChaque tâche sera liée à sa story parente avec l'estimation planifiée.`,
      () => this._doCreateStoryTasks(tasks)
    );
  }

  private _doCreateStoryTasks(tasks: StoryTask[]): void {
    this.storyTasksCreating = true;
    this.storyTasksResult = null;
    const payload = tasks.map(t => ({
      story_id: t.story_id,
      title: t.title,
      iteration_path: t.iteration_path,
      total_hours: t.total_hours,
    }));
    this.http.post<any>(`${this.base}/admin/pi/${this.pi.id}/story-tasks/create`, { tasks: payload }).subscribe({
      next: (res) => {
        this.storyTasksResult = res;
        this.storyTasksCreating = false;
        const createdIds = new Set((res.created || []).map((c: any) => c.story_id));
        this.storyTasksItems = this.storyTasksItems.map(t =>
          createdIds.has(t.story_id) ? { ...t, has_existing_task: true, selected: false } : t
        );
      },
      error: (err) => {
        this.storyTasksError = err.error?.detail || 'Erreur lors de la création';
        this.storyTasksCreating = false;
      },
    });
  }

  toggleAllStoryTasks(checked: boolean): void {
    this.storyTasksItems.forEach(t => t.selected = checked);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  toggleAllParents(checked: boolean): void {
    this.parentsItems.forEach(i => i.selected = checked);
  }

  toggleAllStories(checked: boolean): void {
    this.storiesItems.forEach(i => i.selected = checked);
  }

  toggleAllHorsProd(checked: boolean): void {
    this.horsProdTasks.forEach(t => t.selected = checked);
  }

  sprintLabel(n: number): string {
    const labels: Record<number, string> = { 1: 'S1', 2: 'S2', 3: 'S3', 4: 'IP' };
    return labels[n] ?? `S${n}`;
  }

  trackByIndex(index: number): number { return index; }
}
