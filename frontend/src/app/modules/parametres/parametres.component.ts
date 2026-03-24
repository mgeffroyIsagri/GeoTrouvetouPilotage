import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { AppSetting, SyncLog, WorkItem, Iteration, TeamMember, ConnectionTestResult } from '../../core/models';

interface SettingGroup {
  id: string;
  label: string;
  icon: string;
  keys: string[];
}

const WORK_ITEM_TYPES = ['Feature', 'Enabler Story', 'Enabler', 'User Story', 'Bug', 'Task', 'Maintenance', 'Question'];
const WORK_ITEM_STATES = ['New', 'Active', 'Resolved', 'Closed', 'Removed'];

@Component({
  selector: 'app-parametres',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './parametres.component.html',
  styleUrl: './parametres.component.scss',
})
export class ParametresComponent implements OnInit {
  activeTab: 'settings' | 'sync-data' = 'settings';

  // Settings
  settings: AppSetting[] = [];
  saving: Record<string, boolean> = {};
  saved: Record<string, boolean> = {};

  readonly settingGroups: SettingGroup[] = [
    { id: 'azdo', label: 'Azure DevOps', icon: '☁️', keys: ['azdo_organization', 'azdo_project', 'azdo_team', 'azdo_pat'] },
    { id: 'llm',  label: 'Intelligence Artificielle', icon: '🤖', keys: ['llm_provider', 'llm_model', 'llm_api_key', 'llm_endpoint'] },
    { id: 'matrices', label: 'Matrices de capacité', icon: '📊', keys: ['capacity_matrix_dev', 'capacity_matrix_qa', 'capacity_matrix_psm'] },
    { id: 'display', label: 'Affichage', icon: '🎨', keys: ['block_colors'] },
  ];

  // Test connexion
  connectionTest: ConnectionTestResult | null = null;
  connectionTesting = false;

  // Synchronisation
  syncLoading = false;
  syncLogs: SyncLog[] = [];
  syncSinceDate = '';

  // Données synchronisées — Work Items
  workItems: WorkItem[] = [];
  workItemsLoading = false;
  workItemsTotal = 0;
  workItemsSkip = 0;
  readonly workItemsLimit = 50;
  wiSearchText = '';
  wiSelectedTypes: Set<string> = new Set();
  wiSelectedStates: Set<string> = new Set();
  wiSelectedIteration = '';
  readonly workItemTypes = WORK_ITEM_TYPES;
  readonly workItemStates = WORK_ITEM_STATES;

  // Données synchronisées — Iterations
  iterations: Iteration[] = [];

