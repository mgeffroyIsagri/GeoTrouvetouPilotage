import { Component, Input, Output, EventEmitter, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { WorkItem, PlanningBlock } from '../../../core/models';

/** Chemin d'itération par défaut pour pré-filtrer le picker de Work Items sur le Backlog. */
const DEFAULT_ITERATION_FILTER = 'Isagri_Dev_PV_IsaPV\\Backlog';

@Component({
  selector: 'app-work-item-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './work-item-panel.component.html',
  styleUrl: './work-item-panel.component.scss',
})
export class WorkItemPanelComponent implements OnInit, OnChanges {
  @Input() block: PlanningBlock | null = null;
  @Input() piId: number | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() workItemAssigned = new EventEmitter<{ blockId: number; workItemId: number }>();
  @Output() commentChanged = new EventEmitter<{ blockId: number; comment: string }>();
  @Output() workItemLoaded = new EventEmitter<WorkItem>();

  workItem: WorkItem | null = null;
  availableItems: WorkItem[] = [];
  loading = false;
  showPicker = false;
  searchText = '';
  iterationFilter = DEFAULT_ITERATION_FILTER;
  useIterationFilter = true;
  comment = '';

  private azdoOrg = '';
  private azdoProject = '';

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.api.getSettings().subscribe(settings => {
      const org = settings.find(s => s.key === 'azdo_organization')?.value ?? '';
      this.azdoOrg = org.replace(/^https?:\/\/dev\.azure\.com\//, '').replace(/\/$/, '');
      this.azdoProject = settings.find(s => s.key === 'azdo_project')?.value ?? '';
    });
  }

  buildAzdoUrl(id: number): string {
    if (!this.azdoOrg || !this.azdoProject) return '';
    return `https://dev.azure.com/${this.azdoOrg}/${this.azdoProject}/_workitems/edit/${id}`;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['block'] && this.block) {
      this.workItem = null;
      this.showPicker = false;
      this.comment = this.block.comment ?? '';
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
        if (this.workItem) this.workItemLoaded.emit(this.workItem);
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
      type: 'User Story,Enabler Story',
      search: this.searchText || undefined,
      iteration_path: this.useIterationFilter && this.iterationFilter ? this.iterationFilter : undefined,
      limit: 50,
    }).subscribe((items) => (this.availableItems = items));
  }

  onSearchChange(): void {
    this.loadAvailableItems();
  }

  onIterationFilterChange(): void {
    this.loadAvailableItems();
  }

  assignWorkItem(wi: WorkItem): void {
    if (!this.block) return;
    this.workItemAssigned.emit({ blockId: this.block.id, workItemId: wi.id });
    this.workItem = wi;
    this.workItemLoaded.emit(wi);
    this.showPicker = false;
  }

  saveComment(): void {
    if (!this.block) return;
    this.commentChanged.emit({ blockId: this.block.id, comment: this.comment });
  }

  close(): void {
    this.closed.emit();
  }
}
