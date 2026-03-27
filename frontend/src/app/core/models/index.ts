// ── PI & Iterations ───────────────────────────────────────────────────────────

/** Représente un Program Increment (PI) — unité de planification de 4 sprints. */
export interface PI {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  azdo_iteration_path: string | null;
  is_active: boolean;
  is_locked: boolean;
}

/** Itération Azure DevOps synchronisée (utilisée dans les paramètres / associations). */
export interface Iteration {
  id: number;
  azdo_id: string | null;
  name: string;
  path: string | null;
  start_date: string | null;
  end_date: string | null;
}

/** Métadonnées d'un sprint au sein d'un PI (dates calculées côté backend). */
export interface SprintIteration {
  id: number;
  name: string;
  sprint_number: number;
  start_date: string;
  end_date: string;
}

// ── Équipe ────────────────────────────────────────────────────────────────────

/** Membre de l'équipe GeoTrouvetou avec son profil et son identifiant Azure DevOps. */
export interface TeamMember {
  id: number;
  azdo_id: string | null;
  display_name: string;
  unique_name: string | null;
  profile: 'Dev' | 'QA' | 'PSM' | 'Squad Lead' | 'Automate';
  is_active: boolean;
}

// ── PI Planning — blocs & congés ─────────────────────────────────────────────

/** Bloc de capacité ou de story sur le planning d'un sprint. */
export interface PlanningBlock {
  id: number;
  pi_id: number;
  team_member_id: number;
  sprint_number: number;
  day_offset: number;        // jours ouvrés depuis le début du sprint (peut être décimal)
  start_date: string | null; // date calendaire indicative
  duration_days: number;
  category: BlockCategory;
  layer: number;
  is_auto_generated: boolean;
  is_locked: boolean;
  work_item_id: number | null;
  group_id: number | null;
  comment: string | null;
}

/** Absence / congé d'un membre sur un sprint, exprimé en day_offset. */
export interface Leave {
  id: number;
  pi_id: number;
  team_member_id: number;
  sprint_number: number;
  day_offset: number;
  duration_days: number;
  label: string | null;
}

/**
 * Catégories possibles pour un `PlanningBlock`.
 * Layer 1 = blocs fixes auto-générés ; Layer 2 = stories manuelles.
 */
export type BlockCategory =
  | 'stories_dev'
  | 'stories_qa'
  | 'bugs_maintenance'
  | 'imprevus'
  | 'agility'
  | 'reunions'
  | 'psm'
  | 'montee_competence'
  | 'conges';

/** Labels d'affichage correspondant à chaque `BlockCategory`. */
export const BLOCK_CATEGORY_LABELS: Record<BlockCategory, string> = {
  stories_dev: 'Stories Dev',
  stories_qa: 'Stories QA',
  bugs_maintenance: 'Bugs & Maintenances',
  imprevus: 'Imprévus',
  agility: 'Agility',
  reunions: 'Réunions',
  psm: 'PSM',
  montee_competence: 'Montée en compétence',
  conges: 'Congés / Absences',
};

// ── Azure DevOps — Work Items ─────────────────────────────────────────────────

/** Work Item Azure DevOps synchronisé localement (lecture seule). */
export interface WorkItem {
  id: number;
  type: string;
  title: string;
  state: string | null;
  iteration_path: string | null;
  assigned_to: string | null;
  description: string | null;
  acceptance_criteria: string | null;
  story_points: number | null;
  completed_work: number | null;
  remaining_work: number | null;
  parent_id: number | null;
  synced_at: string | null;
}

// ── PBR (Product Backlog Refinement) ─────────────────────────────────────────

/** Session de PBR regroupant des items à affiner et leurs votes. */
export interface PBRSession {
  id: number;
  name: string;
  date: string;
  is_active: boolean;
  pi_id: number | null;
  excluded_member_ids: number[];
}

/** Item (Enabler / Feature / Story) inscrit dans une session PBR. */
export interface PBRItem {
  id: number;
  session_id: number;
  work_item_id: number;
  action_plan: string | null;
  ia_dor_note: number | null;
  ia_comment: string | null;
  ia_analyzed_at: string | null;
  refinement_owner_id: number | null;
  is_deprioritized: boolean;
}

/** Vote individuel d'un membre sur un item lors d'une session PBR. */
export interface PBRVote {
  id: number;
  session_id: number;
  team_member_id: number;
  work_item_id: number;
  dor_compliant: boolean | null;
  comment: string | null;
  story_points: number | null;
  charge_dev_days: number | null;
  charge_qa_days: number | null;
}

