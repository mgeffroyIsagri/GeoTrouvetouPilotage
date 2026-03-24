import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { PI, TeamMember, WorkItem, PBRSession, PBRItem, PBRVote, AppSetting } from '../../core/models';

interface VoteEdit {
  dor_compliant: boolean | null;
  comment: string | null;
  story_points: number | null;
  charge_dev_days: number | null;
  charge_qa_days: number | null;
}

@Component({
  selector: 'app-pbr',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './pbr.component.html',
  styleUrl: './pbr.component.scss',
})
export class PbrComponent implements OnInit {
  // Data
  piList: PI[] = [];
  sessions: PBRSession[] = [];
  teamMembers: TeamMember[] = [];
  workItemsMap = new Map<number, WorkItem>(); // AZDO ID → WorkItem
  settings: AppSetting[] = [];

  // Session sélectionnée
  selectedSession: PBRSession | null = null;
  items: PBRItem[] = [];
  votes: PBRVote[] = [];

  // Filtre PI
  filterPiId: number | null = null;

  // Création de session
  showCreateForm = false;
  newSession = { name: '', pi_id: null as number | null, date: '' };
  createError = '';

  // Ajout d'un sujet
  addingItemId = '';
  addItemError = '';

  // Édition des votes : clé = `${workItemId}_${teamMemberId}`
  editMap = new Map<string, VoteEdit>();

  // Plan d'action
  actionPlanMap = new Map<number, string>(); // item.id → texte

  // États UI
  analyzingItemId: number | null = null;
  syncingItemId: number | null = null;
  expandedItems = new Set<number>();

