import { Component, OnInit, OnDestroy, AfterViewInit, HostListener, ViewChild, ElementRef } from '@angular/core';
import { of, forkJoin, map } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { CalendarService, SPRINT_CONFIG } from '../../core/services/calendar.service';
import {
  PI, TeamMember, PlanningBlock, Leave, SprintIteration, WorkItem,
  BLOCK_CATEGORY_LABELS, BlockCategory,
} from '../../core/models';
import { PlanningBlockComponent, BlockMoveEvent, BlockResizeEvent } from './planning-block/planning-block.component';
import { WorkItemPanelComponent } from './work-item-panel/work-item-panel.component';
import { AdminPanelComponent } from './admin-panel/admin-panel.component';

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
  imports: [CommonModule, FormsModule, PlanningBlockComponent, WorkItemPanelComponent, AdminPanelComponent],
  templateUrl: './pi-planning.component.html',
  styleUrl: './pi-planning.component.scss',
})
export class PiPlanningComponent implements OnInit, AfterViewInit, OnDestroy {
  COL_WIDTH = 72;
  readonly MEMBER_COL_WIDTH = 180;
  readonly MIN_COL_WIDTH = 34;
  readonly ROW_HEIGHT = 52;

  @ViewChild('calendarZone', { static: false }) calendarZoneRef!: ElementRef<HTMLElement>;
  private resizeObserver!: ResizeObserver;

  get compactCols(): boolean { return this.COL_WIDTH < 52; }
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

  // Cache des work items chargés (pour tooltips)
  workItemsMap = new Map<number, WorkItem>();

  // Panneau détail collaborateur
  detailMemberId: number | null = null;
  private azdoOrg = '';
  private azdoProject = '';

  // ── Tooltip capacité ──────────────────────────────────
  // Position fixe (viewport) pour éviter le clipping par overflow:auto du scroll container.

  capaTooltip: { memberId: number; top: number; left: number } | null = null;
  private hideTooltipTimer: ReturnType<typeof setTimeout> | null = null;

  /** Affiche le tooltip de capacité ancré sous l'élément déclencheur. */
  showCapaTooltip(memberId: number, event: MouseEvent): void {
    if (this.hideTooltipTimer) { clearTimeout(this.hideTooltipTimer); this.hideTooltipTimer = null; }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.capaTooltip = { memberId, top: rect.bottom + 4, left: rect.left };
  }

  /** Lance un délai de 80 ms avant de masquer le tooltip (permet le survol du tooltip lui-même). */
  hideCapaTooltip(): void {
    this.hideTooltipTimer = setTimeout(() => { this.capaTooltip = null; }, 80);
  }

  /** Annule le timer de masquage quand la souris entre dans le tooltip. */
  keepCapaTooltip(): void {
    if (this.hideTooltipTimer) { clearTimeout(this.hideTooltipTimer); this.hideTooltipTimer = null; }
  }

  // ── Impression ────────────────────────────────────────

  printModal: { sprint: number; memberIds: number[]; generating: boolean } | null = null;

  /** Ouvre la modale d'impression pré-remplie avec le sprint courant et tous les membres visibles. */
  openPrintModal(): void {
    this.printModal = {
      sprint: this.selectedSprint,
      memberIds: this.filteredMembers.map(m => m.id),
      generating: false,
    };
  }

  isPrintMemberSelected(id: number): boolean {
    return this.printModal?.memberIds.includes(id) ?? false;
  }

  togglePrintMember(id: number): void {
    if (!this.printModal) return;
    this.printModal.memberIds = this.isPrintMemberSelected(id)
      ? this.printModal.memberIds.filter(x => x !== id)
      : [...this.printModal.memberIds, id];
  }

  selectAllPrintMembers(): void {
    if (!this.printModal) return;
    this.printModal.memberIds = this.teamMembers.map(m => m.id);
  }

  clearAllPrintMembers(): void {
    if (!this.printModal) return;
    this.printModal.memberIds = [];
  }

