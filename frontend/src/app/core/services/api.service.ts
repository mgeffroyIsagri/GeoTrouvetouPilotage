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
  TrainTeam,
  TrainKpiEntry,
} from '../models';

/**
 * Service HTTP centralisé pour toutes les communications avec le backend FastAPI.
 * L'URL de base est résolue automatiquement : `localhost:8002` en développement, `/api` en production.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly base = window.location.hostname === 'localhost'
    ? 'http://localhost:8002/api'
    : '/api';

  constructor(private http: HttpClient) {}

  // ── PI ───────────────────────────────────────────────────────────────────────

  /** Retourne la liste de tous les PIs. */
  listPI(): Observable<PI[]> {
    return this.http.get<PI[]>(`${this.base}/pi/`);
  }

  /** Crée un nouveau PI. */
  createPI(payload: Partial<PI>): Observable<PI> {
    return this.http.post<PI>(`${this.base}/pi/`, payload);
  }

  /** Active le PI spécifié (désactive les autres). */
  activatePI(id: number): Observable<PI> {
    return this.http.put<PI>(`${this.base}/pi/${id}/activate`, {});
  }

  /** Verrouille le PI (lecture seule + panel admin accessible). */
  lockPI(id: number): Observable<PI> {
    return this.http.put<PI>(`${this.base}/pi/${id}/lock`, {});
  }

  /** Déverrouille le PI (planning redevient éditable). */
  unlockPI(id: number): Observable<PI> {
    return this.http.put<PI>(`${this.base}/pi/${id}/unlock`, {});
  }

  /** Supprime définitivement un PI et toutes ses données associées. */
  deletePI(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/pi/${id}`);
  }

  // ── Équipe ───────────────────────────────────────────────────────────────────

  /** Retourne la liste de tous les membres de l'équipe. */
  listTeamMembers(): Observable<TeamMember[]> {
    return this.http.get<TeamMember[]>(`${this.base}/team-members/`);
  }

  /** Crée un nouveau membre d'équipe. */
  createTeamMember(payload: Partial<TeamMember>): Observable<TeamMember> {
    return this.http.post<TeamMember>(`${this.base}/team-members/`, payload);
  }

  /** Met à jour les données d'un membre d'équipe existant. */
  updateTeamMember(id: number, payload: Partial<TeamMember>): Observable<TeamMember> {
    return this.http.put<TeamMember>(`${this.base}/team-members/${id}`, payload);
  }

  // ── PI Planning ──────────────────────────────────────────────────────────────

  /** Retourne tous les blocs de planning d'un PI (tous sprints confondus). */
  getBlocksForPI(piId: number): Observable<PlanningBlock[]> {
    return this.http.get<PlanningBlock[]>(`${this.base}/planning/pi/${piId}`);
  }

  /** Retourne les blocs de planning d'un sprint précis. */
  getBlocksForSprint(piId: number, sprint: number): Observable<PlanningBlock[]> {
    return this.http.get<PlanningBlock[]>(`${this.base}/planning/pi/${piId}/sprint/${sprint}`);
  }

  /** Crée un bloc de planning unique. */
  createBlock(payload: Partial<PlanningBlock>): Observable<PlanningBlock> {
    return this.http.post<PlanningBlock>(`${this.base}/planning/`, payload);
  }

  /** Crée un groupe de blocs liés en une seule requête. */
  createBlockGroup(blocks: Partial<PlanningBlock>[]): Observable<PlanningBlock[]> {
    return this.http.post<PlanningBlock[]>(`${this.base}/planning/group`, { blocks });
  }

  /** Met à jour un bloc de planning (position, durée, catégorie…). */
  updateBlock(id: number, payload: Partial<PlanningBlock>): Observable<PlanningBlock> {
    return this.http.put<PlanningBlock>(`${this.base}/planning/${id}`, payload);
  }

  /** Supprime un bloc de planning. */
  deleteBlock(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/planning/${id}`);
  }

  /** Déclenche la génération automatique des blocs Layer 1 pour un PI.
   *  `teamMemberId` et `sprintNumber` permettent de cibler un membre/sprint précis. */
  generatePlanning(piId: number, teamMemberId?: number | null, sprintNumber?: number | null): Observable<{ status: string; message: string }> {
    let params = new HttpParams();
    if (teamMemberId != null) params = params.set('team_member_id', teamMemberId);
    if (sprintNumber != null) params = params.set('sprint_number', sprintNumber);
    return this.http.post<{ status: string; message: string }>(`${this.base}/planning/pi/${piId}/generate`, {}, { params });
  }

  /** Réinitialise (supprime) les données d'un PI selon les options choisies. */
  resetPI(piId: number, options: { leaves: boolean; stories: boolean; layer1: boolean }, teamMemberId?: number | null): Observable<void> {
    let params = new HttpParams()
      .set('reset_leaves', options.leaves ? 'true' : 'false')
      .set('reset_stories', options.stories ? 'true' : 'false')
      .set('reset_layer1', options.layer1 ? 'true' : 'false');
    if (teamMemberId != null) params = params.set('team_member_id', teamMemberId);
    return this.http.delete<void>(`${this.base}/planning/pi/${piId}/reset`, { params });
  }

  /** Réinitialise les données d'un sprint précis selon les options choisies. */
  resetSprint(piId: number, sprint: number, options: { leaves: boolean; stories: boolean; layer1: boolean }, teamMemberId?: number | null): Observable<void> {
    let params = new HttpParams()
      .set('reset_leaves', options.leaves ? 'true' : 'false')
      .set('reset_stories', options.stories ? 'true' : 'false')
      .set('reset_layer1', options.layer1 ? 'true' : 'false');
    if (teamMemberId != null) params = params.set('team_member_id', teamMemberId);
    return this.http.delete<void>(`${this.base}/planning/pi/${piId}/sprint/${sprint}/reset`, { params });
  }

  /** Retourne les iterations (sprints) d'un PI avec leurs dates. */
  getIterationsForPI(piId: number): Observable<SprintIteration[]> {
    return this.http.get<SprintIteration[]>(`${this.base}/pi/${piId}/iterations`);
  }

  // ── Congés ───────────────────────────────────────────────────────────────────

  /** Retourne toutes les absences d'un PI. */
  getLeavesForPI(piId: number): Observable<Leave[]> {
    return this.http.get<Leave[]>(`${this.base}/leaves/pi/${piId}`);
  }

  /** Retourne les absences d'un sprint précis. */
  getLeavesForSprint(piId: number, sprint: number): Observable<Leave[]> {
    return this.http.get<Leave[]>(`${this.base}/leaves/pi/${piId}/sprint/${sprint}`);
  }

  /** Crée une absence pour un membre sur un sprint. */
  createLeave(payload: Partial<Leave>): Observable<Leave> {
    return this.http.post<Leave>(`${this.base}/leaves/`, payload);
  }

  /** Met à jour une absence existante. */
  updateLeave(id: number, payload: Partial<Leave>): Observable<Leave> {
    return this.http.put<Leave>(`${this.base}/leaves/${id}`, payload);
  }

  /** Supprime une absence. */
  deleteLeave(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/leaves/${id}`);
  }

  // ── PBR — Sessions ───────────────────────────────────────────────────────────

  /** Retourne la liste des sessions PBR, optionnellement filtrée par PI. */
  listPBRSessions(piId?: number): Observable<PBRSession[]> {
    let params = new HttpParams();
    if (piId !== undefined) params = params.set('pi_id', piId);
    return this.http.get<PBRSession[]>(`${this.base}/pbr/sessions`, { params });
  }

  /** Crée une nouvelle session PBR. */
  createPBRSession(payload: Partial<PBRSession>): Observable<PBRSession> {
    return this.http.post<PBRSession>(`${this.base}/pbr/sessions`, payload);
  }

  /** Supprime une session PBR et tous ses items / votes associés. */
  deletePBRSession(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/pbr/sessions/${id}`);
  }

  /** Marque une session PBR comme active (une seule active à la fois). */
  activatePBRSession(id: number): Observable<PBRSession> {
    return this.http.put<PBRSession>(`${this.base}/pbr/sessions/${id}/activate`, {});
  }

  /** Désactive une session PBR. */
  deactivatePBRSession(id: number): Observable<PBRSession> {
    return this.http.put<PBRSession>(`${this.base}/pbr/sessions/${id}/deactivate`, {});
  }

  // ── PBR — Items ──────────────────────────────────────────────────────────────

  /** Retourne les items inscrits dans une session PBR. */
  getPBRItems(sessionId: number): Observable<PBRItem[]> {
    return this.http.get<PBRItem[]>(`${this.base}/pbr/sessions/${sessionId}/items`);
  }

  /** Ajoute un work item à une session PBR (retourne la liste mise à jour). */
  addPBRItem(sessionId: number, workItemId: number): Observable<PBRItem[]> {
    return this.http.post<PBRItem[]>(`${this.base}/pbr/sessions/${sessionId}/items`, { work_item_id: workItemId });
  }

  /** Retire un item d'une session PBR. */
  removePBRItem(itemId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/pbr/items/${itemId}`);
  }

  /** Met à jour les champs éditables d'un item PBR (plan d'action, propriétaire…). */
  updatePBRItem(itemId: number, payload: Partial<PBRItem>): Observable<PBRItem> {
    return this.http.put<PBRItem>(`${this.base}/pbr/items/${itemId}`, payload);
  }

  /** Déclenche l'analyse DoR par le LLM pour un item PBR. */
  analyzePBRItem(itemId: number): Observable<PBRItem> {
    return this.http.post<PBRItem>(`${this.base}/pbr/items/${itemId}/analyze`, {});
  }

  /** Duplique une session PBR (sans votes, en conservant les métadonnées des items). */
  copyPBRSession(sessionId: number, payload: { name: string; date: string; pi_id: number | null }): Observable<PBRSession> {
    return this.http.post<PBRSession>(`${this.base}/pbr/sessions/${sessionId}/copy`, payload);
  }

  /** Met à jour la liste des membres exclus d'une session PBR. */
  updateExcludedMembers(sessionId: number, excludedMemberIds: number[]): Observable<PBRSession> {
    return this.http.put<PBRSession>(`${this.base}/pbr/sessions/${sessionId}/excluded-members`, { excluded_member_ids: excludedMemberIds });
  }

  /** Synchronise les stories enfants AZDO manquantes sous un Enabler / Feature. */
  syncPBRItem(itemId: number): Observable<PBRItem[]> {
    return this.http.post<PBRItem[]>(`${this.base}/pbr/items/${itemId}/sync`, {});
  }

  // ── PBR — Votes ──────────────────────────────────────────────────────────────

  /** Retourne tous les votes d'une session PBR. */
  getVotes(sessionId: number): Observable<PBRVote[]> {
    return this.http.get<PBRVote[]>(`${this.base}/pbr/sessions/${sessionId}/votes`);
  }

  /** Enregistre le vote d'un membre pour un item de la session. */
  createVote(sessionId: number, payload: Partial<PBRVote>): Observable<PBRVote> {
    return this.http.post<PBRVote>(`${this.base}/pbr/sessions/${sessionId}/votes`, payload);
  }

  /** Met à jour un vote existant. */
  updateVote(voteId: number, payload: Partial<PBRVote>): Observable<PBRVote> {
    return this.http.put<PBRVote>(`${this.base}/pbr/votes/${voteId}`, payload);
  }

  /** Supprime un vote. */
  deleteVote(voteId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/pbr/votes/${voteId}`);
  }

  // ── Azure DevOps ─────────────────────────────────────────────────────────────

  /**
   * Déclenche une synchronisation depuis Azure DevOps.
   * @param fullSync Si `true`, re-synchronise tous les éléments ; sinon, uniquement depuis `sinceDate`.
   * @param sinceDate Date ISO optionnelle pour la synchronisation incrémentale.
   */
  syncAzdo(fullSync = false, sinceDate?: string): Observable<SyncResult> {
    let params = new HttpParams().set('full_sync', fullSync ? 'true' : 'false');
    if (sinceDate) params = params.set('since_date', sinceDate);
    return this.http.post<SyncResult>(`${this.base}/azdo/sync`, {}, { params });
  }

  /** Teste la connexion Azure DevOps avec les paramètres courants. */
  testAzdoConnection(): Observable<ConnectionTestResult> {
    return this.http.post<ConnectionTestResult>(`${this.base}/azdo/test-connection`, {});
  }

  /** Retourne l'historique des synchronisations AZDO. */
  getSyncLogs(): Observable<SyncLog[]> {
    return this.http.get<SyncLog[]>(`${this.base}/azdo/sync/logs`);
  }

  /** Retourne un work item par son identifiant. */
  getWorkItemById(id: number): Observable<WorkItem> {
    return this.http.get<WorkItem>(`${this.base}/azdo/work-items/${id}`);
  }

  /**
   * Retourne une liste paginée de work items avec filtres optionnels.
   * Les IDs peuvent être passés sous forme de tableau ; ils seront joints par virgule.
   */
  getWorkItems(params?: {
    type?: string;
    state?: string;
    search?: string;
    iteration_path?: string;
    ids?: number[];
    skip?: number;
    limit?: number;
  }): Observable<WorkItem[]> {
    let httpParams = new HttpParams();
    if (params?.type) httpParams = httpParams.set('type', params.type);
    if (params?.state) httpParams = httpParams.set('state', params.state);
    if (params?.search) httpParams = httpParams.set('search', params.search);
    if (params?.iteration_path) httpParams = httpParams.set('iteration_path', params.iteration_path);
    if (params?.ids?.length) httpParams = httpParams.set('ids', params.ids.join(','));
    if (params?.skip !== undefined) httpParams = httpParams.set('skip', params.skip);
    if (params?.limit !== undefined) httpParams = httpParams.set('limit', params.limit);
    return this.http.get<WorkItem[]>(`${this.base}/azdo/work-items`, { params: httpParams });
  }

  /** Retourne le nombre de work items correspondant aux filtres (sans charger les données). */
  getWorkItemsCount(params?: { type?: string; state?: string; search?: string; iteration_path?: string }): Observable<{ count: number }> {
    let httpParams = new HttpParams();
    if (params?.type) httpParams = httpParams.set('type', params.type);
    if (params?.state) httpParams = httpParams.set('state', params.state);
    if (params?.search) httpParams = httpParams.set('search', params.search);
    if (params?.iteration_path) httpParams = httpParams.set('iteration_path', params.iteration_path);
    return this.http.get<{ count: number }>(`${this.base}/azdo/work-items/count`, { params: httpParams });
  }

  /** Retourne les itérations AZDO synchronisées. */
  getIterations(): Observable<Iteration[]> {
    return this.http.get<Iteration[]>(`${this.base}/azdo/iterations`);
  }

  // ── Logs LLM ─────────────────────────────────────────────────────────────────

  /** Retourne les entrées du journal LLM / AZDO selon les filtres optionnels. */
  getLogs(params?: { log_type?: string; work_item_id?: number; session_id?: number; limit?: number }): Observable<LLMLog[]> {
    let httpParams = new HttpParams();
    if (params?.log_type) httpParams = httpParams.set('log_type', params.log_type);
    if (params?.work_item_id) httpParams = httpParams.set('work_item_id', params.work_item_id);
    if (params?.session_id) httpParams = httpParams.set('session_id', params.session_id);
    if (params?.limit) httpParams = httpParams.set('limit', params.limit);
    return this.http.get<LLMLog[]>(`${this.base}/logs/`, { params: httpParams });
  }

  /** Supprime toutes les entrées du journal et retourne le nombre de lignes effacées. */
  clearLogs(): Observable<{ deleted: number }> {
    return this.http.delete<{ deleted: number }>(`${this.base}/logs/`);
  }

  // ── Suivi & KPIs ─────────────────────────────────────────────────────────────

  /** Retourne les chemins racines d'itération AZDO disponibles pour le mapping PI. */
  getAzdoIterationRoots(): Observable<string[]> {
    return this.http.get<string[]>(`${this.base}/suivi/azdo-iteration-roots`);
  }

  /** Associe un chemin d'itération AZDO à un PI pour le suivi. */
  setPiAzdoPath(piId: number, path: string): Observable<{ id: number; azdo_iteration_path: string }> {
    return this.http.put<{ id: number; azdo_iteration_path: string }>(`${this.base}/suivi/pi/${piId}/azdo-path`, { azdo_iteration_path: path });
  }

  /** Supprime l'association entre un PI et un chemin d'itération AZDO. */
  clearPiAzdoPath(piId: number): Observable<{ id: number; azdo_iteration_path: string | null }> {
    return this.http.delete<{ id: number; azdo_iteration_path: string | null }>(`${this.base}/suivi/pi/${piId}/azdo-path`);
  }

  /** Retourne les capacités manuelles enregistrées pour un sprint. */
  getSprintCapacities(piId: number, sprintNum: number): Observable<SprintCapacity[]> {
    return this.http.get<SprintCapacity[]>(`${this.base}/suivi/pi/${piId}/sprint/${sprintNum}/capacities`);
  }

  /** Sauvegarde (upsert) les capacités manuelles d'un sprint. */
  saveSprintCapacities(piId: number, sprintNum: number, payload: SprintCapacity[]): Observable<SprintCapacity[]> {
    return this.http.put<SprintCapacity[]>(`${this.base}/suivi/pi/${piId}/sprint/${sprintNum}/capacities`, payload);
  }

  /** Importe les capacités depuis les blocs Layer 1 du planning pour un sprint. */
  importCapacitiesFromPlanning(piId: number, sprintNum: number): Observable<SprintCapacity[]> {
    return this.http.post<SprintCapacity[]>(`${this.base}/suivi/pi/${piId}/sprint/${sprintNum}/capacities/import`, {});
  }

  /** Supprime les capacités manuelles enregistrées pour un sprint. */
  resetSprintCapacities(piId: number, sprintNum: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/suivi/pi/${piId}/sprint/${sprintNum}/capacities`);
  }

  /** Retourne les stories planifiées (Layer 2) d'un sprint, groupées par Feature/Enabler parent. */
  getPlannedStories(piId: number, sprintNum: number): Observable<any> {
    return this.http.get<any>(`${this.base}/suivi/pi/${piId}/sprint/${sprintNum}/planned-stories`);
  }

  /** Retourne les tâches AZDO d'un PI enrichies des données parent/grand-parent, optionnellement filtrées par sprint. */
  getSuiviTasks(piId: number, sprint?: number): Observable<SuiviTask[]> {
    let params = new HttpParams();
    if (sprint !== undefined) params = params.set('sprint', sprint);
    return this.http.get<SuiviTask[]>(`${this.base}/suivi/pi/${piId}/tasks`, { params });
  }

  /** Retourne les KPIs capacité vs. réalisé par membre pour un sprint. */
  getSprintKpis(piId: number, sprintNum: number): Observable<SprintMemberKpi[]> {
    return this.http.get<SprintMemberKpi[]>(`${this.base}/suivi/pi/${piId}/sprint/${sprintNum}/kpis`);
  }

  /** Retourne la vue d'ensemble KPIs du PI (agrégats + story points par état). */
  getSuiviOverview(piId: number): Observable<SuiviOverview> {
    return this.http.get<SuiviOverview>(`${this.base}/suivi/pi/${piId}/overview`);
  }

  /** Déclenche l'analyse LLM de productivité d'un membre sur un sprint et sauvegarde le rapport. */
  analyzeProductivity(piId: number, sprintNum: number, memberId: number): Observable<{ analysis: string; member: string; sprint: string }> {
    return this.http.post<{ analysis: string; member: string; sprint: string }>(
      `${this.base}/suivi/pi/${piId}/sprint/${sprintNum}/analyze-member/${memberId}`, {}
    );
  }

  /** Retourne le dernier rapport de productivité LLM enregistré pour un membre / sprint. */
  getLatestProductivityReport(piId: number, sprintNum: number, memberId: number): Observable<{ analysis: string; member: string; sprint: string; created_at: string }> {
    return this.http.get<{ analysis: string; member: string; sprint: string; created_at: string }>(
      `${this.base}/suivi/pi/${piId}/sprint/${sprintNum}/analyze-member/${memberId}/latest`
    );
  }

  // ── KPI du Train ─────────────────────────────────────────────────────────────

  /** Retourne la liste de toutes les équipes du train configurées. */
  getTrainTeams(): Observable<TrainTeam[]> {
    return this.http.get<TrainTeam[]>(`${this.base}/train-kpi/teams`);
  }

  /** Crée une nouvelle équipe du train. */
  createTrainTeam(payload: Partial<TrainTeam>): Observable<TrainTeam> {
    return this.http.post<TrainTeam>(`${this.base}/train-kpi/teams`, payload);
  }

  /** Met à jour une équipe du train existante. */
  updateTrainTeam(id: number, payload: Partial<TrainTeam>): Observable<TrainTeam> {
    return this.http.put<TrainTeam>(`${this.base}/train-kpi/teams/${id}`, payload);
  }

  /** Supprime une équipe du train. */
  deleteTrainTeam(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/train-kpi/teams/${id}`);
  }

  /** Retourne les entrées KPI du train pour un PI donné. */
  getTrainKpiForPi(piId: number): Observable<TrainKpiEntry[]> {
    return this.http.get<TrainKpiEntry[]>(`${this.base}/train-kpi/pi/${piId}`);
  }

  /** Met à jour la capacité en jours d'une équipe pour un PI. */
  updateTrainKpiCapacity(piId: number, teamId: number, capacityDays: number): Observable<TrainKpiEntry> {
    return this.http.put<TrainKpiEntry>(
      `${this.base}/train-kpi/pi/${piId}/team/${teamId}/capacity`,
      { capacity_days: capacityDays }
    );
  }

  /** Déclenche l'analyse KPI du train pour toutes les équipes d'un PI. */
  analyzeTrainKpi(piId: number): Observable<TrainKpiEntry[]> {
    return this.http.post<TrainKpiEntry[]>(`${this.base}/train-kpi/pi/${piId}/analyze`, {});
  }

  /** Déclenche l'analyse KPI du train pour une équipe précise d'un PI (synchrone). */
  analyzeTrainKpiForTeam(piId: number, teamId: number): Observable<TrainKpiEntry> {
    return this.http.post<TrainKpiEntry>(
      `${this.base}/train-kpi/pi/${piId}/team/${teamId}/analyze`, {}
    );
  }

  /**
   * Démarre l'analyse en tâche de fond et retourne immédiatement un job_id.
   * Utiliser ensuite ``getTrainKpiJobProgress(jobId)`` pour suivre l'avancement.
   */
  analyzeTrainKpiForTeamAsync(piId: number, teamId: number): Observable<{ job_id: string }> {
    return this.http.post<{ job_id: string }>(
      `${this.base}/train-kpi/pi/${piId}/team/${teamId}/analyze-async`, {}
    );
  }

  /** Interroge l'état d'avancement d'un job d'analyse asynchrone (polling). */
  getTrainKpiJobProgress(jobId: string): Observable<{
    status: 'running' | 'done' | 'error';
    team_name: string;
    current_commit: number;
    total_commits: number;
    current_repo: string;
    result: TrainKpiEntry | null;
    error: string | null;
  }> {
    return this.http.get<any>(`${this.base}/train-kpi/jobs/${jobId}`);
  }

  // ── Paramètres ───────────────────────────────────────────────────────────────

  /** Retourne toutes les paires clé / valeur de configuration. */
  getSettings(): Observable<AppSetting[]> {
    return this.http.get<AppSetting[]>(`${this.base}/settings/`);
  }

  /** Met à jour la valeur d'une clé de configuration. */
  updateSetting(key: string, value: string): Observable<AppSetting> {
    return this.http.put<AppSetting>(`${this.base}/settings/${key}`, { key, value });
  }
}
