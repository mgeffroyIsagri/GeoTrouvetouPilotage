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
  PBRItem,
  PBRVote,
  AppSetting,
  SyncResult,
  SyncLog,
  ConnectionTestResult,
  LLMLog,
  SuiviTask,
  SprintMemberKpi,
  SuiviOverview,
  SprintCapacity,
} from '../models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly base = window.location.hostname === 'localhost'
    ? 'http://localhost:8002/api'
    : '/api';

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

  createBlockGroup(blocks: Partial<PlanningBlock>[]): Observable<PlanningBlock[]> {
    return this.http.post<PlanningBlock[]>(`${this.base}/planning/group`, { blocks });
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

  resetPI(piId: number, options: { leaves: boolean; stories: boolean; layer1: boolean }): Observable<void> {
    const params = new HttpParams()
      .set('reset_leaves', options.leaves ? 'true' : 'false')
      .set('reset_stories', options.stories ? 'true' : 'false')
      .set('reset_layer1', options.layer1 ? 'true' : 'false');
    return this.http.delete<void>(`${this.base}/planning/pi/${piId}/reset`, { params });
  }

  resetSprint(piId: number, sprint: number, options: { leaves: boolean; stories: boolean; layer1: boolean }): Observable<void> {
    const params = new HttpParams()
      .set('reset_leaves', options.leaves ? 'true' : 'false')
      .set('reset_stories', options.stories ? 'true' : 'false')
      .set('reset_layer1', options.layer1 ? 'true' : 'false');
    return this.http.delete<void>(`${this.base}/planning/pi/${piId}/sprint/${sprint}/reset`, { params });
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

  // --- PBR Sessions ---
  listPBRSessions(piId?: number): Observable<PBRSession[]> {
    let params = new HttpParams();
    if (piId !== undefined) params = params.set('pi_id', piId);
    return this.http.get<PBRSession[]>(`${this.base}/pbr/sessions`, { params });
  }

  createPBRSession(payload: Partial<PBRSession>): Observable<PBRSession> {
    return this.http.post<PBRSession>(`${this.base}/pbr/sessions`, payload);
  }

  deletePBRSession(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/pbr/sessions/${id}`);
  }

  activatePBRSession(id: number): Observable<PBRSession> {
    return this.http.put<PBRSession>(`${this.base}/pbr/sessions/${id}/activate`, {});
  }

  deactivatePBRSession(id: number): Observable<PBRSession> {
    return this.http.put<PBRSession>(`${this.base}/pbr/sessions/${id}/deactivate`, {});
  }

  // --- PBR Items ---
  getPBRItems(sessionId: number): Observable<PBRItem[]> {
    return this.http.get<PBRItem[]>(`${this.base}/pbr/sessions/${sessionId}/items`);
  }

  addPBRItem(sessionId: number, workItemId: number): Observable<PBRItem[]> {
    return this.http.post<PBRItem[]>(`${this.base}/pbr/sessions/${sessionId}/items`, { work_item_id: workItemId });
  }

  removePBRItem(itemId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/pbr/items/${itemId}`);
  }

  updatePBRItem(itemId: number, payload: Partial<PBRItem>): Observable<PBRItem> {
    return this.http.put<PBRItem>(`${this.base}/pbr/items/${itemId}`, payload);
  }

  analyzePBRItem(itemId: number): Observable<PBRItem> {
    return this.http.post<PBRItem>(`${this.base}/pbr/items/${itemId}/analyze`, {});
  }

  copyPBRSession(sessionId: number, payload: { name: string; date: string; pi_id: number | null }): Observable<PBRSession> {
    return this.http.post<PBRSession>(`${this.base}/pbr/sessions/${sessionId}/copy`, payload);
  }

  updateExcludedMembers(sessionId: number, excludedMemberIds: number[]): Observable<PBRSession> {
    return this.http.put<PBRSession>(`${this.base}/pbr/sessions/${sessionId}/excluded-members`, { excluded_member_ids: excludedMemberIds });
  }

  syncPBRItem(itemId: number): Observable<PBRItem[]> {
    return this.http.post<PBRItem[]>(`${this.base}/pbr/items/${itemId}/sync`, {});
  }

  // --- PBR Votes ---
  getVotes(sessionId: number): Observable<PBRVote[]> {
    return this.http.get<PBRVote[]>(`${this.base}/pbr/sessions/${sessionId}/votes`);
  }

  createVote(sessionId: number, payload: Partial<PBRVote>): Observable<PBRVote> {
    return this.http.post<PBRVote>(`${this.base}/pbr/sessions/${sessionId}/votes`, payload);
  }

  updateVote(voteId: number, payload: Partial<PBRVote>): Observable<PBRVote> {
    return this.http.put<PBRVote>(`${this.base}/pbr/votes/${voteId}`, payload);
  }

  deleteVote(voteId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/pbr/votes/${voteId}`);
  }

  // --- AZDO ---
  syncAzdo(fullSync = false, sinceDate?: string): Observable<SyncResult> {
    let params = new HttpParams().set('full_sync', fullSync ? 'true' : 'false');
    if (sinceDate) params = params.set('since_date', sinceDate);
    return this.http.post<SyncResult>(`${this.base}/azdo/sync`, {}, { params });
  }

  testAzdoConnection(): Observable<ConnectionTestResult> {
    return this.http.post<ConnectionTestResult>(`${this.base}/azdo/test-connection`, {});
  }

  getSyncLogs(): Observable<SyncLog[]> {
    return this.http.get<SyncLog[]>(`${this.base}/azdo/sync/logs`);
  }

  getWorkItemById(id: number): Observable<WorkItem> {
    return this.http.get<WorkItem>(`${this.base}/azdo/work-items/${id}`);
  }

  getWorkItems(params?: {
    type?: string;
    state?: string;
    search?: string;
    iteration_path?: string;
    skip?: number;
    limit?: number;
  }): Observable<WorkItem[]> {
    let httpParams = new HttpParams();
    if (params?.type) httpParams = httpParams.set('type', params.type);
    if (params?.state) httpParams = httpParams.set('state', params.state);
    if (params?.search) httpParams = httpParams.set('search', params.search);
    if (params?.iteration_path) httpParams = httpParams.set('iteration_path', params.iteration_path);
    if (params?.skip !== undefined) httpParams = httpParams.set('skip', params.skip);
    if (params?.limit !== undefined) httpParams = httpParams.set('limit', params.limit);
    return this.http.get<WorkItem[]>(`${this.base}/azdo/work-items`, { params: httpParams });
  }

  getWorkItemsCount(params?: { type?: string; state?: string; search?: string; iteration_path?: string }): Observable<{ count: number }> {
    let httpParams = new HttpParams();
    if (params?.type) httpParams = httpParams.set('type', params.type);
    if (params?.state) httpParams = httpParams.set('state', params.state);
    if (params?.search) httpParams = httpParams.set('search', params.search);
    if (params?.iteration_path) httpParams = httpParams.set('iteration_path', params.iteration_path);
    return this.http.get<{ count: number }>(`${this.base}/azdo/work-items/count`, { params: httpParams });
  }

  getIterations(): Observable<Iteration[]> {
    return this.http.get<Iteration[]>(`${this.base}/azdo/iterations`);
  }

  // --- Logs ---
  getLogs(params?: { log_type?: string; work_item_id?: number; session_id?: number; limit?: number }): Observable<LLMLog[]> {
    let httpParams = new HttpParams();
    if (params?.log_type) httpParams = httpParams.set('log_type', params.log_type);
    if (params?.work_item_id) httpParams = httpParams.set('work_item_id', params.work_item_id);
    if (params?.session_id) httpParams = httpParams.set('session_id', params.session_id);
    if (params?.limit) httpParams = httpParams.set('limit', params.limit);
    return this.http.get<LLMLog[]>(`${this.base}/logs/`, { params: httpParams });
  }

  clearLogs(): Observable<{ deleted: number }> {
    return this.http.delete<{ deleted: number }>(`${this.base}/logs/`);
  }

  // --- Suivi ---
  getAzdoIterationRoots(): Observable<string[]> {
    return this.http.get<string[]>(`${this.base}/suivi/azdo-iteration-roots`);
  }

  setPiAzdoPath(piId: number, path: string): Observable<{ id: number; azdo_iteration_path: string }> {
    return this.http.put<{ id: number; azdo_iteration_path: string }>(`${this.base}/suivi/pi/${piId}/azdo-path`, { azdo_iteration_path: path });
  }

  clearPiAzdoPath(piId: number): Observable<{ id: number; azdo_iteration_path: string | null }> {
    return this.http.delete<{ id: number; azdo_iteration_path: string | null }>(`${this.base}/suivi/pi/${piId}/azdo-path`);
  }

  getSprintCapacities(piId: number, sprintNum: number): Observable<SprintCapacity[]> {
    return this.http.get<SprintCapacity[]>(`${this.base}/suivi/pi/${piId}/sprint/${sprintNum}/capacities`);
  }

  saveSprintCapacities(piId: number, sprintNum: number, payload: SprintCapacity[]): Observable<SprintCapacity[]> {
    return this.http.put<SprintCapacity[]>(`${this.base}/suivi/pi/${piId}/sprint/${sprintNum}/capacities`, payload);
  }

  importCapacitiesFromPlanning(piId: number, sprintNum: number): Observable<SprintCapacity[]> {
    return this.http.post<SprintCapacity[]>(`${this.base}/suivi/pi/${piId}/sprint/${sprintNum}/capacities/import`, {});
  }

  resetSprintCapacities(piId: number, sprintNum: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/suivi/pi/${piId}/sprint/${sprintNum}/capacities`);
  }

  getSuiviTasks(piId: number, sprint?: number): Observable<SuiviTask[]> {
    let params = new HttpParams();
    if (sprint !== undefined) params = params.set('sprint', sprint);
    return this.http.get<SuiviTask[]>(`${this.base}/suivi/pi/${piId}/tasks`, { params });
  }

  getSprintKpis(piId: number, sprintNum: number): Observable<SprintMemberKpi[]> {
    return this.http.get<SprintMemberKpi[]>(`${this.base}/suivi/pi/${piId}/sprint/${sprintNum}/kpis`);
  }

  getSuiviOverview(piId: number): Observable<SuiviOverview> {
    return this.http.get<SuiviOverview>(`${this.base}/suivi/pi/${piId}/overview`);
  }

  analyzeProductivity(piId: number, sprintNum: number, memberId: number): Observable<{ analysis: string; member: string; sprint: string }> {
    return this.http.post<{ analysis: string; member: string; sprint: string }>(
      `${this.base}/suivi/pi/${piId}/sprint/${sprintNum}/analyze-member/${memberId}`, {}
    );
  }

  getLatestProductivityReport(piId: number, sprintNum: number, memberId: number): Observable<{ analysis: string; member: string; sprint: string; created_at: string }> {
    return this.http.get<{ analysis: string; member: string; sprint: string; created_at: string }>(
      `${this.base}/suivi/pi/${piId}/sprint/${sprintNum}/analyze-member/${memberId}/latest`
    );
  }

  // --- Settings ---
  getSettings(): Observable<AppSetting[]> {
    return this.http.get<AppSetting[]>(`${this.base}/settings/`);
  }

  updateSetting(key: string, value: string): Observable<AppSetting> {
    return this.http.put<AppSetting>(`${this.base}/settings/${key}`, { key, value });
  }
}