  // Copie de session
  showCopyForm = false;
  copySourceSession: PBRSession | null = null;
  copySession = { name: '', pi_id: null as number | null, date: '' };
  copyError = '';

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    forkJoin({
      pi: this.api.listPI(),
      members: this.api.listTeamMembers(),
      sessions: this.api.listPBRSessions(),
      settings: this.api.getSettings(),
    }).subscribe(({ pi, members, sessions, settings }) => {
      this.piList = pi;
      this.teamMembers = members;
      this.sessions = sessions;
      this.settings = settings;
      const active = sessions.find((s) => s.is_active);
      if (active) this.selectSession(active);
    });
  }

  // ── AZDO URL ──────────────────────────────────────────────

  azdoUrl(workItemId: number): string | null {
    const org = this.settings.find((s) => s.key === 'azdo_organization')?.value;
    const project = this.settings.find((s) => s.key === 'azdo_project')?.value;
    if (!org || !project) return null;
    const cleanOrg = org.replace(/^https?:\/\/dev\.azure\.com\//, '').replace(/\/$/, '');
    return `https://dev.azure.com/${cleanOrg}/${encodeURIComponent(project)}/_workitems/edit/${workItemId}`;
  }

  // ── Filtrage ─────────────────────────────────────────────

  get filteredSessions(): PBRSession[] {
    if (this.filterPiId === null) return this.sessions;
    return this.sessions.filter((s) => s.pi_id === this.filterPiId);
  }

  piName(piId: number | null): string {
    if (piId === null) return 'Sans PI';
    return this.piList.find((p) => p.id === piId)?.name ?? `PI #${piId}`;
  }

  // ── Sessions ─────────────────────────────────────────────

  selectSession(session: PBRSession): void {
    this.selectedSession = session;
    this.items = [];
    this.votes = [];
    this.editMap.clear();
    this.actionPlanMap.clear();
    this.expandedItems.clear();

    forkJoin({
      items: this.api.getPBRItems(session.id),
      votes: this.api.getVotes(session.id),
    }).subscribe(({ items, votes }) => {
      this.items = items;
      this.votes = votes;
      this.initActionPlanMap();
      this.initEditMap();
      this.loadWorkItems();
    });
  }

  activateSession(session: PBRSession, event: MouseEvent): void {
    event.stopPropagation();
    const action = session.is_active
      ? this.api.deactivatePBRSession(session.id)
      : this.api.activatePBRSession(session.id);
    action.subscribe((updated) => {
      this.sessions = this.sessions.map((s) => ({
        ...s,
        is_active: s.id === session.id ? updated.is_active : (session.is_active ? false : s.is_active),
      }));
      if (this.selectedSession?.id === session.id) {
        this.selectedSession = updated;
      }
    });
  }

  deleteSession(session: PBRSession, event: MouseEvent): void {
    event.stopPropagation();
    if (!confirm(`Supprimer la session "${session.name}" et tous ses votes ?`)) return;
    this.api.deletePBRSession(session.id).subscribe(() => {
      this.sessions = this.sessions.filter((s) => s.id !== session.id);
      if (this.selectedSession?.id === session.id) {
        this.selectedSession = null;
        this.items = [];
        this.votes = [];
      }
    });
  }

  openCreateForm(): void {
    const today = new Date().toISOString().slice(0, 16);
    this.newSession = { name: '', pi_id: this.filterPiId, date: today };
    this.createError = '';
    this.showCreateForm = true;
  }

  submitCreateSession(): void {
    this.createError = '';
    if (!this.newSession.name.trim()) { this.createError = 'Le nom est requis.'; return; }
    if (!this.newSession.date) { this.createError = 'La date est requise.'; return; }
    this.api.createPBRSession({
      name: this.newSession.name.trim(),
      date: new Date(this.newSession.date).toISOString(),
      pi_id: this.newSession.pi_id,
    }).subscribe({
      next: (s) => {
        this.sessions = [s, ...this.sessions];
        this.showCreateForm = false;
        this.selectSession(s);
      },
      error: (err) => { this.createError = err.error?.detail ?? 'Erreur lors de la création'; },
    });
  }

  // ── Items ─────────────────────────────────────────────────

  private loadWorkItems(): void {
    const ids = this.items.map((i) => i.work_item_id);
    if (!ids.length) return;
    ids.forEach((id) => {
      if (!this.workItemsMap.has(id)) {
        this.api.getWorkItemById(id).subscribe((wi) => this.workItemsMap.set(id, wi));
      }
    });
  }

  private fetchWorkItem(id: number): void {
    if (!this.workItemsMap.has(id)) {
      this.api.getWorkItemById(id).subscribe((wi) => this.workItemsMap.set(id, wi));
    }
  }

  getWorkItem(workItemId: number): WorkItem | null {
    return this.workItemsMap.get(workItemId) ?? null;
  }

  toggleItem(item: PBRItem): void {
    if (this.expandedItems.has(item.id)) {
      this.expandedItems.delete(item.id);
    } else {
      this.expandedItems.add(item.id);
    }
  }

  addItem(): void {
    this.addItemError = '';
    const id = parseInt(this.addingItemId, 10);
    if (isNaN(id)) { this.addItemError = 'ID invalide.'; return; }
    if (!this.selectedSession) return;
    this.api.addPBRItem(this.selectedSession.id, id).subscribe({
      next: (newItems) => {
        this.items.push(...newItems);
        this.addingItemId = '';
        // Expand only the first (parent) item
        if (newItems.length > 0) this.expandedItems.add(newItems[0].id);
        // Load all work items
        newItems.forEach((item) => this.fetchWorkItem(item.work_item_id));
      },
      error: (err) => { this.addItemError = err.error?.detail ?? 'Erreur lors de l\'ajout'; },
    });
  }

  removeItem(item: PBRItem): void {
    if (!confirm(`Retirer le work item #${item.work_item_id} de la session (et ses votes) ?`)) return;
    this.api.removePBRItem(item.id).subscribe(() => {
      this.items = this.items.filter((i) => i.id !== item.id);
      this.votes = this.votes.filter((v) => v.work_item_id !== item.work_item_id);
      this.expandedItems.delete(item.id);
    });
  }

  // ── Copie de session ───────────────────────────────────────

  openCopyForm(session: PBRSession, event: MouseEvent): void {
    event.stopPropagation();
    this.copySourceSession = session;
    const today = new Date().toISOString().slice(0, 16);
    this.copySession = { name: `Copie de ${session.name}`, pi_id: session.pi_id, date: today };
    this.copyError = '';
    this.showCopyForm = true;
  }

  submitCopySession(): void {
    this.copyError = '';
    if (!this.copySession.name.trim()) { this.copyError = 'Le nom est requis.'; return; }
    if (!this.copySession.date) { this.copyError = 'La date est requise.'; return; }
    if (!this.copySourceSession) return;
    this.api.copyPBRSession(this.copySourceSession.id, {
      name: this.copySession.name.trim(),
      date: new Date(this.copySession.date).toISOString(),
      pi_id: this.copySession.pi_id,
    }).subscribe({
      next: (s) => {
        this.sessions = [s, ...this.sessions];
        this.showCopyForm = false;
        this.copySourceSession = null;
        this.selectSession(s);
      },
      error: (err) => { this.copyError = err.error?.detail ?? 'Erreur lors de la copie'; },
    });
  }

  // ── Synchronisation enfants ────────────────────────────────

  syncItem(item: PBRItem, event: MouseEvent): void {
    event.stopPropagation();
    this.syncingItemId = item.id;
    this.api.syncPBRItem(item.id).subscribe({
      next: (newItems) => {
        this.items.push(...newItems);
        newItems.forEach((i) => this.fetchWorkItem(i.work_item_id));
        this.syncingItemId = null;
        if (newItems.length === 0) alert('Aucune nouvelle story enfant trouvée.');
      },
      error: (err) => {
        alert(err.error?.detail ?? 'Erreur lors de la synchronisation');
        this.syncingItemId = null;
      },
    });
  }

  // ── Déprioritisation ──────────────────────────────────────

  toggleDeprioritized(item: PBRItem, event: MouseEvent): void {
    event.stopPropagation();
    this.api.updatePBRItem(item.id, { is_deprioritized: !item.is_deprioritized }).subscribe((updated) => {
      this.items = this.items.map((i) => i.id === item.id ? updated : i);
    });
  }

  isDeprioritized(workItemId: number): boolean {
    // Un item est "déprioritisé" si lui-même ou son parent dans la session l'est
    const item = this.items.find((i) => i.work_item_id === workItemId);
    if (item?.is_deprioritized) return true;
    const wi = this.workItemsMap.get(workItemId);
    if (wi?.parent_id) {
      const parentItem = this.items.find((i) => i.work_item_id === wi.parent_id);
      if (parentItem?.is_deprioritized) return true;
    }
    return false;
  }

  // ── Responsable refinement ────────────────────────────────

  saveRefinementOwner(item: PBRItem, ownerId: number | null): void {
    this.api.updatePBRItem(item.id, { refinement_owner_id: ownerId }).subscribe((updated) => {
      this.items = this.items.map((i) => i.id === item.id ? updated : i);
    });
  }

  get refinementMembers(): TeamMember[] {
    return this.teamMembers.filter((m) => ['Dev', 'QA', 'PSM'].includes(m.profile) && m.is_active);
  }

  // ── Analyse IA ────────────────────────────────────────────

  analyzeItem(item: PBRItem): void {
    this.analyzingItemId = item.id;
    this.api.analyzePBRItem(item.id).subscribe({
      next: (updated) => {
        this.items = this.items.map((i) => i.id === item.id ? updated : i);
        this.analyzingItemId = null;
      },
      error: (err) => {
        alert(err.error?.detail ?? 'Erreur lors de l\'analyse IA');
        this.analyzingItemId = null;
      },
    });
  }

  // ── Votes ─────────────────────────────────────────────────

  private voteKey(workItemId: number, memberId: number): string {
    return `${workItemId}_${memberId}`;
  }

  private initEditMap(): void {
    for (const v of this.votes) {
      const key = this.voteKey(v.work_item_id, v.team_member_id);
      this.editMap.set(key, {
        dor_compliant: v.dor_compliant,
        comment: v.comment,
        story_points: v.story_points,
        charge_dev_days: v.charge_dev_days,
        charge_qa_days: v.charge_qa_days,
      });
    }
  }

  getEdit(workItemId: number, memberId: number): VoteEdit {
    const key = this.voteKey(workItemId, memberId);
    if (!this.editMap.has(key)) {
      this.editMap.set(key, { dor_compliant: null, comment: null, story_points: null, charge_dev_days: null, charge_qa_days: null });
    }
    return this.editMap.get(key)!;
  }

  getVote(workItemId: number, memberId: number): PBRVote | null {
    return this.votes.find((v) => v.work_item_id === workItemId && v.team_member_id === memberId) ?? null;
  }

  saveVote(workItemId: number, memberId: number): void {
    if (!this.selectedSession) return;
    const edit = this.getEdit(workItemId, memberId);
    const existing = this.getVote(workItemId, memberId);

    if (existing) {
      this.api.updateVote(existing.id, edit).subscribe((updated) => {
        this.votes = this.votes.map((v) => v.id === existing.id ? updated : v);
      });
    } else {
      this.api.createVote(this.selectedSession!.id, {
        team_member_id: memberId,
        work_item_id: workItemId,
        ...edit,
      }).subscribe((created) => {
        this.votes.push(created);
      });
    }
  }

  getItemVotes(workItemId: number): PBRVote[] {
    return this.votes.filter((v) => v.work_item_id === workItemId);
  }

  /** Retourne { yes, no, total } depuis l'editMap (état UI courant, inclut les non-sauvegardés). */
  dorStats(workItemId: number): { yes: number; no: number; total: number } | null {
    const members = this.sessionMembers;
    const voted = members.filter((m) => {
      const edit = this.editMap.get(this.voteKey(workItemId, m.id));
      return edit?.dor_compliant !== null && edit?.dor_compliant !== undefined;
    });
    if (!voted.length) return null;
    const yes = voted.filter((m) => {
      const edit = this.editMap.get(this.voteKey(workItemId, m.id));
      return edit?.dor_compliant === true;
    }).length;
    return { yes, no: voted.length - yes, total: voted.length };
  }

  get dorMembers(): TeamMember[] {
    return this.teamMembers.filter((m) => ['Dev', 'QA', 'PSM'].includes(m.profile) && m.is_active);
  }

  /** Membres participant aux votes de la session courante (dorMembers moins les exclus). */
  get sessionMembers(): TeamMember[] {
    const excluded = new Set(this.selectedSession?.excluded_member_ids ?? []);
    return this.dorMembers.filter((m) => !excluded.has(m.id));
  }

  toggleMemberExclusion(member: TeamMember): void {
    if (!this.selectedSession) return;
    const excluded = new Set(this.selectedSession.excluded_member_ids ?? []);
    if (excluded.has(member.id)) {
      excluded.delete(member.id);
    } else {
      excluded.add(member.id);
    }
    const ids = [...excluded];
    this.api.updateExcludedMembers(this.selectedSession.id, ids).subscribe((updated) => {
      this.sessions = this.sessions.map((s) => s.id === updated.id ? updated : s);
      this.selectedSession = updated;
    });
  }

  isMemberExcluded(memberId: number): boolean {
    return this.selectedSession?.excluded_member_ids?.includes(memberId) ?? false;
  }

  memberName(memberId: number): string {
    return this.teamMembers.find((m) => m.id === memberId)?.display_name ?? `#${memberId}`;
  }

  // ── Plan d'action ─────────────────────────────────────────

  private initActionPlanMap(): void {
    for (const item of this.items) {
      if (item.action_plan) this.actionPlanMap.set(item.id, item.action_plan);
    }
  }

  getActionPlan(item: PBRItem): string {
    return this.actionPlanMap.get(item.id) ?? '';
  }

  saveActionPlan(item: PBRItem): void {
    const plan = this.actionPlanMap.get(item.id) ?? null;
    this.api.updatePBRItem(item.id, { action_plan: plan }).subscribe((updated) => {
      this.items = this.items.map((i) => i.id === item.id ? updated : i);
    });
  }

  isNonDor(workItemId: number): boolean {
    const stats = this.dorStats(workItemId);
    return stats !== null && stats.no > 0;
  }

  // ── Groupement parent / enfants ───────────────────────────

  get groupedItems(): { item: PBRItem; depth: number }[] {
    const sessionIds = new Set(this.items.map((i) => i.work_item_id));
    const result: { item: PBRItem; depth: number }[] = [];

    // Parents = items dont le parent n'est pas dans la session
    const parents = this.items.filter((i) => {
      const wi = this.workItemsMap.get(i.work_item_id);
      return !wi?.parent_id || !sessionIds.has(wi.parent_id);
    });

    for (const parent of parents) {
      result.push({ item: parent, depth: 0 });
      const children = this.items.filter((i) => {
        const wi = this.workItemsMap.get(i.work_item_id);
        return wi?.parent_id === parent.work_item_id;
      });
      for (const child of children) {
        result.push({ item: child, depth: 1 });
      }
    }

    // Orphelins non encore classés (workItemsMap pas encore chargée)
    const placed = new Set(result.map((r) => r.item.id));
    for (const item of this.items) {
      if (!placed.has(item.id)) result.push({ item, depth: 0 });
    }

    return result;
  }

  isLastChildOfParent(index: number): boolean {
    const list = this.groupedItems;
    if (list[index]?.depth !== 1) return false;
    return !list[index + 1] || list[index + 1].depth === 0;
  }

  // ── Helpers template ──────────────────────────────────────

  readonly PARENT_TYPES = new Set(['Feature', 'Enabler']);

  isParentType(workItemId: number): boolean {
    const wi = this.workItemsMap.get(workItemId);
    return wi ? this.PARENT_TYPES.has(wi.type) : false;
  }

  readonly DOR_RANGE = [1, 2, 3, 4, 5];

  trackById(_: number, item: { id: number }): number { return item.id; }
  trackByMemberId(_: number, m: TeamMember): number { return m.id; }

  // ── Synthèse session ──────────────────────────────────────

  get sessionStats(): {
    total: number;
    parents: number;
    stories: number;
    dorOk: number;
    dorTotal: number;
    analyzed: number;
    deprio: number;
    ownersAssigned: number;
    ownersTotal: number;
  } | null {
    if (!this.selectedSession || !this.items.length) return null;

    const parents = this.items.filter((i) => this.isParentType(i.work_item_id));
    const stories = this.items.filter((i) => !this.isParentType(i.work_item_id));

    const dorOk = stories.filter((i) => {
      const stats = this.dorStats(i.work_item_id);
      return stats !== null && stats.no === 0 && stats.yes > 0 && stats.yes === stats.total;
    }).length;

    const dorVoted = stories.filter((i) => this.dorStats(i.work_item_id) !== null).length;

    return {
      total: this.items.length,
      parents: parents.length,
      stories: stories.length,
      dorOk,
      dorTotal: dorVoted,
      analyzed: this.items.filter((i) => i.ia_dor_note !== null).length,
      deprio: this.items.filter((i) => i.is_deprioritized).length,
      ownersAssigned: parents.filter((i) => i.refinement_owner_id !== null).length,
      ownersTotal: parents.length,
    };
  }
}
