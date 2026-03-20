import {
  Component, Input, Output, EventEmitter, HostListener,
  ElementRef, OnDestroy, ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlanningBlock, Leave, BLOCK_CATEGORY_LABELS, BlockCategory } from '../../../core/models';
import { CalendarService } from '../../../core/services/calendar.service';

export interface BlockMoveEvent {
  id: number;
  type: 'block' | 'leave';
  day_offset: number;
}
export interface BlockResizeEvent {
  id: number;
  duration_days: number;
}

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
    </div>
  `,
  styleUrl: './planning-block.component.scss',
})
export class PlanningBlockComponent implements OnDestroy {
  @Input() block!: PlanningBlock | Leave;
  @Input() colWidth = 36;
  @Input() totalDays = 15;
  @Input() isDraggable = false;
  @Input() isResizable = false;
  @Input() isLeave = false;

  @Output() blockMoved = new EventEmitter<BlockMoveEvent>();
  @Output() blockResized = new EventEmitter<BlockResizeEvent>();
  @Output() blockClicked = new EventEmitter<PlanningBlock | Leave>();

  // Drag state
  private dragging = false;
  private resizing = false;
  private startMouseX = 0;
  private startOffset = 0;
  private startDuration = 0;
  private mouseMoveHandler!: (e: MouseEvent) => void;
  private mouseUpHandler!: (e: MouseEvent) => void;

  // Affichage en temps réel pendant le drag
  displayOffset: number | null = null;
  displayDuration: number | null = null;

  constructor(private cal: CalendarService, private el: ElementRef) {}

  get b(): PlanningBlock { return this.block as PlanningBlock; }
  get lv(): Leave { return this.block as Leave; }

  get currentOffset(): number {
    return this.displayOffset ?? this.block.day_offset;
  }
  get currentDuration(): number {
    return this.displayDuration ?? this.block.duration_days;
  }

  get left(): number { return this.cal.offsetToPixel(this.currentOffset, this.colWidth); }
  get width(): number { return Math.max(this.colWidth * 0.5, this.currentDuration * this.colWidth - 2); }

  get blockClasses(): string {
    const cat = this.isLeave ? 'conges' : (this.block as PlanningBlock).category;
    const layer = this.isLeave ? 1 : (this.block as PlanningBlock).layer;
    return [
      'block',
      `block--${cat}`,
      layer === 2 ? 'block--layer2' : '',
      this.isDraggable ? 'block--draggable' : '',
      this.dragging || this.resizing ? 'block--active' : '',
    ].filter(Boolean).join(' ');
  }

  get tooltip(): string {
    if (this.isLeave) return `Congé${this.lv.label ? ' — ' + this.lv.label : ''}`;
    const cat = (this.block as PlanningBlock).category as BlockCategory;
    return `${BLOCK_CATEGORY_LABELS[cat] ?? cat} (${this.block.duration_days}j)`;
  }

  onClick(e: MouseEvent): void {
    if (!this.dragging && !this.resizing) {
      this.blockClicked.emit(this.block);
    }
  }

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

  private cleanup(): void {
    document.removeEventListener('mousemove', this.mouseMoveHandler);
    document.removeEventListener('mouseup', this.mouseUpHandler);
  }

  ngOnDestroy(): void {
    this.cleanup();
  }
}