// ── Paramètres & synchronisation ─────────────────────────────────────────────

/** Paire clé / valeur stockée dans la table `app_settings`. */
export interface AppSetting {
  key: string;
  value: string | null;
  description: string | null;
}

/** Résultat retourné après une synchronisation manuelle depuis Azure DevOps. */
export interface SyncResult {
  status: string;
  message: string;
  items_synced: number;
  counts: { iterations: number; members: number; work_items: number };
}

/** Entrée de journal d'une synchronisation Azure DevOps. */
export interface SyncLog {
  id: number;
  synced_at: string;
  status: 'success' | 'error';
  details: string | null;
  items_synced: number;
}

/** Résultat d'un test de connexion Azure DevOps. */
export interface ConnectionTestResult {
  ok: boolean;
  error: string | null;
  details: string | null;
}

// ── Suivi & KPIs ─────────────────────────────────────────────────────────────

/**
 * Capacité manuelle saisie (ou importée depuis le planning) pour un membre sur un sprint.
 * Toutes les valeurs sont en heures.
 */
export interface SprintCapacity {
  id?: number;
  pi_id: number;
  sprint_number: number;
  team_member_id: number;
  display_name?: string;
  profile?: string;
  capa_stories_h: number;
  capa_bugs_h: number;
  capa_imprevus_h: number;
  capa_agility_h: number;
  capa_reunions_h: number;
  capa_psm_h: number;
  capa_montee_h: number;
}

/** Tâche AZDO enrichie avec les informations parent / grand-parent pour le module Suivi. */
export interface SuiviTask {
  task_id: number;
  task_title: string;
  assigned_to: string | null;
  iteration_path: string | null;
  sprint_number: number | null;
  state: string | null;
  original_estimate: number | null;
  completed_work: number | null;
  remaining_work: number | null;
  parent_id: number | null;
  parent_title: string | null;
  parent_type: string | null;
  grandparent_id: number | null;
  grandparent_title: string | null;
  grandparent_type: string | null;
  task_category: 'stories' | 'bugs' | 'maintenance' | 'orphan';
  overrun: boolean;
}

/** KPIs capacité vs. réalisé par membre pour un sprint donné. */
export interface SprintMemberKpi {
  member_id: number;
  display_name: string;
  profile: string;
  capa_stories_h: number;
  capa_bugs_h: number;
  capa_imprevus_h: number;
  capa_psm_h: number;
  capa_total_h: number;
  work_stories_h: number;
  work_bugs_h: number;
  work_maint_h: number;
  work_orphan_h: number;
  work_total_h: number;
}

/** Vue d'ensemble KPIs d'un PI entier : agrégats capacité / réalisé et story points par état. */
export interface SuiviOverview {
  kpis: {
    capa_total_h: number;
    work_total_h: number;
    pct_capa: number | null;
    capa_imprevus_h: number;
    work_imprevus_h: number;
    capa_bugs_h: number;
    work_bugs_h: number;
    work_maint_h: number;
    capa_stories_h: number;
    work_stories_h: number;
  };
  story_points: {
    total: number;
    by_state: { state: string; points: number }[];
  };
  features: {
    id: number;
    title: string;
    type: string;
    state: string | null;
    business_value: number | null;
    effort: number | null;
  }[];
}

// ── KPI du Train ─────────────────────────────────────────────────────────────

/** Équipe du train (ensemble de repos AZDO) utilisée pour les KPIs de contribution. */
export interface TrainTeam {
  id: number;
  name: string;
  azdo_repos: string[];   // désérialisé depuis le JSON string backend
  branch_filter: string;
  color: string | null;
}

/** Entrée KPI d'une équipe pour un PI donné (métriques Git/AZDO). */
export interface TrainKpiEntry {
  id: number;
  pi_id: number;
  team_id: number;
  team: TrainTeam;
  capacity_days: number | null;
  lines_added: number;
  lines_deleted: number;
  commits_count: number;
  files_changed: number;
  is_partial: boolean;
  analyzed_at: string | null;
}

// ── Logs LLM ─────────────────────────────────────────────────────────────────

/** Entrée de journal traçant un appel LLM ou une récupération AZDO. */
export interface LLMLog {
  id: number;
  created_at: string;
  log_type: 'LLM_REQUEST' | 'LLM_RESPONSE' | 'AZDO_FETCH' | 'ERROR';
  work_item_id: number | null;
  session_id: number | null;
  summary: string | null;
  content: string | null;
  duration_ms: number | null;
}
