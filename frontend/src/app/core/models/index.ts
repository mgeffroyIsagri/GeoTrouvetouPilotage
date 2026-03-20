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
  profile: 'Dev' | 'QA' | 'PSM';
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
  work_item_id: number | null;
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
}

export interface PBRVote {
  id: number;
  session_id: number;
  team_member_id: number;
  work_item_id: number;
  dor_note: number | null;
  comment: string | null;
  story_points: number | null;
  charge_dev_days: number | null;
  charge_qa_days: number | null;
  ia_dor_note: number | null;
  ia_comment: string | null;
  action_plan: string | null;
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
