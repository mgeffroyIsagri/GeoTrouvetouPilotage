import { Component, OnInit } from '@angular/core';
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

@Component({
  selector: 'app-pi-planning',
  standalone: true,
  imports: [CommonModule, FormsModule, PlanningBlockComponent, WorkItemPanelComponent],
  templateUrl: './pi-planning.component.html',
  styleUrl: './pi-planning.component.scss',
})
export class PiPlanningComponent implements OnInit {
  readonly COL_WIDTH = 36;
  readonly ROW_HEIGHT = 52;
  readonly SPRINT_CONFIG = SPRINT_CONFIG;
  readonly CATEGORY_LABELS = BLOCK_CATEGORY_LABELS;

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
  addingLeave: { memberId: number; label: string } | null = null;

  constructor(private api: ApiService, private cal: CalendarService) {}

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

  // ── Team ─────────────────────────────────────────────

  loadTeamMembers(): void {
    this.api.listTeamMembers().subscribe((m) => (this.teamMembers = m));
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

  getStoryCapacity(memberId: number): number {
    const storyBlocks = this.getLayer2Blocks(memberId);
    return storyBlocks.reduce((sum, b) => sum + b.duration_days, 0);
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

  closePanel(): void {
    this.showPanel = false;
    this.selectedBlock = null;
  }

  onWorkItemAssigned(ev: { blockId: number; workItemId: number }): void {
    this.api.updateBlock(ev.blockId, { work_item_id: ev.workItemId }).subscribe((updated) => {
      const idx = this.blocks.findIndex((b) => b.id === ev.blockId);
      if (idx >= 0) this.blocks[idx] = updated;
    });
  }

  // ── Congés ────────────────────────────────────────────

  startAddLeave(memberId: number): void {
    this.addingLeave = { memberId, label: 'CP' };
  }

  confirmAddLeave(memberId: number, dayOffset: number): void {
    if (!this.activePI || !this.addingLeave) return;
    this.api.createLeave({
      pi_id: this.activePI.id,
      team_member_id: memberId,
      sprint_number: this.selectedSprint,
      day_offset: dayOffset,
      duration_days: 1.0,
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