  /**
   * Génère le rapport d'impression HTML pour le sprint et les membres sélectionnés,
   * puis ouvre la boîte de dialogue d'impression native du navigateur.
   */
  generatePrint(): void {
    if (!this.printModal || !this.activePI) return;
    const { sprint, memberIds } = this.printModal;
    this.printModal.generating = true;

    forkJoin({
      blocks: this.api.getBlocksForSprint(this.activePI.id, sprint),
      leaves: this.api.getLeavesForSprint(this.activePI.id, sprint),
    }).subscribe(({ blocks, leaves }) => {
      const ids = [...new Set(blocks.map(b => b.work_item_id).filter((id): id is number => id != null))];
      const wi$ = ids.length ? this.api.getWorkItems({ ids }) : of([]);
      wi$.subscribe(wis => {
        const wiMap = new Map<number, WorkItem>([
          ...this.workItemsMap.entries(),
          ...wis.map(w => [w.id, w] as [number, WorkItem]),
        ]);
        const members = this.teamMembers.filter(m => memberIds.includes(m.id));
        const it = this.iterations.find(i => i.sprint_number === sprint);
        const cfg = SPRINT_CONFIG.find(s => s.number === sprint);
        if (it && cfg) {
          const wd = this.cal.getWorkingDays(new Date(it.start_date), cfg.weeks);
          const html = this.buildPrintHtml(sprint, cfg.workingDays, wd, blocks, leaves, wiMap, members);
          const win = window.open('', '_blank');
          if (win) { win.document.write(html); win.document.close(); setTimeout(() => win.print(), 500); }
        }
        this.printModal = null;
      });
    });
  }

