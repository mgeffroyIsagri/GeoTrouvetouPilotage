import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { LLMLog } from '../../core/models';

@Component({
  selector: 'app-logs',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './logs.component.html',
  styleUrl: './logs.component.scss',
})
export class LogsComponent implements OnInit {
  logs: LLMLog[] = [];
  loading = false;
  error = '';
  selectedLog: LLMLog | null = null;
  filterType = '';
  limit = 100;

  readonly LOG_TYPES = ['', 'LLM_REQUEST', 'LLM_RESPONSE', 'AZDO_FETCH', 'ERROR'];

  readonly TYPE_LABELS: Record<string, string> = {
    LLM_REQUEST:  'Prompt LLM',
    LLM_RESPONSE: 'Réponse LLM',
    AZDO_FETCH:   'Fetch AZDO',
    ERROR:        'Erreur',
  };

  readonly TYPE_CLASSES: Record<string, string> = {
    LLM_REQUEST:  'badge--request',
    LLM_RESPONSE: 'badge--response',
    AZDO_FETCH:   'badge--azdo',
    ERROR:        'badge--error',
  };

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = '';
    this.api.getLogs({
      log_type: this.filterType || undefined,
      limit: this.limit,
    }).subscribe({
      next: (logs) => { this.logs = logs; this.loading = false; },
      error: (err) => { this.error = err.message; this.loading = false; },
    });
  }

  select(log: LLMLog): void {
    this.selectedLog = this.selectedLog?.id === log.id ? null : log;
  }

  clearAll(): void {
    if (!confirm('Supprimer tous les logs ?')) return;
    this.api.clearLogs().subscribe(() => { this.logs = []; this.selectedLog = null; });
  }

  formatJson(content: string | null): string {
    if (!content) return '';
    try { return JSON.stringify(JSON.parse(content), null, 2); }
    catch { return content; }
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleString('fr-FR');
  }

  typeLabel(t: string): string {
    return this.TYPE_LABELS[t] ?? t;
  }

  typeClass(t: string): string {
    return this.TYPE_CLASSES[t] ?? '';
  }
}