  // Données synchronisées — Équipe
  teamMembers: TeamMember[] = [];
  profileSaving: Record<number, boolean> = {};

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.api.getSettings().subscribe((s) => (this.settings = s));
    this.loadSyncLogs();
  }

  // --- Settings ---

  getSettingsForGroup(group: SettingGroup): AppSetting[] {
    return group.keys
      .map((k) => this.settings.find((s) => s.key === k))
      .filter((s): s is AppSetting => !!s);
  }

  isTextarea(key: string): boolean {
    return key.startsWith('capacity_matrix') || key === 'block_colors';
  }

  isSensitive(key: string): boolean {
    return key.includes('pat') || key.includes('api_key');
  }

  saveSetting(setting: AppSetting): void {
    if (setting.value === null || setting.value === undefined) return;
    this.saving[setting.key] = true;
    this.api.updateSetting(setting.key, setting.value).subscribe({
      next: () => {
        this.saving[setting.key] = false;
        this.saved[setting.key] = true;
        setTimeout(() => delete this.saved[setting.key], 2000);
      },
      error: () => { this.saving[setting.key] = false; },
    });
  }

  // --- Test connexion ---

  testConnection(): void {
    this.connectionTesting = true;
    this.connectionTest = null;
    this.api.testAzdoConnection().subscribe({
      next: (result) => {
        this.connectionTesting = false;
        this.connectionTest = result;
      },
      error: () => {
        this.connectionTesting = false;
        this.connectionTest = { ok: false, error: 'Erreur inattendue', details: null };
      },
    });
  }

  // --- Synchronisation ---

  triggerSync(fullSync = false): void {
    this.syncLoading = true;
    this.api.syncAzdo(fullSync, fullSync ? undefined : (this.syncSinceDate || undefined)).subscribe({
      next: () => {
        this.syncLoading = false;
        this.loadSyncLogs();
        this.loadSyncData();
      },
      error: (err) => {
        this.syncLoading = false;
        this.loadSyncLogs();
        console.error('Sync error:', err);
      },
    });
  }

  loadSyncLogs(): void {
    this.api.getSyncLogs().subscribe((logs) => (this.syncLogs = logs));
  }

  parseSyncDetails(details: string | null): string {
    if (!details) return '';
    try {
      const d = JSON.parse(details);
      const parts = [];
      if (d.iterations) parts.push(`${d.iterations} itération(s)`);
      if (d.members)    parts.push(`${d.members} membre(s)`);
      if (d.work_items) parts.push(`${d.work_items} work item(s)`);
      if (d.since)      parts.push(`depuis ${new Date(d.since).toLocaleDateString('fr-FR')}`);
      return parts.join(' · ') || details;
    } catch {
      return details;
    }
  }

  parseSyncMode(details: string | null): string {
    if (!details) return '';
    try {
      const d = JSON.parse(details);
      return d.mode === 'full' ? 'Complète' : 'Incrémentale';
    } catch { return ''; }
  }

  // --- Onglet données ---

  onTabChange(tab: 'settings' | 'sync-data'): void {
    this.activeTab = tab;
    if (tab === 'sync-data' && this.workItems.length === 0) {
      this.loadSyncData();
    }
  }

  loadSyncData(): void {
    this.loadWorkItems(true);
    this.api.getIterations().subscribe((it) => (this.iterations = it));
    this.api.listTeamMembers().subscribe((m) => (this.teamMembers = m));
    this.api.getWorkItemsCount().subscribe((r) => (this.workItemsTotal = r.count));
  }

  private buildWiFilterParams() {
    return {
      search: this.wiSearchText || undefined,
      type: this.wiSelectedTypes.size > 0 ? [...this.wiSelectedTypes].join(',') : undefined,
      state: this.wiSelectedStates.size > 0 ? [...this.wiSelectedStates].join(',') : undefined,
      iteration_path: this.wiSelectedIteration || undefined,
    };
  }

  loadWorkItems(reset = false): void {
    if (reset) {
      this.workItemsSkip = 0;
      this.workItems = [];
    }
    this.workItemsLoading = true;
    const params = this.buildWiFilterParams();
    this.api.getWorkItemsCount(params).subscribe((r) => (this.workItemsTotal = r.count));
    this.api
      .getWorkItems({ ...params, skip: this.workItemsSkip, limit: this.workItemsLimit })
      .subscribe({
        next: (items) => {
          this.workItems = reset ? items : [...this.workItems, ...items];
          this.workItemsSkip += items.length;
          this.workItemsLoading = false;
        },
        error: () => { this.workItemsLoading = false; },
      });
  }

  loadMoreWorkItems(): void {
    this.loadWorkItems(false);
  }

  onWiSearch(): void {
    this.loadWorkItems(true);
  }

  toggleTypeFilter(type: string): void {
    if (this.wiSelectedTypes.has(type)) {
      this.wiSelectedTypes.delete(type);
    } else {
      this.wiSelectedTypes.add(type);
    }
    this.loadWorkItems(true);
  }

  toggleStateFilter(state: string): void {
    if (this.wiSelectedStates.has(state)) {
      this.wiSelectedStates.delete(state);
    } else {
      this.wiSelectedStates.add(state);
    }
    this.loadWorkItems(true);
  }

  onIterationFilter(): void {
    this.loadWorkItems(true);
  }

  hasMoreWorkItems(): boolean {
    return this.workItemsSkip < this.workItemsTotal;
  }

  // --- Équipe ---

  updateProfile(member: TeamMember, profile: string): void {
    this.profileSaving[member.id] = true;
    this.api.updateTeamMember(member.id, { profile: profile as 'Dev' | 'QA' | 'PSM' | 'Squad Lead' | 'Automate' }).subscribe({
      next: (updated) => {
        member.profile = updated.profile;
        this.profileSaving[member.id] = false;
      },
      error: () => { this.profileSaving[member.id] = false; },
    });
  }
}
