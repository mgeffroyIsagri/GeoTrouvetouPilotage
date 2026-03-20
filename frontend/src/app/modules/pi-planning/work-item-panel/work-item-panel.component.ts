import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { WorkItem, PlanningBlock } from '../../../core/models';

@Component({
  selector: 'app-work-item-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './work-item-panel.component.html',
  styleUrl: './work-item-panel.component.scss',
})
export class WorkItemPanelComponent implements OnChanges {
  @Input() block: PlanningBlock | null = null;
  @Input() piId: number | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() workItemAssigned = new EventEmitter<{ blockId: number; workItemId: number }>();

  workItem: WorkItem | null = null;
  availableItems: WorkItem[] = [];
  loading = false;
  showPicker = false;
  searchText = '';

  constructor(private api: ApiService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['block'] && this.block) {
      this.workItem = null;
      this.showPicker = false;
      if (this.block.work_item_id) {
        this.loadWorkItem(this.block.work_item_id);
      }
    }
  }

  loadWorkItem(id: number): void {
    this.loading = true;
    this.api.getWorkItems({ search: String(id), limit: 1 }).subscribe({
      next: (items) => {
        this.workItem = items.find((wi) => wi.id === id) ?? null;
        this.loading = false;
      },
      error: () => { this.loading = false; },
    });
  }

  openPicker(): void {
    this.showPicker = true;
    this.loadAvailableItems();
  }

  loadAvailableItems(): void {
    this.api.getWorkItems({
      type: 'User Story',
      search: this.searchText || undefined,
      limit: 50,
    }).subscribe((items) => (this.availableItems = items));
  }

  onSearchChange(): void {
    this.loadAvailableItems();
  }

  assignWorkItem(wi: WorkItem): void {
    if (!this.block) return;
    this.workItemAssigned.emit({ blockId: this.block.id, workItemId: wi.id });
    this.workItem = wi;
    this.showPicker = false;
  }

  close(): void {
    this.closed.emit();
  }
}
