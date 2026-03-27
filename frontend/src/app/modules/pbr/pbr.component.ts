import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { PI, TeamMember, WorkItem, PBRSession, PBRItem, PBRVote, AppSetting } from '../../core/models';

/**
 * Représente l'état d'édition local d'un vote pour un membre/work item donné.
 * Cet objet est manipulé dans l'éditMap avant d'être persisté via l'API.
 */
interface VoteEdit {
  dor_compliant: boolean | null;
  comment: string | null;
  story_points: number | null;
  charge_dev_days: number | null;
  charge_qa_days: number | null;
}

/**
 * Composant PBR (Product Backlog Refinement).
 *
 * Gère les sessions de refinement : liste des sessions, sélection, création,
 * copie, suppression, et pour chaque session : les sujets (items) à raffiner,
 * les votes DoR des membres, l'analyse IA et les plans d'action.
 *
 * Structure des items :
 * - depth=0 : parents (Feature / Enabler) ou items racines sans parent dans la session
 * - depth=1 : stories enfants dont le parent est également présent dans la session
 *
 * Les votes sont stockés localement dans `editMap` (clé `${workItemId}_${memberId}`)
 * avant d'être persistés. La map `workItemsMap` associe chaque ID AZDO au WorkItem
 * correspondant, chargé à la demande.
 */
@Component({
  selector: 'app-pbr',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './pbr.component.html',
  styleUrl: './pbr.component.scss',
})
export class PbrComponent implements OnInit {
  // ── Données de référence ──────────────────────────────────

  /** Liste de tous les PIs disponibles pour le filtre de sessions. */
  piList: PI[] = [];

  /** Toutes les sessions PBR chargées au démarrage. */
  sessions: PBRSession[] = [];

  /** Liste complète des membres de l'équipe. */
  teamMembers: TeamMember[] = [];

  /** Cache AZDO ID → WorkItem, alimenté à la demande lors du chargement des items. */
  workItemsMap = new Map<number, WorkItem>();

  /** Paramètres applicatifs (AZDO org/project pour la construction des URLs). */
  settings: AppSetting[] = [];

  // ── Session sélectionnée ──────────────────────────────────

  /** Session actuellement affichée dans le panneau de détail. */
  selectedSession: PBRSession | null = null;

  /** Items (sujets) de la session sélectionnée. */
  items: PBRItem[] = [];

  /** Votes de la session sélectionnée, tous membres confondus. */
  votes: PBRVote[] = [];

  // ── Filtre PI ─────────────────────────────────────────────

  /** Identifiant du PI sélectionné pour filtrer la liste des sessions (`null` = tous). */
  filterPiId: number | null = null;

  // ── Formulaire de création de session ─────────────────────

  /** Contrôle la visibilité du formulaire de création. */
  showCreateForm = false;

  /** Données du formulaire de création. */
  newSession = { name: '', pi_id: null as number | null, date: '' };

  /** Message d'erreur affiché sous le formulaire de création. */
  createError = '';

  // ── Ajout d'un sujet (item) ───────────────────────────────

  /** ID AZDO saisi dans le champ d'ajout de sujet. */
  addingItemId = '';

  /** Message d'erreur affiché lors de l'ajout d'un item. */
  addItemError = '';

  // ── Édition des votes ─────────────────────────────────────

  /**
   * Map des votes en cours d'édition.
   * Clé : `${workItemId}_${teamMemberId}`.
   * Initialisée à partir des votes existants, puis modifiée en temps réel.
   */
  editMap = new Map<string, VoteEdit>();

  // ── Plan d'action ─────────────────────────────────────────

  /** Map item.id → texte du plan d'action (édition locale avant sauvegarde). */
  actionPlanMap = new Map<number, string>();

  // ── États UI ──────────────────────────────────────────────

  /** ID de l'item dont l'analyse IA est en cours (null si aucun). */
  analyzingItemId: number | null = null;

  /** ID de l'item dont la synchronisation des stories enfants est en cours. */
  syncingItemId: number | null = null;

  /** Ensemble des IDs d'items dont le panneau enfant est déplié. */
  expandedItems = new Set<number>();

  // ── Copie de session ──────────────────────────────────────

  /** Contrôle la visibilité du formulaire de copie. */
  showCopyForm = false;

  /** Session source à partir de laquelle la copie est effectuée. */
  copySourceSession: PBRSession | null = null;

