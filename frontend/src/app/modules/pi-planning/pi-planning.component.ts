import { Component, OnInit } from '@angular/core';
import { map } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { CalendarService, SPRINT_CONFIG } from '../../core/services/calendar.service';
import {
  PI, TeamMember, PlanningBlock, Leave, SprintIteration,
  BLOCK_CATEGORY_LABELS, BlockCategory,
} from '../../core/models';
import { PlanningBlockComponent, BlockMoveEvent, BlockResizeEvent } from './planning-block/planning-block.component';
import { WorkItemPanelComponent } from './work-item-panel/work-item-panel.component';

interface NewPIForm {
  name: string;
  start_date: string;
}

const STORY_PROFILES = new Set(['Dev', 'QA', 'PSM']);
const DEFAULT_VISIBLE_PROFILES = new Set(['Dev', 'QA', 'PSM']);
const ALL_PROFILES = ['Dev', 'QA', 'PSM', 'Squad Lead', 'Automate'];

@Component({
  selector: 'app-pi-planning',
  standalone: true,
  imports: [CommonModule, FormsModule, PlanningBlockComponent, WorkItemPanelComponent],
  templateUrl: './pi-planning.component.html',
  styleUrl: './pi-planning.component.scss',
})
export class PiPlanningComponent implements OnInit {
  readonly COL_WIDTH = 72;
  readonly ROW_HEIGHT = 52;
  readonly SPRINT_CONFIG = SPRINT_CONFIG;
  readonly CATEGORY_LABELS = BLOCK_CATEGORY_LABELS;
  readonly ALL_PROFILES = ALL_PROFILES;

  // PI
  piList: PI[] = [];
  activePI: PI | null = null;
  showPIForm = false;
  newPIForm: NewPIForm = { name: '', start_date: '' };
  piFormError = '';

  // Sprints
  iterations: SprintIteration[] = [];
  selectedSprint = 1;

  // Team
  teamMembers: TeamMember[] = [];
  visibleProfiles = new Set(DEFAULT_VISIBLE_PROFILES);

  // Blocs & congés
  blocks: PlanningBlock[] = [];
  leaves: Leave[] = [];

  // Jours ouvrés du sprint sélectionné
  workingDays: Date[] = [];
  weekGroups: Array<{ label: string; count: number }> = [];

  // UI
  generating = false;
  selectedBlock: PlanningBlock | null = null;
  showPanel = false;

  // Congé en cours de saisie
  addingLeave: { memberId: number; label: string; date: string; duration: number } | null = null;

  // Story en cours de saisie
  addingStory: { memberId: number; category: string; duration: number } | null = null;

  // Reset
  showResetMenu = false;
  resetModal: { scope: 'sprint' | 'pi'; leaves: boolean; stories: boolean; layer1: boolean } | null = null;

  constructor(private api: ApiService, readonly cal: CalendarService) {}

  ngOnInit(): void {
    this.loadPI();
    this.loadTeamMembers();
  }

  // ── PI ────────────────────────────────────────────────

  loadPI(): void {
    this.api.listPI().subscribe((list) => {
      this.piList = list;
      const active = list.find((p) => p.is_active) ?? list[0] ?? null;
      if (active) this.selectPI(active);
    });
  }

  selectPI(pi: PI): void {
    this.activePI = pi;
    this.selectedSprint = 1;
    this.api.getIterationsForPI(pi.id).subscribe((it) => {
      this.iterations = it;
      this.refreshWorkingDays();
    });
    this.loadBlocks();
    this.loadLeaves();
  }

  createPI(): void {
    this.piFormError = '';
    if (!this.newPIForm.name || !this.newPIForm.start_date) {
      this.piFormError = 'Nom et date de début requis.';
      return;
    }
    this.api.createPI({
      name: this.newPIForm.name,
      start_date: this.newPIForm.start_date,
    }).subscribe({
      next: (pi) => {
        this.showPIForm = false;
        this.newPIForm = { name: '', start_date: '' };
        this.api.activatePI(pi.id).subscribe(() => this.loadPI());
      },
      error: (err) => {
        this.piFormError = err.error?.detail ?? 'Erreur lors de la création du PI';
      },
    });
  }

  // ── Sprint ────────────────────────────────────────────

  selectSprint(sprint: number): void {
    this.selectedSprint = sprint;
    this.refreshWorkingDays();
    this.loadBlocks();
    this.loadLeaves();
  }

  get currentIteration(): SprintIteration | null {
    return this.iterations.find((it) => it.sprint_number === this.selectedSprint) ?? null;
  }

