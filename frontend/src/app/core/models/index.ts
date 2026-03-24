export interface PI {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  azdo_iteration_path: string | null;
  is_active: boolean;
}

export interface TeamMember {
  id: number;
  azdo_id: string | null;
  display_name: string;
  unique_name: string | null;
  profile: 'Dev' | 'QA' | 'PSM' | 'Squad Lead' | 'Automate';
  is_active: boolean;
}

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
}

export interface Leave {
  id: number;
  pi_id: number;
  team_member_id: number;
  sprint_number: number;
  day_offset: number;
  duration_days: number;
  label: string | null;
}

export interface SprintIteration {
  id: number;
  name: string;
  sprint_number: number;
  start_date: string;
  end_date: string;
}

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

export interface Iteration {
  id: number;
  azdo_id: string | null;
  name: string;
  path: string | null;
  start_date: string | null;
  end_date: string | null;
}

export interface PBRSession {
  id: number;
  name: string;
  date: string;
  is_active: boolean;
  pi_id: number | null;
  excluded_member_ids: number[];
}

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

export interface AppSetting {
  key: string;
  value: string | null;
  description: string | null;
}

export interface SyncResult {
  status: string;
  message: string;
  items_synced: number;
  counts: { iterations: number; members: number; work_items: number };
}

export interface SyncLog {
  id: number;
  synced_at: string;
  status: 'success' | 'error';
  details: string | null;
  items_synced: number;
}

export interface ConnectionTestResult {
  ok: boolean;
  error: string | null;
  details: string | null;
}

// ── Suivi & KPIs ─────────────────────────────────────────────────────────────

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
