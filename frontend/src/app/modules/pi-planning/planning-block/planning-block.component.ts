import {
  Component, Input, Output, EventEmitter, OnDestroy, ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlanningBlock, Leave, BLOCK_CATEGORY_LABELS, BlockCategory } from '../../../core/models';
import { CalendarService } from '../../../core/services/calendar.service';

/**
 * Événement émis lors du déplacement d'un bloc ou d'un congé.
 * `day_offset` est la nouvelle position en jours depuis le début du sprint
 * (format float, snappé à 0,5 via `CalendarService.pixelToOffset`).
 */
export interface BlockMoveEvent {
  id: number;
  type: 'block' | 'leave';
  day_offset: number;
}

/**
 * Événement émis lors du redimensionnement d'un bloc Layer 2.
 * `duration_days` est la nouvelle durée en jours (multiple de 0,5, minimum 0,5).
 */
export interface BlockResizeEvent {
  id: number;
  duration_days: number;
}

/**
 * Composant de rendu d'un bloc de planning ou d'un congé.
 *
 * Rendu : un `<div>` positionné en pixels, coloré via les classes CSS de catégorie,
 * avec optionnellement une poignée de redimensionnement et une icône de suppression.
 *
 * Interactions supportées :
 * - **Drag** : déplacement via événements natifs `mousedown` → `document.mousemove` / `document.mouseup`.
 *   La position est snappée à 0,5 jour via `CalendarService.pixelToOffset`.
 * - **Resize** : redimensionnement via la poignée droite (`resize-handle`), même mécanique.
 *   La durée est snappée à 0,5 jour avec un minimum de 0,5.
 * - **Click** : émission de `blockClicked` si aucun drag ni resize n'a eu lieu.
 * - **Delete** : émission de `blockDeleteRequested` via l'icône corbeille.
 *
 * Pendant le drag ou le resize, `displayOffset` / `displayDuration` prennent le relais
 * sur les valeurs du modèle pour le rendu temps réel. À la fin du geste, les événements
 * `blockMoved` / `blockResized` sont émis et le modèle local est mis à jour.
 *
 * `ChangeDetectionStrategy.OnPush` est utilisé ; le composant parent doit donc émettre
 * de nouveaux objets `block` pour déclencher la détection de changement.
 */