  get totalWorkingDays(): number {
    return SPRINT_CONFIG.find((s) => s.number === this.selectedSprint)?.workingDays ?? 15;
  }

  private refreshWorkingDays(): void {
    const it = this.currentIteration;
    if (!it) {
      this.workingDays = [];
      return;
    }
    const start = new Date(it.start_date);
    const weeks = SPRINT_CONFIG.find((s) => s.number === this.selectedSprint)?.weeks ?? 3;
    this.workingDays = this.cal.getWorkingDays(start, weeks);
    this.weekGroups = this.cal.getWeekGroups(this.workingDays);
  }

  // ── Team & filtres ─────────────────────────────────────

  loadTeamMembers(): void {
    this.api.listTeamMembers().subscribe((m) => (this.teamMembers = m));
  }

  get filteredMembers(): TeamMember[] {
    return this.teamMembers.filter((m) => this.visibleProfiles.has(m.profile));
  }

  toggleProfile(profile: string): void {
    if (this.visibleProfiles.has(profile)) {
      this.visibleProfiles.delete(profile);
    } else {
      this.visibleProfiles.add(profile);
    }
  }

  isProfileVisible(profile: string): boolean {
    return this.visibleProfiles.has(profile);
  }

  // ── Blocs ─────────────────────────────────────────────

  loadBlocks(): void {
    if (!this.activePI) return;
    this.api.getBlocksForSprint(this.activePI.id, this.selectedSprint).subscribe((b) => {
      this.blocks = b;
    });
  }

  loadLeaves(): void {
    if (!this.activePI) return;
    this.api.getLeavesForSprint(this.activePI.id, this.selectedSprint).subscribe((l) => {
      this.leaves = l;
    });
  }

  getLayer1Blocks(memberId: number): PlanningBlock[] {
    return this.blocks.filter((b) => b.team_member_id === memberId && b.layer === 1);
  }

  getLayer2Blocks(memberId: number): PlanningBlock[] {
    return this.blocks.filter((b) => b.team_member_id === memberId && b.layer === 2);
  }

  getLeavesForMember(memberId: number): Leave[] {
    return this.leaves.filter((l) => l.team_member_id === memberId);
  }

  getRemainingCapacity(memberId: number): number {
    const usedByBlocks = this.blocks
      .filter((b) => b.team_member_id === memberId)
      .reduce((sum, b) => sum + b.duration_days, 0);
    const usedByLeaves = this.leaves
      .filter((l) => l.team_member_id === memberId)
      .reduce((sum, l) => sum + l.duration_days, 0);
    return Math.max(0, this.totalWorkingDays - usedByBlocks - usedByLeaves);
  }

  getCapacityBreakdown(memberId: number): Array<{ label: string; days: number }> {
    const byCategory = new Map<string, number>();
    for (const b of this.blocks.filter((b) => b.team_member_id === memberId)) {
      byCategory.set(b.category, (byCategory.get(b.category) ?? 0) + b.duration_days);
    }
    const result = Array.from(byCategory.entries()).map(([cat, days]) => ({
      label: BLOCK_CATEGORY_LABELS[cat as BlockCategory] ?? cat,
      days,
    }));
    const leavesDays = this.leaves
      .filter((l) => l.team_member_id === memberId)
      .reduce((sum, l) => sum + l.duration_days, 0);
    if (leavesDays > 0) result.push({ label: 'Congés', days: leavesDays });
    return result;
  }

  private getAvailableGaps(memberId: number): Array<{ start: number; size: number }> {
    const intervals = [
      ...this.blocks.filter((b) => b.team_member_id === memberId)
        .map((b) => ({ start: b.day_offset, end: b.day_offset + b.duration_days })),
      ...this.leaves.filter((l) => l.team_member_id === memberId)
        .map((l) => ({ start: l.day_offset, end: l.day_offset + l.duration_days })),
    ].sort((a, b) => a.start - b.start);

    const merged: { start: number; end: number }[] = [];
    for (const iv of intervals) {
      if (merged.length && iv.start <= merged[merged.length - 1].end) {
        merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, iv.end);
      } else {
        merged.push({ ...iv });
      }
    }