  private escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  private buildPrintHtml(
    sprint: number, totalDays: number, workingDays: Date[],
    blocks: PlanningBlock[], leaves: Leave[],
    wiMap: Map<number, WorkItem>, members: TeamMember[],
  ): string {
    const piName = this.activePI?.name ?? '';
    const today = new Date().toLocaleDateString('fr-FR');

    const fmt = (offset: number): string => {
      const idx = Math.max(0, Math.min(Math.floor(offset), workingDays.length - 1));
      const d = workingDays[idx];
      return d ? d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' }) : '—';
    };
    const endOff = (offset: number, dur: number): number =>
      Math.max(0, Math.min(Math.floor(offset + dur - 0.5), workingDays.length - 1));

    const CAT_COLORS: Record<string, string> = {
      stories_dev: '#4285f4', stories_qa: '#34a853', bugs_maintenance: '#ea4335',
      imprevus: '#ff6d00', agility: '#9c27b0', reunions: '#795548',
      psm: '#00acc1', montee_competence: '#ff8f00', conges: '#bdbdbd',
    };
    const PROFILE_STYLES: Record<string, string> = {
      'Dev': 'background:#e8f0fe;color:#1a73e8', 'QA': 'background:#e6f4ea;color:#1e8e3e',
      'PSM': 'background:#fce8b2;color:#f09300', 'Squad Lead': 'background:#f3e8fd;color:#9334e6',
      'Automate': 'background:#e8eaed;color:#5f6368',
    };
    const dot = (cat: string) =>
      `<span style="display:inline-block;width:9px;height:9px;background:${CAT_COLORS[cat] ?? '#999'};border-radius:2px;margin-right:5px;vertical-align:middle"></span>`;
    const td = (s: string, extra = '') => `<td style="padding:4px 8px;border:1px solid #ddd;vertical-align:middle;${extra}">${s}</td>`;
    const th = (s: string, extra = '') => `<th style="padding:4px 8px;border:1px solid #ddd;background:#f1f3f4;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.4px;${extra}">${s}</th>`;

    let body = '';
    for (const m of members) {
      const mBlocks = blocks.filter(b => b.team_member_id === m.id).sort((a, b) => a.day_offset - b.day_offset);
      const mLeaves = leaves.filter(l => l.team_member_id === m.id).sort((a, b) => a.day_offset - b.day_offset);

      const byCat = new Map<string, number>();
      for (const b of mBlocks) byCat.set(b.category, (byCat.get(b.category) ?? 0) + b.duration_days);
      const leaveTotal = mLeaves.reduce((s, l) => s + l.duration_days, 0);
      const usedTotal = [...byCat.values()].reduce((s, v) => s + v, 0) + leaveTotal;
      const remaining = Math.max(0, totalDays - usedTotal);

      let capaRows = '';
      for (const [cat, days] of byCat) {
        capaRows += `<tr>${td(dot(cat) + (BLOCK_CATEGORY_LABELS[cat as BlockCategory] ?? cat))}${td(days + 'j', 'text-align:right;font-weight:600')}</tr>`;
      }
      if (leaveTotal > 0) capaRows += `<tr>${td(dot('conges') + 'Congés')}${td(leaveTotal + 'j', 'text-align:right;font-weight:600')}</tr>`;
      capaRows += `<tr style="border-top:2px solid #aaa">${td('<strong>Restant</strong>')}${td('<strong>' + remaining + 'j / ' + totalDays + 'j</strong>', 'text-align:right')}</tr>`;

      type E = { so: number; start: string; end: string; label: string; dur: number; cat: string; wiId: number | null; wiTitle: string | null; comment: string | null };
      const entries: E[] = [];
      for (const b of mBlocks) {
        const wi = b.work_item_id ? (wiMap.get(b.work_item_id) ?? null) : null;
        entries.push({ so: b.day_offset, start: fmt(b.day_offset), end: fmt(endOff(b.day_offset, b.duration_days)), label: BLOCK_CATEGORY_LABELS[b.category as BlockCategory] ?? b.category, dur: b.duration_days, cat: b.category, wiId: b.work_item_id ?? null, wiTitle: wi?.title ?? null, comment: b.comment ?? null });
      }
      for (const l of mLeaves) {
        entries.push({ so: l.day_offset, start: fmt(l.day_offset), end: fmt(endOff(l.day_offset, l.duration_days)), label: `Congé — ${l.label ?? 'CP'}`, dur: l.duration_days, cat: 'conges', wiId: null, wiTitle: null, comment: null });
      }
      entries.sort((a, b) => a.so - b.so);

      let detailRows = '';
      for (const e of entries) {
        const period = e.start === e.end ? e.start : `${e.start} → ${e.end}`;
        const url = e.wiId ? this.buildAzdoUrl(e.wiId) : '';
        const wiCell = e.wiId ? (url ? `<a href="${url}" style="color:#1a73e8;text-decoration:none">#${e.wiId}${e.wiTitle ? ' — ' + this.escHtml(e.wiTitle) : ''} ↗</a>` : `#${e.wiId}${e.wiTitle ? ' — ' + this.escHtml(e.wiTitle) : ''}`) : '';
        detailRows += `<tr>${td(period, 'white-space:nowrap;font-size:10px')}${td(dot(e.cat) + this.escHtml(e.label))}${td(e.dur + 'j', 'text-align:right;font-weight:600;white-space:nowrap')}${td(wiCell, 'max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}${td(this.escHtml(e.comment ?? ''), 'color:#888;font-style:italic;max-width:150px')}</tr>`;
      }

      body += `
      <div style="margin-bottom:28px;page-break-inside:avoid">
        <div style="display:flex;align-items:center;gap:8px;background:#e8eaed;padding:8px 12px;border-radius:6px;margin-bottom:10px;border-left:4px solid #4285f4">
          <span style="font-weight:700;font-size:14px">${this.escHtml(m.display_name)}</span>
          <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:3px;${PROFILE_STYLES[m.profile] ?? ''}">${m.profile}</span>
          <span style="margin-left:auto;font-size:11px;color:#555">${remaining}j restant / ${totalDays}j</span>
        </div>
        <div style="display:flex;gap:16px;align-items:flex-start">
          <table style="border-collapse:collapse;min-width:190px;font-size:11px">
            <thead><tr>${th('Catégorie')}${th('Jours', 'text-align:right')}</tr></thead>
            <tbody>${capaRows}</tbody>
          </table>
          <table style="border-collapse:collapse;width:100%;font-size:11px">
            <thead><tr>${th('Période')}${th('Activité')}${th('Durée', 'text-align:right')}${th('Work Item')}${th('Commentaire')}</tr></thead>
            <tbody>${detailRows}</tbody>
          </table>
        </div>
      </div>`;
    }

    return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<title>${this.escHtml(piName)} — Sprint ${sprint}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#222;padding:20px}h1{font-size:20px;font-weight:700;margin-bottom:4px}@media print{body{padding:0}@page{margin:12mm;size:A4 landscape}}</style>
</head><body>
<h1>${this.escHtml(piName)} — Sprint ${sprint}</h1>
<p style="font-size:12px;color:#666;margin-bottom:24px;padding-bottom:8px;border-bottom:1px solid #ddd">Imprimé le ${today} &nbsp;·&nbsp; ${members.length} collaborateur(s) &nbsp;·&nbsp; ${totalDays} jours ouvrés</p>
${body}
</body></html>`;
  }

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
  addingStory: { memberId: number; category: string; duration: number; workItemId: number | null } | null = null;

  // Polling auto-refresh (3s) — synchronisation légère multi-utilisateurs
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private isInteracting = false;

  // Reset
  showResetMenu = false;
  resetModal: { scope: 'sprint' | 'pi'; leaves: boolean; stories: boolean; layer1: boolean; memberId: number | null } | null = null;

  // Generate
  showGenerateMenu = false;
  generateModal: { scope: 'sprint' | 'pi'; memberId: number | null } | null = null;

  // Lock / Admin
  /** Indique si le panel admin (passage de PI) est affiché. */
  showAdminPanel = false;

  constructor(private api: ApiService, readonly cal: CalendarService) {}

  // ── Cycle de vie ──────────────────────────────────────

  ngOnInit(): void {
    this.loadPI();
    this.loadTeamMembers();
    this.refreshTimer = setInterval(() => this.silentRefresh(), 3_000);
    this.api.getSettings().subscribe(settings => {
      const org = settings.find(s => s.key === 'azdo_organization')?.value ?? '';
      this.azdoOrg = org.replace(/^https?:\/\/dev\.azure\.com\//, '').replace(/\/$/, '');
      this.azdoProject = settings.find(s => s.key === 'azdo_project')?.value ?? '';
    });
  }

  ngAfterViewInit(): void {
    // Observe le conteneur calendrier pour ajuster dynamiquement la largeur des colonnes
    this.resizeObserver = new ResizeObserver(() => this.updateColWidth());
    this.resizeObserver.observe(this.calendarZoneRef.nativeElement);
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.resizeObserver?.disconnect();
  }

  /**
   * Recalcule la largeur d'une colonne-jour en fonction de l'espace disponible.
   * Garantit l'absence de scroll horizontal en adaptant la grille à la fenêtre.
   * Respecte un minimum de MIN_COL_WIDTH pour conserver la lisibilité.
   */
  private updateColWidth(): void {
    const available = this.calendarZoneRef.nativeElement.clientWidth - this.MEMBER_COL_WIDTH;
    const days = this.totalWorkingDays || 15;
    this.COL_WIDTH = Math.max(this.MIN_COL_WIDTH, Math.floor(available / days));
  }

  @HostListener('document:mousedown', ['$event'])
  onDocMouseDown(e: MouseEvent): void {
    if ((e.target as Element).closest?.('.block')) this.isInteracting = true;
  }

  @HostListener('document:mouseup')
  onDocMouseUp(): void {
    setTimeout(() => { this.isInteracting = false; }, 150);
  }

  /**
   * Rafraîchissement silencieux (sans loader) déclenché toutes les 3s.
   * Ignoré pendant les interactions drag & drop pour éviter les sauts visuels.
   */
  private silentRefresh(): void {
    if (!this.activePI || this.isInteracting) return;
    this.api.getBlocksForSprint(this.activePI.id, this.selectedSprint).subscribe(b => {
      this.blocks = b;
      const ids = [...new Set(b.map(x => x.work_item_id).filter((id): id is number => id != null))];
      if (ids.length) {
        this.api.getWorkItems({ ids }).subscribe(wis => {
          for (const wi of wis) this.workItemsMap.set(wi.id, wi);
        });
      }
    });
    this.api.getLeavesForSprint(this.activePI.id, this.selectedSprint).subscribe(l => { this.leaves = l; });
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

  /** Verrouille le PI actif (planning lecture seule, panel admin visible). */
  lockPI(): void {
    if (!this.activePI) return;
    this.api.lockPI(this.activePI.id).subscribe(pi => {
      this.activePI = pi;
      const idx = this.piList.findIndex(p => p.id === pi.id);
      if (idx >= 0) this.piList[idx] = pi;
    });
  }

  /** Déverrouille le PI actif. */
  unlockPI(): void {
    if (!this.activePI) return;
    this.api.unlockPI(this.activePI.id).subscribe(pi => {
      this.activePI = pi;
      const idx = this.piList.findIndex(p => p.id === pi.id);
      if (idx >= 0) this.piList[idx] = pi;
      this.showAdminPanel = false;
    });
  }

  /** Retourne les blocs layer 2 sans work item associé pour le sprint courant. */
  get orphanStoryBlocks(): PlanningBlock[] {
    return this.blocks.filter(b => b.layer === 2 && b.work_item_id === null);
  }

  /** Retourne true si le membre a au moins un bloc story sans work item dans le sprint courant. */
  hasOrphanBlocks(memberId: number): boolean {
    return this.blocks.some(b => b.team_member_id === memberId && b.layer === 2 && b.work_item_id === null);
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
    // Recalculate column width for the new sprint's day count
    setTimeout(() => this.updateColWidth(), 0);
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
      const ids = [...new Set(b.map(x => x.work_item_id).filter((id): id is number => id != null))];
      if (ids.length) {
        this.api.getWorkItems({ ids }).subscribe(wis => {
          for (const wi of wis) this.workItemsMap.set(wi.id, wi);
        });
      }
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

  /** Renvoie les plages libres du sprint courant pour un membre (délègue à getAvailableGapsFromData). */
  private getAvailableGaps(memberId: number): Array<{ start: number; size: number }> {
    return this.getAvailableGapsFromData(memberId, this.blocks, this.leaves, this.totalWorkingDays);
  }

  canAddStory(member: TeamMember): boolean {
    return STORY_PROFILES.has(member.profile);
  }

  // ── Drag & resize ─────────────────────────────────────

  onBlockMoved(ev: BlockMoveEvent): void {
    if (this.activePI?.is_locked) return;
    if (ev.type === 'leave') {
      const leave = this.leaves.find(l => l.id === ev.id);
      if (leave) {
        const otherLeaves = this.leaves.filter(l => l.id !== ev.id && l.team_member_id === leave.team_member_id);
        if (this.overlapsAny(ev.day_offset, leave.duration_days, otherLeaves)) {
          this.loadLeaves(); // snap back
          return;
        }
      }
      this.api.updateLeave(ev.id, { day_offset: ev.day_offset }).subscribe((updated) => {
        const idx = this.leaves.findIndex((l) => l.id === ev.id);
        if (idx >= 0) this.leaves[idx] = updated;
      });
    } else {
      const block = this.blocks.find(b => b.id === ev.id);
      if (block) {
        const memberLeaves = this.leaves.filter(l => l.team_member_id === block.team_member_id);
        if (this.overlapsAny(ev.day_offset, block.duration_days, memberLeaves)) {
          this.loadBlocks(); // snap back
          return;
        }
      }
      this.api.updateBlock(ev.id, { day_offset: ev.day_offset }).subscribe((updated) => {
        const idx = this.blocks.findIndex((b) => b.id === ev.id);
        if (idx >= 0) this.blocks[idx] = updated;
      });
    }
  }

  private getAvailableGapsFromData(
    memberId: number,
    blocks: PlanningBlock[],
    leaves: Leave[],
    totalDays: number,
  ): Array<{ start: number; size: number }> {
    const intervals = [
      ...blocks.filter(b => b.team_member_id === memberId)
        .map(b => ({ start: b.day_offset, end: b.day_offset + b.duration_days })),
      ...leaves.filter(l => l.team_member_id === memberId)
        .map(l => ({ start: l.day_offset, end: l.day_offset + l.duration_days })),
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
    if (cursor < totalDays) gaps.push({ start: cursor, size: totalDays - cursor });
    return gaps;
  }

  private overlapsAny(offset: number, duration: number, intervals: Array<{ day_offset: number; duration_days: number }>): boolean {
    return intervals.some(iv => offset < iv.day_offset + iv.duration_days && offset + duration > iv.day_offset);
  }


  onBlockResized(ev: BlockResizeEvent): void {
    if (this.activePI?.is_locked) return;
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

  onCommentChanged(ev: { blockId: number; comment: string }): void {
    this.api.updateBlock(ev.blockId, { comment: ev.comment }).subscribe((updated) => {
      const idx = this.blocks.findIndex(b => b.id === ev.blockId);
      if (idx >= 0) this.blocks[idx] = updated;
      if (this.selectedBlock?.id === ev.blockId) this.selectedBlock = updated;
    });
  }

  /**
   * Retourne true si le bloc est sélectionné ou fait partie du même groupe
   * que le bloc sélectionné (story découpée sur plusieurs sprints).
   */
  isBlockSelected(block: PlanningBlock): boolean {
    if (!this.selectedBlock) return false;
    if (block.group_id != null && this.selectedBlock.group_id === block.group_id) return true;
    return this.selectedBlock.id === block.id;
  }

  /**
   * Construit le texte affiché dans l'infobulle d'un bloc story.
   * Pour les stories découpées (group_id), indique la durée totale sur toutes les briques.
   */
  getBlockTooltip(block: PlanningBlock): string {
    const parts: string[] = [];
    if (block.work_item_id) {
      const wi = this.workItemsMap.get(block.work_item_id);
      parts.push(wi ? `#${wi.id} — ${wi.title}` : `WI #${block.work_item_id}`);
    }
    if (block.group_id != null) {
      const allBlocks = this.blocks.filter(b => b.group_id === block.group_id);
      if (allBlocks.length > 1) {
        const total = allBlocks.reduce((s, b) => s + b.duration_days, 0);
        parts.push(`Durée : ${block.duration_days}j (total story : ${total}j sur ${allBlocks.length} briques)`);
      } else {
        parts.push(`Durée : ${block.duration_days}j`);
      }
    } else {
      parts.push(`Durée : ${block.duration_days}j`);
    }
    if (block.comment) parts.push(block.comment);
    return parts.join('\n') || `Stories (${block.duration_days}j)`;
  }

  buildAzdoUrl(id: number): string {
    if (!this.azdoOrg || !this.azdoProject) return '';
    return `https://dev.azure.com/${this.azdoOrg}/${this.azdoProject}/_workitems/edit/${id}`;
  }

  getMemberById(id: number): TeamMember | undefined {
    return this.teamMembers.find(m => m.id === id);
  }

  /** Ouvre ou ferme le panneau de détail chronologique pour un collaborateur. */
  toggleDetail(memberId: number): void {
    this.detailMemberId = this.detailMemberId === memberId ? null : memberId;
  }

  /**
   * Renvoie la liste triée chronologiquement de toutes les activités du membre
   * (blocs Layer 1 + Layer 2 + congés) pour affichage dans le panneau de détail.
   */
  getDetailEntries(memberId: number): Array<{
    sortOffset: number;
    startDate: string;
    endDate: string;
    label: string;
    duration: number;
    category: string;
    isStory: boolean;
    isLeave: boolean;
    workItemId: number | null;
    workItemTitle: string | null;
    comment: string | null;
  }> {
    const formatDate = (offset: number): string => {
      const idx = Math.max(0, Math.min(Math.floor(offset), this.workingDays.length - 1));
      const d = this.workingDays[idx];
      if (!d) return '—';
      return d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
    };
    const endIdx = (offset: number, duration: number): number =>
      Math.max(0, Math.min(Math.floor(offset + duration - 0.5), this.workingDays.length - 1));

    const entries: ReturnType<typeof this.getDetailEntries> = [];

    for (const b of this.blocks.filter(b => b.team_member_id === memberId)) {
      const wi = b.work_item_id ? (this.workItemsMap.get(b.work_item_id) ?? null) : null;
      entries.push({
        sortOffset: b.day_offset,
        startDate: formatDate(b.day_offset),
        endDate: formatDate(endIdx(b.day_offset, b.duration_days)),
        label: BLOCK_CATEGORY_LABELS[b.category as BlockCategory] ?? b.category,
        duration: b.duration_days,
        category: b.category,
        isStory: b.layer === 2,
        isLeave: false,
        workItemId: b.work_item_id ?? null,
        workItemTitle: wi?.title ?? null,
        comment: b.comment ?? null,
      });
    }

    for (const l of this.leaves.filter(l => l.team_member_id === memberId)) {
      entries.push({
        sortOffset: l.day_offset,
        startDate: formatDate(l.day_offset),
        endDate: formatDate(endIdx(l.day_offset, l.duration_days)),
        label: `Congé — ${l.label ?? 'CP'}`,
        duration: l.duration_days,
        category: 'conges',
        isStory: false,
        isLeave: true,
        workItemId: null,
        workItemTitle: null,
        comment: null,
      });
    }

    return entries.sort((a, b) => a.sortOffset - b.sortOffset);
  }

  /**
   * Associe un Work Item AZDO à un bloc story.
   * Si le bloc appartient à un groupe, le backend propage automatiquement
   * le work_item_id à tous les membres du groupe.
   */
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
    if (this.activePI?.is_locked) return;
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
    const existingLeaves = this.leaves.filter(l => l.team_member_id === this.addingLeave!.memberId);
    if (this.overlapsAny(offset, this.addingLeave.duration, existingLeaves)) {
      alert('Ce congé chevauche un congé existant pour ce collaborateur.');
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
    if (this.activePI?.is_locked) return;
    const category = member.profile === 'QA' ? 'stories_qa' : 'stories_dev';
    this.addingStory = { memberId: member.id, category, duration: 0.25, workItemId: null };
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

    const buildPayload = (offset: number, dur: number, sprintNum: number): Partial<PlanningBlock> => ({
      pi_id: this.activePI!.id,
      team_member_id: story.memberId,
      sprint_number: sprintNum,
      day_offset: offset,
      duration_days: dur,
      category: story.category as BlockCategory,
      layer: 2,
      work_item_id: story.workItemId ?? undefined,
    });

    // Remplir le sprint courant
    const durationInSprint = Math.min(story.duration, totalFreeInSprint);
    const currentPayloads: Partial<PlanningBlock>[] = [];
    let rem = durationInSprint;
    for (const gap of gaps) {
      if (rem <= 0) break;
      const place = Math.min(rem, gap.size);
      currentPayloads.push(buildPayload(gap.start, place, this.selectedSprint));
      rem -= place;
    }

    let overflow = story.duration - durationInSprint;

    // Sprints suivants à parcourir en cascade jusqu'à absorption complète de l'overflow
    const followingSprints = this.SPRINT_CONFIG
      .map(s => s.number)
      .filter(n => n > this.selectedSprint)
      .sort((a, b) => a - b);

    if (overflow <= 0 || followingSprints.length === 0) {
      this._submitStoryBlocks(currentPayloads, overflow, [], this.selectedSprint);
      return;
    }

    // Récupérer les données de TOUS les sprints suivants en parallèle
    forkJoin(
      followingSprints.map(sprintNum =>
        forkJoin([
          this.api.getBlocksForSprint(this.activePI!.id, sprintNum),
          this.api.getLeavesForSprint(this.activePI!.id, sprintNum),
        ]).pipe(map(([blocks, leaves]) => ({ sprintNum, blocks, leaves })))
      )
    ).subscribe(sprintsData => {
      const overflowPayloads: Partial<PlanningBlock>[] = [];
      const placedBySprint: Array<{ sprint: number; days: number }> = [];

      for (const { sprintNum, blocks, leaves } of sprintsData) {
        if (overflow <= 0) break;
        const sprintDays = this.SPRINT_CONFIG.find(s => s.number === sprintNum)?.workingDays ?? 15;
        const sprintGaps = this.getAvailableGapsFromData(story.memberId, blocks, leaves, sprintDays);
        let placedInSprint = 0;
        for (const gap of sprintGaps) {
          if (overflow <= 0) break;
          const place = Math.min(overflow, gap.size);
          overflowPayloads.push(buildPayload(gap.start, place, sprintNum));
          overflow -= place;
          placedInSprint += place;
        }
        if (placedInSprint > 0) placedBySprint.push({ sprint: sprintNum, days: placedInSprint });
      }

      this._submitStoryBlocks(
        [...currentPayloads, ...overflowPayloads],
        overflow,
        placedBySprint,
        this.selectedSprint,
      );
    });
  }

  private _submitStoryBlocks(
    payloads: Partial<PlanningBlock>[],
    truncated: number,
    overflowBySprint: Array<{ sprint: number; days: number }>,
    currentSprint: number,
  ): void {
    const create$ = payloads.length === 1
      ? this.api.createBlock(payloads[0]).pipe(map(b => [b]))
      : this.api.createBlockGroup(payloads);

    create$.subscribe({
      next: (createdBlocks) => {
        this.blocks.push(...createdBlocks.filter(b => b.sprint_number === currentSprint));
        this.addingStory = null;

        if (overflowBySprint.length > 0 || truncated > 0) {
          const currentDays = payloads
            .filter(p => p.sprint_number === currentSprint)
            .reduce((s, p) => s + (p.duration_days ?? 0), 0);
          const parts = [`${currentDays}j Sprint ${currentSprint}`];
          for (const { sprint, days } of overflowBySprint) parts.push(`${days}j Sprint ${sprint}`);
          let msg = `Story répartie : ${parts.join(', ')}.`;
          if (truncated > 0) msg += `\n⚠️ ${truncated}j non placés (fin de PI atteinte).`;
          alert(msg);
        }
      },
      error: (err) => alert(err.error?.detail ?? 'Erreur lors de l\'ajout de la story'),
    });
  }

  // ── Reset ─────────────────────────────────────────────

  openResetModal(scope: 'sprint' | 'pi'): void {
    this.resetModal = { scope, leaves: true, stories: true, layer1: true, memberId: null };
    this.showResetMenu = false;
  }

  confirmReset(): void {
    if (!this.activePI || !this.resetModal) return;
    const opts = { leaves: this.resetModal.leaves, stories: this.resetModal.stories, layer1: this.resetModal.layer1 };
    const memberId = this.resetModal.memberId;
    const obs = this.resetModal.scope === 'sprint'
      ? this.api.resetSprint(this.activePI.id, this.selectedSprint, opts, memberId)
      : this.api.resetPI(this.activePI.id, opts, memberId);
    obs.subscribe(() => {
      this.loadBlocks();
      this.loadLeaves();
      this.resetModal = null;
    });
  }

  // ── Génération ────────────────────────────────────────

  openGenerateModal(scope: 'sprint' | 'pi'): void {
    this.generateModal = { scope, memberId: null };
    this.showGenerateMenu = false;
  }

  confirmGenerate(): void {
    if (!this.activePI || !this.generateModal) return;
    this.generating = true;
    const { scope, memberId } = this.generateModal;
    const sprintNumber = scope === 'sprint' ? this.selectedSprint : null;
    this.api.generatePlanning(this.activePI.id, memberId, sprintNumber).subscribe({
      next: () => {
        this.generating = false;
        this.generateModal = null;
        this.loadBlocks();
      },
      error: (err) => {
        this.generating = false;
        alert(err.error?.detail ?? 'Erreur lors de la génération');
      },
    });
  }

  // ── Helpers template ──────────────────────────────────

  formatDay(d: Date): { shortDay: string; dayNum: string; monthNum: string } {
    return this.cal.formatDayHeader(d);
  }

  isWeekStart(d: Date): boolean {
    return this.cal.isWeekStart(d);
  }

  get gridWidth(): number {
    return this.workingDays.length * this.COL_WIDTH;
  }
}
