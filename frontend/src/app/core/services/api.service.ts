import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  PI,
  TeamMember,
  PlanningBlock,
  Leave,
  SprintIteration,
  WorkItem,
  Iteration,
  PBRSession,
  PBRVote,
  AppSetting,
  SyncResult,
  SyncLog,
  ConnectionTestResult,
} from '../models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly base = 'http://localhost:8001/api';

  constructor(private http: HttpClient) {}

  // --- PI ---
  listPI(): Observable<PI[]> {
    return this.http.get<PI[]>(`${this.base}/pi/`);
  }

  createPI(payload: Partial<PI>): Observable<PI> {
    return this.http.post<PI>(`${this.base}/pi/`, payload);
  }

  activatePI(id: number): Observable<PI> {
    return this.http.put<PI>(`${this.base}/pi/${id}/activate`, {});
  }

  deletePI(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/pi/${id}`);
  }

  // --- Team Members ---
  listTeamMembers(): Observable<TeamMember[]> {
    return this.http.get<TeamMember[]>(`${this.base}/team-members/`);
  }

  createTeamMember(payload: Partial<TeamMember>): Observable<TeamMember> {
    return this.http.post<TeamMember>(`${this.base}/team-members/`, payload);
  }

  updateTeamMember(id: number, payload: Partial<TeamMember>): Observable<TeamMember> {
    return this.http.put<TeamMember>(`${this.base}/team-members/${id}`, payload);
  }

  // --- PI Planning ---
  getBlocksForPI(piId: number): Observable<PlanningBlock[]> {
    return this.http.get<PlanningBlock[]>(`${this.base}/planning/pi/${piId}`);
  }

  getBlocksForSprint(piId: number, sprint: number): Observable<PlanningBlock[]> {
    return this.http.get<PlanningBlock[]>(`${this.base}/planning/pi/${piId}/sprint/${sprint}`);
  }

  createBlock(payload: Partial<PlanningBlock>): Observable<PlanningBlock> {
    return this.http.post<PlanningBlock>(`${this.base}/planning/`, payload);
  }

  updateBlock(id: number, payload: Partial<PlanningBlock>): Observable<PlanningBlock> {
    return this.http.put<PlanningBlock>(`${this.base}/planning/${id}`, payload);
  }

  deleteBlock(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/planning/${id}`);
  }

  generatePlanning(piId: number): Observable<{ status: string; message: string }> {
    return this.http.post<{ status: string; message: string }>(`${this.base}/planning/pi/${piId}/generate`, {});
  }

  getIterationsForPI(piId: number): Observable<SprintIteration[]> {
    return this.http.get<SprintIteration[]>(`${this.base}/pi/${piId}/iterations`);
  }

  // --- Congés ---
  getLeavesForPI(piId: number): Observable<Leave[]> {
    return this.http.get<Leave[]>(`${this.base}/leaves/pi/${piId}`);
  }

  getLeavesForSprint(piId: number, sprint: number): Observable<Leave[]> {
    return this.http.get<Leave[]>(`${this.base}/leaves/pi/${piId}/sprint/${sprint}`);
  }

  createLeave(payload: Partial<Leave>): Observable<Leave> {
    return this.http.post<Leave>(`${this.base}/leaves/`, payload);
  }

  updateLeave(id: number, payload: Partial<Leave>): Observable<Leave> {
    return this.http.put<Leave>(`${this.base}/leaves/${id}`, payload);
  }

  deleteLeave(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/leaves/${id}`);
  }

  // --- PBR ---
  listPBRSessions(): Observable<PBRSession[]> {
    return this.http.get<PBRSession[]>(`${this.base}/pbr/sessions`);
  }

  createPBRSession(payload: Partial<PBRSession>): Observable<PBRSession> {
    return this.http.post<PBRSession>(`${this.base}/pbr/sessions`, payload);
  }

  getVotes(sessionId: number): Observable<PBRVote[]> {
    return this.http.get<PBRVote[]>(`${this.base}/pbr/sessions/${sessionId}/votes`);
  }

  createVote(payload: Partial<PBRVote>): Observable<PBRVote> {
    return this.http.post<PBRVote>(`${this.base}/pbr/votes`, payload);
  }

  // --- AZDO ---
  syncAzdo(): Observable<SyncResult> {
    return this.http.post<SyncResult>(`${this.base}/azdo/sync`, {});
  }

  testAzdoConnection(): Observable<ConnectionTestResult> {
    return this.http.post<ConnectionTestResult>(`${this.base}/azdo/test-connection`, {});
  }

  getSyncLogs(): Observable<SyncLog[]> {
    return this.http.get<SyncLog[]>(`${this.base}/azdo/sync/logs`);
  }

  getWorkItems(params?: {
    type?: string;
    state?: string;
    search?: string;
    skip?: number;
    limit?: number;
  }): Observable<WorkItem[]> {
    let httpParams = new HttpParams();
    if (params?.type) httpParams = httpParams.set('type', params.type);
    if (params?.state) httpParams = httpParams.set('state', params.state);
    if (params?.search) httpParams = httpParams.set('search', params.search);
    if (params?.skip !== undefined) httpParams = httpParams.set('skip', params.skip);
    if (params?.limit !== undefined) httpParams = httpParams.set('limit', params.limit);
    return this.http.get<WorkItem[]>(`${this.base}/azdo/work-items`, { params: httpParams });
  }

  getWorkItemsCount(): Observable<{ count: number }> {
    return this.http.get<{ count: number }>(`${this.base}/azdo/work-items/count`);
  }

  getIterations(): Observable<Iteration[]> {
    return this.http.get<Iteration[]>(`${this.base}/azdo/iterations`);
  }

  // --- Settings ---
  getSettings(): Observable<AppSetting[]> {
    return this.http.get<AppSetting[]>(`${this.base}/settings/`);
  }

  updateSetting(key: string, value: string): Observable<AppSetting> {
    return this.http.put<AppSetting>(`${this.base}/settings/${key}`, { key, value });
  }
}