    const gaps: Array<{ start: number; size: number }> = [];
    let cursor = 0;
    for (const iv of merged) {
      if (iv.start > cursor) gaps.push({ start: cursor, size: iv.start - cursor });
      cursor = Math.max(cursor, iv.end);
    }
    if (cursor < this.totalWorkingDays) gaps.push({ start: cursor, size: this.totalWorkingDays - cursor });
    return gaps;
  }

  canAddStory(member: TeamMember): boolean {
    return STORY_PROFILES.has(member.profile);
  }

  // ── Drag & resize ─────────────────────────────────────

  onBlockMoved(ev: BlockMoveEvent): void {
    if (ev.type === 'leave') {
      this.api.updateLeave(ev.id, { day_offset: ev.day_offset }).subscribe((updated) => {
        const idx = this.leaves.findIndex((l) => l.id === ev.id);
        if (idx >= 0) this.leaves[idx] = updated;
      });
    } else {
      this.api.updateBlock(ev.id, { day_offset: ev.day_offset }).subscribe((updated) => {
        const idx = this.blocks.findIndex((b) => b.id === ev.id);
        if (idx >= 0) this.blocks[idx] = updated;
      });
    }
  }


  onBlockResized(ev: BlockResizeEvent): void {
    this.api.updateBlock(ev.id, { duration_days: ev.duration_days }).subscribe((updated) => {
      const idx = this.blocks.findIndex((b) => b.id === ev.id);
      if (idx >= 0) this.blocks[idx] = updated;
    });
  }

  onBlockClicked(block: PlanningBlock): void {
    const cat = block.category as BlockCategory;
    if (cat === 'stories_dev' || cat === 'stories_qa') {
      this.selectedBlock = block;
      this.showPanel = true;
    }
  }

  onStoryBlockClicked(block: PlanningBlock): void {
    this.selectedBlock = block;
    this.showPanel = true;
  }

  onBlockDeleteRequested(block: PlanningBlock | Leave): void {
    const isLeave = !('category' in block);
    if (isLeave) {
      const label = (block as Leave).label ?? 'Congé';
      if (!confirm(`Supprimer le congé "${label}" ?`)) return;
      this.deleteLeave(block.id);
      return;
    }
    const pb = block as PlanningBlock;
    const catLabel = BLOCK_CATEGORY_LABELS[pb.category as BlockCategory] ?? pb.category;
    if (pb.group_id !== null) {
      const groupCount = this.blocks.filter((b) => b.group_id === pb.group_id).length;
      if (!confirm(`Cette story est composée de ${groupCount} brique(s). Supprimer toutes les briques associées ?`)) return;
    } else {
      if (!confirm(`Supprimer la brique "${catLabel}" ?`)) return;
    }
    this.deleteBlock(pb);
  }

  deleteBlock(block: PlanningBlock): void {
    this.api.deleteBlock(block.id).subscribe(() => {
      if (block.group_id !== null) {
        this.blocks = this.blocks.filter((b) => b.group_id !== block.group_id);
      } else {
        this.blocks = this.blocks.filter((b) => b.id !== block.id);
      }
    });
  }

  closePanel(): void {
    this.showPanel = false;
    this.selectedBlock = null;
  }

  onWorkItemAssigned(ev: { blockId: number; workItemId: number }): void {
    this.api.updateBlock(ev.blockId, { work_item_id: ev.workItemId }).subscribe((updated) => {
      if (updated.group_id !== null) {
        // Backend propagated work_item_id to all group members; update local state
        this.blocks = this.blocks.map((b) =>
          b.group_id === updated.group_id ? { ...b, work_item_id: ev.workItemId } : b
        );
      } else {
        const idx = this.blocks.findIndex((b) => b.id === ev.blockId);
        if (idx >= 0) this.blocks[idx] = updated;
      }
    });
  }

  // ── Congés ────────────────────────────────────────────

  startAddLeave(memberId: number): void {
    const firstDay = this.workingDays[0];
    const defaultDate = firstDay ? this.cal.workingDayToISO(firstDay) : '';
    this.addingLeave = { memberId, label: 'CP', date: defaultDate, duration: 1 };
  }

  confirmAddLeave(): void {
    if (!this.activePI || !this.addingLeave) return;
    const date = new Date(this.addingLeave.date + 'T12:00:00');
    const offset = this.cal.dateToOffset(date, this.workingDays);
    if (offset < 0) {
      alert('Cette date ne correspond pas à un jour ouvré du sprint.');
      return;
    }
    this.api.createLeave({
      pi_id: this.activePI.id,
      team_member_id: this.addingLeave.memberId,
      sprint_number: this.selectedSprint,
      day_offset: offset,
      duration_days: this.addingLeave.duration,
      label: this.addingLeave.label || 'CP',
    }).subscribe((l) => {
      this.leaves.push(l);
      this.addingLeave = null;
    });
  }

  deleteLeave(leaveId: number): void {
    this.api.deleteLeave(leaveId).subscribe(() => {
      this.leaves = this.leaves.filter((l) => l.id !== leaveId);
    });
  }

  // ── Stories manuelles ─────────────────────────────────

  startAddStory(member: TeamMember): void {
    const category = member.profile === 'QA' ? 'stories_qa' : 'stories_dev';
    this.addingStory = { memberId: member.id, category, duration: 0.25 };
  }

  confirmAddStory(): void {
    if (!this.activePI || !this.addingStory) return;
    const story = this.addingStory;
    const gaps = this.getAvailableGaps(story.memberId);
    const totalFreeInSprint = gaps.reduce((s, g) => s + g.size, 0);

    if (totalFreeInSprint <= 0) {
      alert('Aucune place disponible dans ce sprint.');
      this.addingStory = null;
      return;
    }

    const durationInSprint = Math.min(story.duration, totalFreeInSprint);
    const overflowDuration = Math.max(0, story.duration - durationInSprint);

    // Remplir les écarts de gauche à droite jusqu'à atteindre durationInSprint
    const blocksToCreate: Array<{ offset: number; duration: number }> = [];
    let remaining = durationInSprint;
    for (const gap of gaps) {
      if (remaining <= 0) break;
      const place = Math.min(remaining, gap.size);
      blocksToCreate.push({ offset: gap.start, duration: place });
      remaining -= place;
    }

    const nextSprint = this.selectedSprint + 1;
    const allBlockPayloads: Partial<PlanningBlock>[] = blocksToCreate.map((b) => ({
      pi_id: this.activePI!.id,
      team_member_id: story.memberId,
      sprint_number: this.selectedSprint,
      day_offset: b.offset,
      duration_days: b.duration,
      category: story.category as BlockCategory,
      layer: 2,
    }));
    if (overflowDuration > 0 && nextSprint <= this.SPRINT_CONFIG.length) {
      allBlockPayloads.push({
        pi_id: this.activePI!.id,
        team_member_id: story.memberId,
        sprint_number: nextSprint,
        day_offset: 0,
        duration_days: overflowDuration,
        category: story.category as BlockCategory,
        layer: 2,
      });
    }

    const create$ = allBlockPayloads.length === 1
      ? this.api.createBlock(allBlockPayloads[0]).pipe(map((b) => [b]))
      : this.api.createBlockGroup(allBlockPayloads);

    create$.subscribe({
      next: (createdBlocks) => {
        // Only add blocks from the current sprint to local state (other sprints not loaded)
        const sprintBlocks = createdBlocks.filter((b) => b.sprint_number === this.selectedSprint);
        this.blocks.push(...sprintBlocks);
        this.addingStory = null;
        if (overflowDuration > 0) {
          if (nextSprint <= this.SPRINT_CONFIG.length) {
            alert(`Story répartie : ${durationInSprint}j dans le Sprint ${this.selectedSprint}, ${overflowDuration}j dans le Sprint ${nextSprint}.`);
          } else {
            alert(`Story tronquée à ${durationInSprint}j (fin de PI atteinte).`);
          }
        }
      },
      error: (err) => alert(err.error?.detail ?? 'Erreur lors de l\'ajout de la story'),
    });
  }

  // ── Reset ─────────────────────────────────────────────

  openResetModal(scope: 'sprint' | 'pi'): void {
    this.resetModal = { scope, leaves: true, stories: true, layer1: true };
    this.showResetMenu = false;
  }

  confirmReset(): void {
    if (!this.activePI || !this.resetModal) return;
    const opts = { leaves: this.resetModal.leaves, stories: this.resetModal.stories, layer1: this.resetModal.layer1 };
    const obs = this.resetModal.scope === 'sprint'
      ? this.api.resetSprint(this.activePI.id, this.selectedSprint, opts)
      : this.api.resetPI(this.activePI.id, opts);
    obs.subscribe(() => {
      this.loadBlocks();
      this.loadLeaves();
      this.resetModal = null;
    });
  }

  // ── Génération ────────────────────────────────────────

  generatePlanning(): void {
    if (!this.activePI) return;
    this.generating = true;
    this.api.generatePlanning(this.activePI.id).subscribe({
      next: () => {
        this.generating = false;
        this.loadBlocks();
      },
      error: (err) => {
        this.generating = false;
        alert(err.error?.detail ?? 'Erreur lors de la génération');
      },
    });
  }

  // ── Helpers template ──────────────────────────────────

  formatDay(d: Date): { shortDay: string; dayNum: string } {
    return this.cal.formatDayHeader(d);
  }

  isWeekStart(d: Date): boolean {
    return this.cal.isWeekStart(d);
  }

  get gridWidth(): number {
    return this.workingDays.length * this.COL_WIDTH;
  }
}