  /** Données du formulaire de copie. */
  copySession = { name: '', pi_id: null as number | null, date: '' };

  /** Message d'erreur affiché lors de la copie. */
  copyError = '';

  constructor(private api: ApiService) {}

  // ── Initialisation ────────────────────────────────────────

  /**
   * Charge en parallèle les PIs, membres, sessions et paramètres.
   * Sélectionne automatiquement la session active si elle existe.
   */
  ngOnInit(): void {
    forkJoin({
      pi: this.api.listPI(),
      members: this.api.listTeamMembers(),
      sessions: this.api.listPBRSessions(),
      settings: this.api.getSettings(),
    }).subscribe(({ pi, members, sessions, settings }) => {
      this.piList = pi;
      this.teamMembers = members;
      this.sessions = sessions;
      this.settings = settings;
      const active = sessions.find((s) => s.is_active);
      if (active) this.selectSession(active);
    });
  }

  // ── AZDO URL ──────────────────────────────────────────────

  /**
   * Construit l'URL directe vers un work item Azure DevOps.
   * Retourne `null` si l'organisation ou le projet n'est pas configuré.
   * @param workItemId Identifiant numérique du work item AZDO.
   */
  azdoUrl(workItemId: number): string | null {
    const org = this.settings.find((s) => s.key === 'azdo_organization')?.value;
    const project = this.settings.find((s) => s.key === 'azdo_project')?.value;
    if (!org || !project) return null;
    const cleanOrg = org.replace(/^https?:\/\/dev\.azure\.com\//, '').replace(/\/$/, '');
    return `https://dev.azure.com/${cleanOrg}/${encodeURIComponent(project)}/_workitems/edit/${workItemId}`;
  }

  // ── Filtrage ─────────────────────────────────────────────

  /**
   * Sessions filtrées selon le PI sélectionné.
   * Retourne toutes les sessions si `filterPiId` est null.
   */
  get filteredSessions(): PBRSession[] {
    if (this.filterPiId === null) return this.sessions;
    return this.sessions.filter((s) => s.pi_id === this.filterPiId);
  }

  /**
   * Retourne le nom lisible d'un PI à partir de son identifiant.
   * @param piId Identifiant du PI, ou null pour les sessions sans PI.
   */
  piName(piId: number | null): string {
    if (piId === null) return 'Sans PI';
    return this.piList.find((p) => p.id === piId)?.name ?? `PI #${piId}`;
  }

  // ── Sessions ─────────────────────────────────────────────

  /**
   * Sélectionne une session et charge ses items, votes et work items associés.
   * Réinitialise toutes les maps d'état local (votes, plans d'action, items dépliés).
   * @param session Session à sélectionner.
   */
  selectSession(session: PBRSession): void {
    this.selectedSession = session;
    this.items = [];
    this.votes = [];
    this.editMap.clear();
    this.actionPlanMap.clear();
    this.expandedItems.clear();

    forkJoin({
      items: this.api.getPBRItems(session.id),
      votes: this.api.getVotes(session.id),
    }).subscribe(({ items, votes }) => {
      this.items = items;
      this.votes = votes;
      this.initActionPlanMap();
      this.initEditMap();
      this.loadWorkItems();
    });
  }

  /**
   * Bascule l'état actif/inactif d'une session.
   * Une seule session peut être active à la fois ; les autres sont désactivées.
   * @param session Session à activer ou désactiver.
   * @param event Événement souris (stopPropagation pour éviter la sélection).
   */
  activateSession(session: PBRSession, event: MouseEvent): void {
    event.stopPropagation();
    const action = session.is_active
      ? this.api.deactivatePBRSession(session.id)
      : this.api.activatePBRSession(session.id);
    action.subscribe((updated) => {
      this.sessions = this.sessions.map((s) => ({
        ...s,
        is_active: s.id === session.id ? updated.is_active : (session.is_active ? false : s.is_active),
      }));
      if (this.selectedSession?.id === session.id) {
        this.selectedSession = updated;
      }
    });
  }

  /**
   * Supprime une session après confirmation.
   * Désélectionne la session si elle était sélectionnée.
   * @param session Session à supprimer.
   * @param event Événement souris (stopPropagation).
   */
  deleteSession(session: PBRSession, event: MouseEvent): void {
    event.stopPropagation();
    if (!confirm(`Supprimer la session "${session.name}" et tous ses votes ?`)) return;
    this.api.deletePBRSession(session.id).subscribe(() => {
      this.sessions = this.sessions.filter((s) => s.id !== session.id);
      if (this.selectedSession?.id === session.id) {
        this.selectedSession = null;
        this.items = [];
        this.votes = [];
      }
    });
  }

  /**
   * Ouvre le formulaire de création en pré-remplissant la date et le PI courant.
   */
  openCreateForm(): void {
    const today = new Date().toISOString().slice(0, 16);
    this.newSession = { name: '', pi_id: this.filterPiId, date: today };
    this.createError = '';
    this.showCreateForm = true;
  }

  /**
   * Valide et soumet le formulaire de création de session.
   * En cas de succès, ajoute la nouvelle session en tête de liste et la sélectionne.
   */
  submitCreateSession(): void {
    this.createError = '';
    if (!this.newSession.name.trim()) { this.createError = 'Le nom est requis.'; return; }
    if (!this.newSession.date) { this.createError = 'La date est requise.'; return; }
    this.api.createPBRSession({
      name: this.newSession.name.trim(),
      date: new Date(this.newSession.date).toISOString(),
      pi_id: this.newSession.pi_id,
    }).subscribe({
      next: (s) => {
        this.sessions = [s, ...this.sessions];
        this.showCreateForm = false;
        this.selectSession(s);
      },
      error: (err) => { this.createError = err.error?.detail ?? 'Erreur lors de la création'; },
    });
  }

  // ── Items ─────────────────────────────────────────────────

  /**
   * Charge dans `workItemsMap` les WorkItems manquants pour les items de la session.
   * Les items déjà présents en cache ne sont pas rechargés.
   */
  private loadWorkItems(): void {
    const ids = this.items.map((i) => i.work_item_id);
    if (!ids.length) return;
    ids.forEach((id) => {
      if (!this.workItemsMap.has(id)) {
        this.api.getWorkItemById(id).subscribe((wi) => this.workItemsMap.set(id, wi));
      }
    });
  }

  /**
   * Charge un WorkItem individuel dans le cache s'il n'y est pas encore.
   * @param id Identifiant AZDO du work item.
   */
  private fetchWorkItem(id: number): void {
    if (!this.workItemsMap.has(id)) {
      this.api.getWorkItemById(id).subscribe((wi) => this.workItemsMap.set(id, wi));
    }
  }

  /**
   * Retourne le WorkItem depuis le cache, ou null s'il n'est pas encore chargé.
   * @param workItemId Identifiant AZDO du work item.
   */
  getWorkItem(workItemId: number): WorkItem | null {
    return this.workItemsMap.get(workItemId) ?? null;
  }

  /**
   * Bascule l'état déplié/replié du panneau enfants d'un item.
   * @param item Item à déplier ou replier.
   */
  toggleItem(item: PBRItem): void {
    if (this.expandedItems.has(item.id)) {
      this.expandedItems.delete(item.id);
    } else {
      this.expandedItems.add(item.id);
    }
  }

  /**
   * Ajoute un work item (et ses éventuels enfants AZDO) à la session courante
   * à partir de l'ID saisi dans le champ `addingItemId`.
   * Le premier item ajouté (parent) est automatiquement déplié.
   */
  addItem(): void {
    this.addItemError = '';
    const id = parseInt(this.addingItemId, 10);
    if (isNaN(id)) { this.addItemError = 'ID invalide.'; return; }
    if (!this.selectedSession) return;
    this.api.addPBRItem(this.selectedSession.id, id).subscribe({
      next: (newItems) => {
        this.items.push(...newItems);
        this.addingItemId = '';
        // Expand only the first (parent) item
        if (newItems.length > 0) this.expandedItems.add(newItems[0].id);
        // Load all work items
        newItems.forEach((item) => this.fetchWorkItem(item.work_item_id));
      },
      error: (err) => { this.addItemError = err.error?.detail ?? 'Erreur lors de l\'ajout'; },
    });
  }

  /**
   * Retire un item de la session après confirmation.
   * Supprime également les votes associés au work item.
   * @param item Item à retirer.
   */
  removeItem(item: PBRItem): void {
    if (!confirm(`Retirer le work item #${item.work_item_id} de la session (et ses votes) ?`)) return;
    this.api.removePBRItem(item.id).subscribe(() => {
      this.items = this.items.filter((i) => i.id !== item.id);
      this.votes = this.votes.filter((v) => v.work_item_id !== item.work_item_id);
      this.expandedItems.delete(item.id);
    });
  }

  // ── Copie de session ───────────────────────────────────────

  /**
   * Ouvre le formulaire de copie en pré-remplissant les champs depuis la session source.
   * Les votes ne sont pas copiés ; les champs action_plan, responsable et déprioritisation le sont.
   * @param session Session à copier.
   * @param event Événement souris (stopPropagation).
   */
  openCopyForm(session: PBRSession, event: MouseEvent): void {
    event.stopPropagation();
    this.copySourceSession = session;
    const today = new Date().toISOString().slice(0, 16);
    this.copySession = { name: `Copie de ${session.name}`, pi_id: session.pi_id, date: today };
    this.copyError = '';
    this.showCopyForm = true;
  }

  /**
   * Valide et soumet la copie de session.
   * En cas de succès, ajoute la copie en tête de liste et la sélectionne.
   */
  submitCopySession(): void {
    this.copyError = '';
    if (!this.copySession.name.trim()) { this.copyError = 'Le nom est requis.'; return; }
    if (!this.copySession.date) { this.copyError = 'La date est requise.'; return; }
    if (!this.copySourceSession) return;
    this.api.copyPBRSession(this.copySourceSession.id, {
      name: this.copySession.name.trim(),
      date: new Date(this.copySession.date).toISOString(),
      pi_id: this.copySession.pi_id,
    }).subscribe({
      next: (s) => {
        this.sessions = [s, ...this.sessions];
        this.showCopyForm = false;
        this.copySourceSession = null;
        this.selectSession(s);
      },
      error: (err) => { this.copyError = err.error?.detail ?? 'Erreur lors de la copie'; },
    });
  }

  // ── Synchronisation enfants ────────────────────────────────

  /**
   * Déclenche la synchronisation des stories enfants d'un item depuis AZDO.
   * Les nouvelles stories trouvées sont ajoutées à la session.
   * Un message est affiché si aucune nouvelle story n'est trouvée.
   * @param item Item parent à synchroniser.
   * @param event Événement souris (stopPropagation).
   */
  syncItem(item: PBRItem, event: MouseEvent): void {
    event.stopPropagation();
    this.syncingItemId = item.id;
    this.api.syncPBRItem(item.id).subscribe({
      next: (newItems) => {
        this.items.push(...newItems);
        newItems.forEach((i) => this.fetchWorkItem(i.work_item_id));
        this.syncingItemId = null;
        if (newItems.length === 0) alert('Aucune nouvelle story enfant trouvée.');
      },
      error: (err) => {
        alert(err.error?.detail ?? 'Erreur lors de la synchronisation');
        this.syncingItemId = null;
      },
    });
  }

  // ── Déprioritisation ──────────────────────────────────────

  /**
   * Bascule l'état déprioritisé d'un item parent.
   * Les items enfants héritent visuellement de cet état côté template.
   * @param item Item à (dé)prioriser.
   * @param event Événement souris (stopPropagation).
   */
  toggleDeprioritized(item: PBRItem, event: MouseEvent): void {
    event.stopPropagation();
    this.api.updatePBRItem(item.id, { is_deprioritized: !item.is_deprioritized }).subscribe((updated) => {
      this.items = this.items.map((i) => i.id === item.id ? updated : i);
    });
  }

  /**
   * Indique si un work item est déprioritisé, soit directement,
   * soit parce que son parent dans la session l'est.
   * @param workItemId Identifiant AZDO du work item à vérifier.
   */
  isDeprioritized(workItemId: number): boolean {
    // Un item est "déprioritisé" si lui-même ou son parent dans la session l'est
    const item = this.items.find((i) => i.work_item_id === workItemId);
    if (item?.is_deprioritized) return true;
    const wi = this.workItemsMap.get(workItemId);
    if (wi?.parent_id) {
      const parentItem = this.items.find((i) => i.work_item_id === wi.parent_id);
      if (parentItem?.is_deprioritized) return true;
    }
    return false;
  }

  // ── Responsable refinement ────────────────────────────────

  /**
   * Sauvegarde le responsable de refinement d'un item parent.
   * @param item Item pour lequel définir le responsable.
   * @param ownerId Identifiant du membre responsable, ou null pour le retirer.
   */
  saveRefinementOwner(item: PBRItem, ownerId: number | null): void {
    this.api.updatePBRItem(item.id, { refinement_owner_id: ownerId }).subscribe((updated) => {
      this.items = this.items.map((i) => i.id === item.id ? updated : i);
    });
  }

  /**
   * Membres éligibles comme responsables de refinement (Dev, QA, PSM actifs).
   * Exclut les profils Squad Lead et Automate.
   */
  get refinementMembers(): TeamMember[] {
    return this.teamMembers.filter((m) => ['Dev', 'QA', 'PSM'].includes(m.profile) && m.is_active);
  }

  // ── Analyse IA ────────────────────────────────────────────

  /**
   * Déclenche l'analyse DoR par IA pour un item.
   * L'API récupère le work item AZDO, l'envoie au LLM et retourne une note et un commentaire.
   * Détecte automatiquement si l'item est une story ou un enabler/feature.
   * @param item Item à analyser.
   */
  analyzeItem(item: PBRItem): void {
    this.analyzingItemId = item.id;
    this.api.analyzePBRItem(item.id).subscribe({
      next: (updated) => {
        this.items = this.items.map((i) => i.id === item.id ? updated : i);
        this.analyzingItemId = null;
      },
      error: (err) => {
        alert(err.error?.detail ?? 'Erreur lors de l\'analyse IA');
        this.analyzingItemId = null;
      },
    });
  }

  // ── Votes ─────────────────────────────────────────────────

  /**
   * Construit la clé composite utilisée dans `editMap`.
   * @param workItemId Identifiant AZDO du work item.
   * @param memberId Identifiant du membre votant.
   */
  private voteKey(workItemId: number, memberId: number): string {
    return `${workItemId}_${memberId}`;
  }

  /**
   * Initialise `editMap` à partir des votes existants chargés depuis l'API.
   * Appelé après chaque chargement de session.
   */
  private initEditMap(): void {
    for (const v of this.votes) {
      const key = this.voteKey(v.work_item_id, v.team_member_id);
      this.editMap.set(key, {
        dor_compliant: v.dor_compliant,
        comment: v.comment,
        story_points: v.story_points,
        charge_dev_days: v.charge_dev_days,
        charge_qa_days: v.charge_qa_days,
      });
    }
  }

  /**
   * Retourne l'objet d'édition d'un vote, en le créant vide si absent.
   * @param workItemId Identifiant AZDO du work item.
   * @param memberId Identifiant du membre votant.
   */
  getEdit(workItemId: number, memberId: number): VoteEdit {
    const key = this.voteKey(workItemId, memberId);
    if (!this.editMap.has(key)) {
      this.editMap.set(key, { dor_compliant: null, comment: null, story_points: null, charge_dev_days: null, charge_qa_days: null });
    }
    return this.editMap.get(key)!;
  }

  /**
   * Retourne le vote persisté pour un couple work item / membre, ou null.
   * @param workItemId Identifiant AZDO du work item.
   * @param memberId Identifiant du membre votant.
   */
  getVote(workItemId: number, memberId: number): PBRVote | null {
    return this.votes.find((v) => v.work_item_id === workItemId && v.team_member_id === memberId) ?? null;
  }

  /**
   * Persiste le vote d'un membre pour un work item.
   * Crée un nouveau vote si aucun n'existe encore, sinon met à jour l'existant.
   * @param workItemId Identifiant AZDO du work item.
   * @param memberId Identifiant du membre votant.
   */
  saveVote(workItemId: number, memberId: number): void {
    if (!this.selectedSession) return;
    const edit = this.getEdit(workItemId, memberId);
    const existing = this.getVote(workItemId, memberId);

    if (existing) {
      this.api.updateVote(existing.id, edit).subscribe((updated) => {
        this.votes = this.votes.map((v) => v.id === existing.id ? updated : v);
      });
    } else {
      this.api.createVote(this.selectedSession!.id, {
        team_member_id: memberId,
        work_item_id: workItemId,
        ...edit,
      }).subscribe((created) => {
        this.votes.push(created);
      });
    }
  }

  /**
   * Retourne tous les votes persistés pour un work item donné.
   * @param workItemId Identifiant AZDO du work item.
   */
  getItemVotes(workItemId: number): PBRVote[] {
    return this.votes.filter((v) => v.work_item_id === workItemId);
  }

  /**
   * Calcule les statistiques DoR à partir de l'état courant de l'`editMap`
   * (inclut les votes non encore sauvegardés).
   * Retourne null si aucun membre n'a encore voté.
   * @param workItemId Identifiant AZDO du work item.
   */
  dorStats(workItemId: number): { yes: number; no: number; total: number } | null {
    const members = this.sessionMembers;
    const voted = members.filter((m) => {
      const edit = this.editMap.get(this.voteKey(workItemId, m.id));
      return edit?.dor_compliant !== null && edit?.dor_compliant !== undefined;
    });
    if (!voted.length) return null;
    const yes = voted.filter((m) => {
      const edit = this.editMap.get(this.voteKey(workItemId, m.id));
      return edit?.dor_compliant === true;
    }).length;
    return { yes, no: voted.length - yes, total: voted.length };
  }

  /**
   * Tous les membres actifs pouvant voter (Dev, QA, PSM).
   * Ne tient pas compte des exclusions de session.
   */
  get dorMembers(): TeamMember[] {
    return this.teamMembers.filter((m) => ['Dev', 'QA', 'PSM'].includes(m.profile) && m.is_active);
  }

  /**
   * Membres participant effectivement aux votes de la session courante.
   * Exclut les membres listés dans `excluded_member_ids` de la session.
   */
  get sessionMembers(): TeamMember[] {
    const excluded = new Set(this.selectedSession?.excluded_member_ids ?? []);
    return this.dorMembers.filter((m) => !excluded.has(m.id));
  }

  /**
   * Bascule l'exclusion d'un membre pour la session courante.
   * Persiste immédiatement la liste des membres exclus via l'API.
   * @param member Membre à inclure ou exclure.
   */
  toggleMemberExclusion(member: TeamMember): void {
    if (!this.selectedSession) return;
    const excluded = new Set(this.selectedSession.excluded_member_ids ?? []);
    if (excluded.has(member.id)) {
      excluded.delete(member.id);
    } else {
      excluded.add(member.id);
    }
    const ids = [...excluded];
    this.api.updateExcludedMembers(this.selectedSession.id, ids).subscribe((updated) => {
      this.sessions = this.sessions.map((s) => s.id === updated.id ? updated : s);
      this.selectedSession = updated;
    });
  }

  /**
   * Indique si un membre est exclu de la session courante.
   * @param memberId Identifiant du membre à vérifier.
   */
  isMemberExcluded(memberId: number): boolean {
    return this.selectedSession?.excluded_member_ids?.includes(memberId) ?? false;
  }

  /**
   * Retourne le nom d'affichage d'un membre à partir de son identifiant.
   * @param memberId Identifiant du membre.
   */
  memberName(memberId: number): string {
    return this.teamMembers.find((m) => m.id === memberId)?.display_name ?? `#${memberId}`;
  }

  // ── Plan d'action ─────────────────────────────────────────

  /**
   * Initialise `actionPlanMap` à partir des plans d'action existants des items chargés.
   * Appelé après chaque chargement de session.
   */
  private initActionPlanMap(): void {
    for (const item of this.items) {
      if (item.action_plan) this.actionPlanMap.set(item.id, item.action_plan);
    }
  }

  /**
   * Retourne le plan d'action local en cours d'édition pour un item.
   * @param item Item dont on veut lire le plan d'action.
   */
  getActionPlan(item: PBRItem): string {
    return this.actionPlanMap.get(item.id) ?? '';
  }

  /**
   * Persiste le plan d'action de l'item via l'API.
   * @param item Item pour lequel sauvegarder le plan d'action.
   */
  saveActionPlan(item: PBRItem): void {
    const plan = this.actionPlanMap.get(item.id) ?? null;
    this.api.updatePBRItem(item.id, { action_plan: plan }).subscribe((updated) => {
      this.items = this.items.map((i) => i.id === item.id ? updated : i);
    });
  }

  /**
   * Indique si au moins un membre a voté "Non conforme" pour un work item.
   * @param workItemId Identifiant AZDO du work item.
   */
  isNonDor(workItemId: number): boolean {
    const stats = this.dorStats(workItemId);
    return stats !== null && stats.no > 0;
  }

  // ── Groupement parent / enfants ───────────────────────────

  /**
   * Retourne la liste aplatie des items ordonnés hiérarchiquement.
   * Chaque entrée porte un `depth` : 0 = parent/racine, 1 = enfant.
   *
   * Algorithme :
   * 1. Les parents sont les items dont le parent AZDO n'est pas dans la session.
   * 2. Pour chaque parent, on insère ses enfants (depth=1) juste après.
   * 3. Les items dont le WorkItem n'est pas encore chargé sont mis en fin (depth=0).
   */
  get groupedItems(): { item: PBRItem; depth: number }[] {
    const sessionIds = new Set(this.items.map((i) => i.work_item_id));
    const result: { item: PBRItem; depth: number }[] = [];

    // Parents = items dont le parent n'est pas dans la session
    const parents = this.items.filter((i) => {
      const wi = this.workItemsMap.get(i.work_item_id);
      return !wi?.parent_id || !sessionIds.has(wi.parent_id);
    });

    for (const parent of parents) {
      result.push({ item: parent, depth: 0 });
      const children = this.items.filter((i) => {
        const wi = this.workItemsMap.get(i.work_item_id);
        return wi?.parent_id === parent.work_item_id;
      });
      for (const child of children) {
        result.push({ item: child, depth: 1 });
      }
    }

    // Orphelins non encore classés (workItemsMap pas encore chargée)
    const placed = new Set(result.map((r) => r.item.id));
    for (const item of this.items) {
      if (!placed.has(item.id)) result.push({ item, depth: 0 });
    }

    return result;
  }

  /**
   * Indique si l'item à la position `index` dans `groupedItems` est le dernier
   * enfant de son groupe parent (utilisé pour le rendu des séparateurs).
   * @param index Index dans la liste `groupedItems`.
   */
  isLastChildOfParent(index: number): boolean {
    const list = this.groupedItems;
    if (list[index]?.depth !== 1) return false;
    return !list[index + 1] || list[index + 1].depth === 0;
  }

  // ── Helpers template ──────────────────────────────────────

  /**
   * Types de work items considérés comme parents (non-stories).
   * Utilisé pour distinguer Features/Enablers des stories dans l'affichage.
   */
  readonly PARENT_TYPES = new Set(['Feature', 'Enabler']);

  /**
   * Indique si un work item est de type parent (Feature ou Enabler).
   * @param workItemId Identifiant AZDO du work item.
   */
  isParentType(workItemId: number): boolean {
    const wi = this.workItemsMap.get(workItemId);
    return wi ? this.PARENT_TYPES.has(wi.type) : false;
  }

  /** Plage de valeurs DoR disponibles pour les votes (1 à 5). */
  readonly DOR_RANGE = [1, 2, 3, 4, 5];

  /** Fonction de tracking par `id` pour les `*ngFor` sur des objets avec ID. */
  trackById(_: number, item: { id: number }): number { return item.id; }

  /** Fonction de tracking par `id` de membre pour les `*ngFor` sur `TeamMember`. */
  trackByMemberId(_: number, m: TeamMember): number { return m.id; }

  // ── Synthèse session ──────────────────────────────────────

  /**
   * Calcule les statistiques globales de la session courante.
   * Retourne null si aucune session n'est sélectionnée ou si elle est vide.
   *
   * Champs :
   * - `total` : nombre total d'items
   * - `parents` : Features/Enablers
   * - `stories` : stories (non-parents)
   * - `dorOk` : stories avec 100 % de votes "Conforme"
   * - `dorTotal` : stories ayant au moins un vote
   * - `analyzed` : items avec une note IA
   * - `deprio` : items déprioritisés
   * - `ownersAssigned` / `ownersTotal` : responsables assignés sur les parents
   */
  get sessionStats(): {
    total: number;
    parents: number;
    stories: number;
    dorOk: number;
    dorTotal: number;
    analyzed: number;
    deprio: number;
    ownersAssigned: number;
    ownersTotal: number;
  } | null {
    if (!this.selectedSession || !this.items.length) return null;

    const parents = this.items.filter((i) => this.isParentType(i.work_item_id));
    const stories = this.items.filter((i) => !this.isParentType(i.work_item_id));

    const dorOk = stories.filter((i) => {
      const stats = this.dorStats(i.work_item_id);
      return stats !== null && stats.no === 0 && stats.yes > 0 && stats.yes === stats.total;
    }).length;

    const dorVoted = stories.filter((i) => this.dorStats(i.work_item_id) !== null).length;

    return {
      total: this.items.length,
      parents: parents.length,
      stories: stories.length,
      dorOk,
      dorTotal: dorVoted,
      analyzed: this.items.filter((i) => i.ia_dor_note !== null).length,
      deprio: this.items.filter((i) => i.is_deprioritized).length,
      ownersAssigned: parents.filter((i) => i.refinement_owner_id !== null).length,
      ownersTotal: parents.length,
    };
  }
}