@Component({
  selector: 'app-planning-block',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="block"
      [class]="blockClasses"
      [style.left.px]="left"
      [style.width.px]="width"
      [title]="tooltip"
      (mousedown)="onMouseDown($event)"
      (click)="onClick($event)"
    >
      @if (isResizable) {
        <div class="resize-handle" (mousedown)="onResizeMouseDown($event)"></div>
      }
      @if (isDeletable) {
        <span class="delete-icon" (click)="onDeleteClick($event)" title="Supprimer">🗑️</span>
      }
    </div>
  `,
  styleUrl: './planning-block.component.scss',
})
export class PlanningBlockComponent implements OnDestroy {
  // ── Inputs ────────────────────────────────────────────────

  /** Bloc de planning ou congé à afficher. */
  @Input() block!: PlanningBlock | Leave;

  /** Largeur en pixels d'une colonne (1 jour ouvré). Défaut : 36px. */
  @Input() colWidth = 36;

  /** Nombre total de jours dans le sprint, utilisé pour borner le snap. */
  @Input() totalDays = 15;

  /** Active le drag & drop natif par événements souris. */
  @Input() isDraggable = false;

  /** Affiche la poignée de redimensionnement droite (Layer 2 uniquement). */
  @Input() isResizable = false;

  /** Vrai si le bloc représente un congé (`Leave`) plutôt qu'un `PlanningBlock`. */
  @Input() isLeave = false;

  /** Affiche l'icône de suppression (corbeille). */
  @Input() isDeletable = false;

  /**
   * Tooltip personnalisé. Si null, un tooltip par défaut est généré
   * à partir de la catégorie et de la durée du bloc.
   */
  @Input() customTooltip: string | null = null;

  /** Applique la classe CSS `block--selected` (mise en évidence). */
  @Input() isSelected = false;

  /** Vrai si le bloc Layer 2 n'a pas de work item associé (orphelin). */
  @Input() isOrphan = false;

  // ── Outputs ───────────────────────────────────────────────

  /** Émis à la fin d'un drag avec la nouvelle position `day_offset`. */
  @Output() blockMoved = new EventEmitter<BlockMoveEvent>();

  /** Émis à la fin d'un resize avec la nouvelle `duration_days`. */
  @Output() blockResized = new EventEmitter<BlockResizeEvent>();

  /** Émis lors d'un clic simple (sans drag ni resize). */
  @Output() blockClicked = new EventEmitter<PlanningBlock | Leave>();

  /** Émis lorsque l'utilisateur clique sur l'icône de suppression. */
  @Output() blockDeleteRequested = new EventEmitter<PlanningBlock | Leave>();

  // ── État interne drag & drop ──────────────────────────────

  private dragging = false;
  private resizing = false;
  private startMouseX = 0;
  private startOffset = 0;
  private startDuration = 0;

  /** Référence au handler `mousemove` attaché au `document` pendant un geste. */
  private mouseMoveHandler!: (e: MouseEvent) => void;

  /** Référence au handler `mouseup` attaché au `document` pendant un geste. */
  private mouseUpHandler!: (e: MouseEvent) => void;

  /**
   * Position temporaire en cours de drag (en jours depuis le début du sprint).
   * Null quand aucun drag n'est actif ; `block.day_offset` est alors utilisé.
   */
  displayOffset: number | null = null;

  /**
   * Durée temporaire en cours de resize (en jours).
   * Null quand aucun resize n'est actif ; `block.duration_days` est alors utilisé.
   */
  displayDuration: number | null = null;

  constructor(private cal: CalendarService) {}

  // ── Getters de position et de rendu ──────────────────────

  /** Position effective en `day_offset` (temporaire si drag actif, modèle sinon). */
  get currentOffset(): number { return this.displayOffset ?? this.block.day_offset; }

  /** Durée effective en jours (temporaire si resize actif, modèle sinon). */
  get currentDuration(): number { return this.displayDuration ?? this.block.duration_days; }

  /** Position CSS `left` en pixels calculée depuis `currentOffset`. */
  get left(): number { return this.cal.offsetToPixel(this.currentOffset, this.colWidth); }

  /** Largeur CSS en pixels calculée depuis `currentDuration` (minimum 4px). */
  get width(): number { return Math.max(4, this.currentDuration * this.colWidth - 2); }

  /**
   * Classe CSS composite appliquée au `<div>` bloc.
   * Inclut : catégorie, layer, draggable, active (pendant le geste), selected.
   */
  get blockClasses(): string {
    const cat = this.isLeave ? 'conges' : (this.block as PlanningBlock).category;
    const layer = this.isLeave ? 1 : (this.block as PlanningBlock).layer;
    return [
      'block',
      `block--${cat}`,
      layer === 2 ? 'block--layer2' : '',
      this.isDraggable ? 'block--draggable' : '',
      this.dragging || this.resizing ? 'block--active' : '',
      this.isSelected ? 'block--selected' : '',
      this.isOrphan ? 'block--orphan' : '',
    ].filter(Boolean).join(' ');
  }

  /**
   * Texte du tooltip affiché au survol.
   * Utilise `customTooltip` s'il est défini, sinon génère un texte par défaut
   * basé sur la catégorie et la durée du bloc.
   */
  get tooltip(): string {
    if (this.customTooltip !== null) return this.customTooltip;
    if (this.isLeave) return `Congé${(this.block as Leave).label ? ' — ' + (this.block as Leave).label : ''}`;
    const cat = (this.block as PlanningBlock).category as BlockCategory;
    return `${BLOCK_CATEGORY_LABELS[cat] ?? cat} (${this.block.duration_days}j)`;
  }

  // ── Gestionnaires d'événements ────────────────────────────

  /**
   * Gère le clic sur l'icône de suppression.
   * Stoppe la propagation pour éviter de déclencher `blockClicked`.
   * @param e Événement souris.
   */
  onDeleteClick(e: MouseEvent): void {
    e.stopPropagation();
    e.preventDefault();
    this.blockDeleteRequested.emit(this.block);
  }

  /**
   * Gère le clic sur le bloc.
   * N'émet `blockClicked` que si aucun drag ni resize n'a eu lieu
   * (distinction clic vs fin de geste).
   * @param e Événement souris.
   */
  onClick(e: MouseEvent): void {
    if (!this.dragging && !this.resizing) {
      this.blockClicked.emit(this.block);
    }
  }

  /**
   * Démarre le drag du bloc au `mousedown`.
   * Attache `mousemove` et `mouseup` au `document` pour capturer les événements
   * même si le curseur sort du bloc pendant le geste.
   * La position est snappée à 0,5 jour via `CalendarService.pixelToOffset`.
   * @param e Événement `mousedown`.
   */
  onMouseDown(e: MouseEvent): void {
    if (!this.isDraggable) return;
    e.preventDefault();
    e.stopPropagation();

    this.dragging = true;
    this.startMouseX = e.clientX;
    this.startOffset = this.block.day_offset;
    this.displayOffset = this.startOffset;

    this.mouseMoveHandler = (ev: MouseEvent) => {
      const dx = ev.clientX - this.startMouseX;
      const raw = this.startOffset + dx / this.colWidth;
      this.displayOffset = this.cal.pixelToOffset(raw * this.colWidth, this.colWidth, this.totalDays);
    };
    this.mouseUpHandler = () => {
      if (this.dragging) {
        this.blockMoved.emit({ id: this.block.id, type: this.isLeave ? 'leave' : 'block', day_offset: this.displayOffset! });
        this.block = { ...this.block, day_offset: this.displayOffset! };
        this.displayOffset = null;
        this.dragging = false;
      }
      this.cleanup();
    };
    document.addEventListener('mousemove', this.mouseMoveHandler);
    document.addEventListener('mouseup', this.mouseUpHandler);
  }

  /**
   * Démarre le resize du bloc au `mousedown` sur la poignée droite.
   * La durée est snappée à 0,5 jour avec un minimum de 0,5.
   * @param e Événement `mousedown` sur la poignée de resize.
   */
  onResizeMouseDown(e: MouseEvent): void {
    if (!this.isResizable) return;
    e.preventDefault();
    e.stopPropagation();

    this.resizing = true;
    this.startMouseX = e.clientX;
    this.startDuration = this.block.duration_days;
    this.displayDuration = this.startDuration;

    this.mouseMoveHandler = (ev: MouseEvent) => {
      const dx = ev.clientX - this.startMouseX;
      const rawDur = this.startDuration + dx / this.colWidth;
      const snapped = Math.round(rawDur * 2) / 2;
      this.displayDuration = Math.max(0.5, snapped);
    };
    this.mouseUpHandler = () => {
      if (this.resizing) {
        this.blockResized.emit({ id: this.block.id, duration_days: this.displayDuration! });
        this.block = { ...this.block, duration_days: this.displayDuration! };
        this.displayDuration = null;
        this.resizing = false;
      }
      this.cleanup();
    };
    document.addEventListener('mousemove', this.mouseMoveHandler);
    document.addEventListener('mouseup', this.mouseUpHandler);
  }

  /**
   * Retire les listeners `mousemove` et `mouseup` du `document`.
   * Appelé à la fin de chaque geste (drag ou resize) pour éviter les fuites.
   */
  private cleanup(): void {
    document.removeEventListener('mousemove', this.mouseMoveHandler);
    document.removeEventListener('mouseup', this.mouseUpHandler);
  }

  /** Nettoie les listeners lors de la destruction du composant. */
  ngOnDestroy(): void { this.cleanup(); }
}
