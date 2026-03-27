"""
Endpoints Suivi & KPIs — agrège capacité PI Planning vs travail réalisé (AZDO Tasks).

Conventions :
- Capacité en heures = duration_days × 8
- "Tasks" = work items de type 'Task'
- Catégorie d'une tâche déduite du type du parent :
    User Story  → stories
    Bug         → bugs
    autre type  → maintenance
    sans parent → orphan (imprévus)
"""

import html as html_module
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.database import get_db
from app.models.pi import PI
from app.models.iteration import Iteration
from app.models.pi_planning import PlanningBlock
from app.models.work_item import WorkItem
from app.models.team_member import TeamMember
from app.models.llm_log import LLMLog
from app.models.sprint_capacity import SprintCapacity

from pydantic import BaseModel

router = APIRouter()

# ── Constantes de conversion et de catégorisation ────────────────────────────

HOURS_PER_DAY = 8.0  # Conversion jours → heures pour les blocs PI Planning

# Groupes de catégories pour le calcul des KPIs agrégés
STORY_CATEGORIES  = {"stories_dev", "stories_qa"}
BUGS_CATEGORIES   = {"bugs_maintenance"}
IMPREV_CATEGORIES = {"imprevus"}


class AzdoPathUpdate(BaseModel):
    """Payload pour associer un chemin d'itération AZDO à un PI."""

    azdo_iteration_path: str


class CapacityInput(BaseModel):
    """Capacité saisie manuellement pour un membre sur un sprint (en heures)."""

    team_member_id: int
    capa_stories_h: float = 0.0
    capa_bugs_h: float = 0.0
    capa_imprevus_h: float = 0.0
    capa_agility_h: float = 0.0
    capa_reunions_h: float = 0.0
    capa_psm_h: float = 0.0
    capa_montee_h: float = 0.0


# Mapping catégorie PlanningBlock → champ SprintCapacity
_PLANNING_TO_CAPACITY: dict[str, str] = {
    "stories_dev":       "capa_stories_h",
    "stories_qa":        "capa_stories_h",
    "bugs_maintenance":  "capa_bugs_h",
    "imprevus":          "capa_imprevus_h",
    "agility":           "capa_agility_h",
    "reunions":          "capa_reunions_h",
    "psm":               "capa_psm_h",
    "montee_competence": "capa_montee_h",
}

_CAPACITY_FIELDS = [
    "capa_stories_h", "capa_bugs_h", "capa_imprevus_h",
    "capa_agility_h", "capa_reunions_h", "capa_psm_h", "capa_montee_h",
]


@router.get("/azdo-iteration-roots")
def list_azdo_roots(db: Session = Depends(get_db)):
    """Retourne les préfixes d'itérations AZDO disponibles (pour lier un PI)."""
    rows = (
        db.query(Iteration.path)
        .filter(Iteration.pi_id == None, Iteration.path.isnot(None))  # noqa: E711
        .distinct()
        .all()
    )
    prefixes: set[str] = set()
    for (path,) in rows:
        parts = path.split("\\")
        if len(parts) >= 4:
            prefixes.add("\\".join(parts[:4]))
        elif len(parts) >= 3:
            prefixes.add("\\".join(parts[:3]))
    return sorted(prefixes)


@router.put("/pi/{pi_id}/azdo-path")
def set_pi_azdo_path(pi_id: int, payload: AzdoPathUpdate, db: Session = Depends(get_db)):
    """Associe un chemin d'itération AZDO à un PI."""
    pi = db.query(PI).filter(PI.id == pi_id).first()
    if not pi:
        raise HTTPException(status_code=404, detail="PI non trouvé")
    pi.azdo_iteration_path = payload.azdo_iteration_path
    db.commit()
    db.refresh(pi)
    return {"id": pi.id, "name": pi.name, "azdo_iteration_path": pi.azdo_iteration_path}


@router.delete("/pi/{pi_id}/azdo-path")
def clear_pi_azdo_path(pi_id: int, db: Session = Depends(get_db)):
    """Dissocie le chemin d'itération AZDO d'un PI."""
    pi = db.query(PI).filter(PI.id == pi_id).first()
    if not pi:
        raise HTTPException(status_code=404, detail="PI non trouvé")
    pi.azdo_iteration_path = None
    db.commit()
    db.refresh(pi)
    return {"id": pi.id, "name": pi.name, "azdo_iteration_path": pi.azdo_iteration_path}


def _get_pi_or_404(pi_id: int, db: Session) -> PI:
    """Retourne le PI ou lève une HTTPException 404 s'il est introuvable."""
    pi = db.query(PI).filter(PI.id == pi_id).first()
    if not pi:
        raise HTTPException(status_code=404, detail="PI non trouvé")
    return pi


def _pi_iteration_paths(pi_id: int, db: Session) -> dict[str, int]:
    """
    Retourne {iteration_path: sprint_number} pour toutes les itérations du PI.
    Utilise azdo_iteration_path du PI pour trouver les itérations AZDO correspondantes.
    Sprint_number déduit du dernier segment du path (Sprint 1/2/3/4).
    """
    pi = db.query(PI).filter(PI.id == pi_id).first()
    if not pi or not pi.azdo_iteration_path:
        return {}

    rows = (
        db.query(Iteration.path)
        .filter(Iteration.path.like(pi.azdo_iteration_path + "%"))
        .all()
    )

    result: dict[str, int] = {}
    for (path,) in rows:
        if not path:
            continue
        # Déduit le numéro de sprint depuis le dernier segment du path
        last = path.split("\\")[-1].lower()
        sprint_num = None
        for n in (1, 2, 3, 4):
            if str(n) in last:
                sprint_num = n
                break
        if sprint_num is None:
            sprint_num = 4  # IP sprint ou autre → sprint 4
        result[path] = sprint_num
    return result


_STORY_PARENT_TYPES = {"User Story", "Enabler Story", "Maintenance"}


def _task_category(parent_type: str | None) -> str:
    """Déduit la catégorie KPI d'une Task en fonction du type de son parent.

    Returns:
        ``"stories"``     si le parent est User Story, Enabler Story ou Maintenance.
        ``"bugs"``        si le parent est un Bug.
        ``"maintenance"`` pour tout autre type de parent.
        ``"orphan"``      si la tâche n'a pas de parent (imprévus).
    """
    if parent_type is None:
        return "orphan"
    if parent_type in _STORY_PARENT_TYPES:
        return "stories"
    if parent_type == "Bug":
        return "bugs"
    return "maintenance"


# ── Onglet Général — tableau des tâches ──────────────────────────────────────

@router.get("/pi/{pi_id}/tasks")
def get_tasks(pi_id: int, sprint: int | None = None, db: Session = Depends(get_db)):
    """
    Retourne toutes les Tasks du PI avec leur titre parent.
    Si sprint est fourni, filtre sur ce sprint uniquement.
    """
    _get_pi_or_404(pi_id, db)
    path_map = _pi_iteration_paths(pi_id, db)
    if not path_map:
        return []

    # Filtrage par sprint si demandé
    if sprint is not None:
        paths = [p for p, s in path_map.items() if s == sprint]
    else:
        paths = list(path_map.keys())

    if not paths:
        return []

    # Récupère toutes les Tasks dans ces itérations
    tasks = (
        db.query(WorkItem)
        .filter(WorkItem.type == "Task", WorkItem.iteration_path.in_(paths))
        .order_by(WorkItem.parent_id, WorkItem.id)
        .all()
    )

    # Charge les parents nécessaires
    parent_ids = {t.parent_id for t in tasks if t.parent_id}
    parents = {wi.id: wi for wi in db.query(WorkItem).filter(WorkItem.id.in_(parent_ids)).all()} if parent_ids else {}

    # Charge les grands-parents (Feature/Enabler) nécessaires
    grandparent_ids = {p.parent_id for p in parents.values() if p.parent_id}
    grandparents = {wi.id: wi for wi in db.query(WorkItem).filter(WorkItem.id.in_(grandparent_ids)).all()} if grandparent_ids else {}

    result = []
    for t in tasks:
        parent = parents.get(t.parent_id) if t.parent_id else None
        grandparent = grandparents.get(parent.parent_id) if parent and parent.parent_id else None
        result.append({
            "task_id": t.id,
            "task_title": t.title,
            "assigned_to": t.assigned_to,
            "iteration_path": t.iteration_path,
            "sprint_number": path_map.get(t.iteration_path),
            "state": t.state,
            "original_estimate": t.original_estimate,
            "completed_work": t.completed_work,
            "remaining_work": t.remaining_work,
            "parent_id": t.parent_id,
            "parent_title": parent.title if parent else None,
            "parent_type": parent.type if parent else None,
            "grandparent_id": parent.parent_id if parent else None,
            "grandparent_title": grandparent.title if grandparent else None,
            "grandparent_type": grandparent.type if grandparent else None,
            "task_category": _task_category(parent.type if parent else None),
            "overrun": (
                (t.completed_work or 0) > (t.original_estimate or 0)
                if t.original_estimate
                else False
            ),
        })
    return result


# ── Capacités par sprint ─────────────────────────────────────────────────────


def _capacities_as_list(
    pi_id: int, sprint_num: int, db: Session
) -> list[dict]:
    """
    Retourne les capacités du sprint pour tous les membres actifs.
    Les membres sans entrée en base ont des valeurs à 0.
    """
    members = (
        db.query(TeamMember)
        .filter(TeamMember.is_active == True)
        .order_by(TeamMember.display_name)
        .all()
    )
    sc_by_member = {
        sc.team_member_id: sc
        for sc in db.query(SprintCapacity).filter(
            SprintCapacity.pi_id == pi_id,
            SprintCapacity.sprint_number == sprint_num,
        ).all()
    }

    result = []
    for m in members:
        sc = sc_by_member.get(m.id)
        result.append({
            "id": sc.id if sc else None,
            "pi_id": pi_id,
            "sprint_number": sprint_num,
            "team_member_id": m.id,
            "display_name": m.display_name,
            "profile": m.profile,
            **{f: (getattr(sc, f) if sc else 0.0) for f in _CAPACITY_FIELDS},
        })
    return result


@router.get("/pi/{pi_id}/sprint/{sprint_num}/capacities")
def get_sprint_capacities(pi_id: int, sprint_num: int, db: Session = Depends(get_db)):
    """Retourne les capacités saisies pour ce sprint."""
    _get_pi_or_404(pi_id, db)
    return _capacities_as_list(pi_id, sprint_num, db)


@router.put("/pi/{pi_id}/sprint/{sprint_num}/capacities")
def save_sprint_capacities(
    pi_id: int, sprint_num: int, payload: list[CapacityInput], db: Session = Depends(get_db)
):
    """Upsert des capacités pour un sprint (une entrée par membre)."""
    _get_pi_or_404(pi_id, db)
    for item in payload:
        existing = (
            db.query(SprintCapacity)
            .filter(
                SprintCapacity.pi_id == pi_id,
                SprintCapacity.sprint_number == sprint_num,
                SprintCapacity.team_member_id == item.team_member_id,
            )
            .first()
        )
        if existing:
            for f in _CAPACITY_FIELDS:
                setattr(existing, f, getattr(item, f))
        else:
            db.add(SprintCapacity(
                pi_id=pi_id,
                sprint_number=sprint_num,
                **item.model_dump(),
            ))
    db.commit()
    return _capacities_as_list(pi_id, sprint_num, db)


@router.post("/pi/{pi_id}/sprint/{sprint_num}/capacities/import")
def import_capacities_from_planning(
    pi_id: int, sprint_num: int, db: Session = Depends(get_db)
):
    """Importe les capacités depuis les blocs PI Planning (toutes les couches)."""
    _get_pi_or_404(pi_id, db)

    # Supprime les capacités existantes pour ce sprint
    db.query(SprintCapacity).filter(
        SprintCapacity.pi_id == pi_id,
        SprintCapacity.sprint_number == sprint_num,
    ).delete()

    # Agrège les blocs PI Planning par membre
    blocks = (
        db.query(PlanningBlock)
        .filter(
            PlanningBlock.pi_id == pi_id,
            PlanningBlock.sprint_number == sprint_num,
        )
        .all()
    )

    agg: dict[int, dict[str, float]] = {}
    for b in blocks:
        mid = b.team_member_id
        if mid not in agg:
            agg[mid] = {f: 0.0 for f in _CAPACITY_FIELDS}
        field = _PLANNING_TO_CAPACITY.get(b.category)
        if field:
            agg[mid][field] += b.duration_days * HOURS_PER_DAY

    for mid, capa in agg.items():
        db.add(SprintCapacity(pi_id=pi_id, sprint_number=sprint_num, team_member_id=mid, **capa))

    db.commit()
    return _capacities_as_list(pi_id, sprint_num, db)


@router.delete("/pi/{pi_id}/sprint/{sprint_num}/capacities")
def reset_sprint_capacities(pi_id: int, sprint_num: int, db: Session = Depends(get_db)):
    """Supprime toutes les capacités saisies pour ce sprint."""
    _get_pi_or_404(pi_id, db)
    db.query(SprintCapacity).filter(
        SprintCapacity.pi_id == pi_id,
        SprintCapacity.sprint_number == sprint_num,
    ).delete()
    db.commit()
    return {"deleted": True}


# ── Onglet SPn — KPIs par sprint par membre ──────────────────────────────────

@router.get("/pi/{pi_id}/sprint/{sprint_num}/kpis")
def get_sprint_kpis(pi_id: int, sprint_num: int, db: Session = Depends(get_db)):
    """
    Retourne pour chaque membre actif :
    - Capacité par catégorie (depuis planning_blocks Layer 1)
    - Travail réalisé par catégorie (depuis Tasks AZDO)
    """
    _get_pi_or_404(pi_id, db)
    path_map = _pi_iteration_paths(pi_id, db)
    sprint_paths = [p for p, s in path_map.items() if s == sprint_num]

    members = db.query(TeamMember).filter(TeamMember.is_active == True).all()
    member_index = {m.id: m for m in members}

    # ── Capacités : SprintCapacity en priorité, sinon PlanningBlocks Layer 1 ─
    sc_rows = db.query(SprintCapacity).filter(
        SprintCapacity.pi_id == pi_id,
        SprintCapacity.sprint_number == sprint_num,
    ).all()

    # Convertit SprintCapacity en dict[member_id → dict[category → h]]
    capa: dict[int, dict[str, float]] = {}
    if sc_rows:
        for sc in sc_rows:
            capa[sc.team_member_id] = {
                "stories_dev":       sc.capa_stories_h,  # total stories dans une seule clé
                "bugs_maintenance":  sc.capa_bugs_h,
                "imprevus":          sc.capa_imprevus_h,
                "agility":           sc.capa_agility_h,
                "reunions":          sc.capa_reunions_h,
                "psm":               sc.capa_psm_h,
                "montee_competence": sc.capa_montee_h,
            }
    else:
        # Fallback : planning_blocks Layer 1
        blocks = (
            db.query(PlanningBlock)
            .filter(
                PlanningBlock.pi_id == pi_id,
                PlanningBlock.sprint_number == sprint_num,
                PlanningBlock.layer == 1,
            )
            .all()
        )
        for b in blocks:
            mid = b.team_member_id
            if mid not in capa:
                capa[mid] = {}
            capa[mid][b.category] = capa[mid].get(b.category, 0.0) + b.duration_days * HOURS_PER_DAY

    # ── Travail réalisé depuis Tasks ─────────────────────────────────────────
    if sprint_paths:
        tasks = (
            db.query(WorkItem)
            .filter(WorkItem.type == "Task", WorkItem.iteration_path.in_(sprint_paths))
            .all()
        )
    else:
        tasks = []

    parent_ids = {t.parent_id for t in tasks if t.parent_id}
    parents = {wi.id: wi for wi in db.query(WorkItem).filter(WorkItem.id.in_(parent_ids)).all()} if parent_ids else {}

    # Normalise les noms pour matcher avec TeamMember.display_name
    member_by_name = {m.display_name.strip().lower(): m for m in members}

    work: dict[int, dict[str, float]] = {}
    for t in tasks:
        name_key = (t.assigned_to or "").strip().lower()
        member = member_by_name.get(name_key)
        if not member:
            continue
        mid = member.id
        parent = parents.get(t.parent_id) if t.parent_id else None
        cat = _task_category(parent.type if parent else None)
        if mid not in work:
            work[mid] = {}
        work[mid][cat] = work[mid].get(cat, 0.0) + (t.completed_work or 0.0)

    # ── Assemble par membre ──────────────────────────────────────────────────
    result = []
    for m in members:
        mid = m.id
        mc = capa.get(mid, {})
        mw = work.get(mid, {})

        # stories_dev contient le total stories (qu'on vienne de SprintCapacity ou PlanningBlocks)
        capa_stories  = sum(mc.get(c, 0.0) for c in STORY_CATEGORIES)
        capa_bugs     = sum(mc.get(c, 0.0) for c in BUGS_CATEGORIES)
        capa_imprevus = sum(mc.get(c, 0.0) for c in IMPREV_CATEGORIES)
        capa_total    = capa_stories + capa_bugs + capa_imprevus + sum(
            mc.get(c, 0.0) for c in ("agility", "reunions", "psm", "montee_competence")
        )

        work_stories  = mw.get("stories", 0.0)
        work_bugs     = mw.get("bugs", 0.0)
        work_maint    = mw.get("maintenance", 0.0)
        work_orphan   = mw.get("orphan", 0.0)
        work_total    = work_stories + work_bugs + work_maint + work_orphan

        # N'inclut que les membres qui ont de la capa ou du travail dans ce sprint
        if capa_total == 0 and work_total == 0:
            continue

        capa_psm = mc.get("psm", 0.0)

        result.append({
            "member_id": mid,
            "display_name": m.display_name,
            "profile": m.profile,
            "capa_stories_h": round(capa_stories, 1),
            "capa_bugs_h": round(capa_bugs, 1),
            "capa_imprevus_h": round(capa_imprevus, 1),
            "capa_psm_h": round(capa_psm, 1),
            "capa_total_h": round(capa_total, 1),
            "work_stories_h": round(work_stories, 1),
            "work_bugs_h": round(work_bugs, 1),
            "work_maint_h": round(work_maint, 1),
            "work_orphan_h": round(work_orphan, 1),
            "work_total_h": round(work_total, 1),
        })

    return result


# ── Onglet PI ALL — Vue globale ───────────────────────────────────────────────

@router.get("/pi/{pi_id}/overview")
def get_overview(pi_id: int, db: Session = Depends(get_db)):
    """Vue d'ensemble : KPI cards + story points par état + Features/Enablers."""
    _get_pi_or_404(pi_id, db)
    path_map = _pi_iteration_paths(pi_id, db)
    all_paths = list(path_map.keys())

    # ── Capacités (tous sprints) ─────────────────────────────────────────────
    blocks = db.query(PlanningBlock).filter(
        PlanningBlock.pi_id == pi_id,
        PlanningBlock.layer == 1,
    ).all()

    capa_total    = sum(b.duration_days * HOURS_PER_DAY for b in blocks)
    capa_stories  = sum(b.duration_days * HOURS_PER_DAY for b in blocks if b.category in STORY_CATEGORIES)
    capa_bugs     = sum(b.duration_days * HOURS_PER_DAY for b in blocks if b.category in BUGS_CATEGORIES)
    capa_imprevus = sum(b.duration_days * HOURS_PER_DAY for b in blocks if b.category in IMPREV_CATEGORIES)

    # ── Travail réalisé (tous sprints) ───────────────────────────────────────
    if all_paths:
        tasks = db.query(WorkItem).filter(
            WorkItem.type == "Task",
            WorkItem.iteration_path.in_(all_paths),
        ).all()
    else:
        tasks = []

    parent_ids = {t.parent_id for t in tasks if t.parent_id}
    parents = {wi.id: wi for wi in db.query(WorkItem).filter(WorkItem.id.in_(parent_ids)).all()} if parent_ids else {}

    work_total = work_stories = work_bugs = work_maint = work_orphan = 0.0
    for t in tasks:
        cw = t.completed_work or 0.0
        parent = parents.get(t.parent_id) if t.parent_id else None
        cat = _task_category(parent.type if parent else None)
        work_total += cw
        if cat == "stories":   work_stories += cw
        elif cat == "bugs":    work_bugs    += cw
        elif cat == "maintenance": work_maint += cw
        else:                  work_orphan  += cw

    pct_capa = round(work_total / capa_total * 100, 1) if capa_total else None

    kpis = {
        "capa_total_h":    round(capa_total, 1),
        "work_total_h":    round(work_total, 1),
        "pct_capa":        pct_capa,
        "capa_imprevus_h": round(capa_imprevus, 1),
        "work_imprevus_h": round(work_orphan, 1),
        "capa_bugs_h":     round(capa_bugs, 1),
        "work_bugs_h":     round(work_bugs, 1),
        "work_maint_h":    round(work_maint, 1),
        "capa_stories_h":  round(capa_stories, 1),
        "work_stories_h":  round(work_stories, 1),
    }

    # ── Story Points par état ─────────────────────────────────────────────────
    # User Stories dans le PI (via iteration_path des itérations du PI)
    if all_paths:
        stories = db.query(WorkItem).filter(
            WorkItem.type == "User Story",
            WorkItem.iteration_path.in_(all_paths),
        ).all()
    else:
        stories = []

    sp_by_state: dict[str, float] = {}
    total_sp = 0.0
    for s in stories:
        sp = s.story_points or 0.0
        state = s.state or "(Vide)"
        sp_by_state[state] = sp_by_state.get(state, 0.0) + sp
        total_sp += sp

    story_points = {
        "total": round(total_sp, 1),
        "by_state": [{"state": k, "points": round(v, 1)} for k, v in sorted(sp_by_state.items())],
    }

    # ── Features & Enablers du PI ────────────────────────────────────────────
    pi_obj = db.query(PI).filter(PI.id == pi_id).first()
    features_query = db.query(WorkItem).filter(
        WorkItem.type.in_(["Feature", "Enabler"])
    )
    # Filtre par azdo_iteration_path du PI si défini
    if pi_obj and pi_obj.azdo_iteration_path:
        features_query = features_query.filter(
            WorkItem.iteration_path.like(f"{pi_obj.azdo_iteration_path}%")
        )

    features = features_query.order_by(WorkItem.id).all()
    features_list = [
        {
            "id": f.id,
            "title": f.title,
            "type": f.type,
            "state": f.state,
            "business_value": f.business_value,
            "effort": f.effort,
        }
        for f in features
    ]

    return {
        "kpis": kpis,
        "story_points": story_points,
        "features": features_list,
    }


# ── Analyse productivité par membre (LLM) ─────────────────────────────────────

# ── Constantes pour l'analyse de productivité ────────────────────────────────

# Mapping mot-clé (lowercase) dans le titre d'une tâche Hors-Prod → catégorie planning
_HORS_PROD_CATEGORIES = {
    "imprévu":          "imprevus",
    "gestion des impr": "imprevus",
    "cérémonies":       "agility",
    "ceremonie":        "agility",
    "agile":            "agility",
    "réunion":          "reunions",
    "reunion":          "reunions",
    "divers":           "reunions",
    "montée":           "montee_competence",
    "montee":           "montee_competence",
    "compétence":       "montee_competence",
    "competence":       "montee_competence",
    "psm":              "psm",
    "bug":              "bugs_maintenance",
    "maintenance":      "bugs_maintenance",
}

_CAPA_LABELS: dict[str, str] = {
    "stories_dev":       "Stories (Dev)",
    "stories_qa":        "Stories (QA)",
    "bugs_maintenance":  "Bugs & Maintenance",
    "imprevus":          "Imprévus",
    "agility":           "Cérémonies agiles",
    "reunions":          "Réunions, Divers",
    "psm":               "Activités PSM",
    "montee_competence": "Montée en compétence",
    "conges":            "Congés / Absences",
}


def _strip_html(raw: str) -> str:
    """Supprime les balises HTML d'une chaîne et normalise les sauts de ligne."""
    if not raw:
        return ""
    text = html_module.unescape(raw)
    text = re.sub(r"(?i)<\s*br\s*/?\s*>", "\n", text)
    text = re.sub(r"(?i)</\s*p\s*>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _hors_prod_category(title: str) -> str:
    """Déduit la catégorie planning d'une tâche Hors-Prod à partir de son titre.

    Parcourt ``_HORS_PROD_CATEGORIES`` (mot-clé → catégorie) et retourne
    ``"autre"`` si aucun mot-clé n'est trouvé.
    """
    t = title.lower()
    for keyword, cat in _HORS_PROD_CATEGORIES.items():
        if keyword in t:
            return cat
    return "autre"


@router.post("/pi/{pi_id}/sprint/{sprint_num}/analyze-member/{member_id}")
async def analyze_member_productivity(
    pi_id: int, sprint_num: int, member_id: int, db: Session = Depends(get_db)
):
    """
    Génère un rapport d'analyse de productivité pour un membre sur un sprint.
    Extrait les tâches AZDO (production + Hors-Prod), compare aux capacités PI Planning,
    puis envoie au LLM pour analyse narrative.
    """
    pi = _get_pi_or_404(pi_id, db)
    member = db.query(TeamMember).filter(TeamMember.id == member_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Membre non trouvé")

    path_map = _pi_iteration_paths(pi_id, db)
    sprint_paths = [p for p, s in path_map.items() if s == sprint_num]
    sprint_label = f"Sprint {sprint_num}"

    # ── Capacités du membre : SprintCapacity en priorité, sinon PlanningBlocks ─
    sc = db.query(SprintCapacity).filter(
        SprintCapacity.pi_id == pi_id,
        SprintCapacity.sprint_number == sprint_num,
        SprintCapacity.team_member_id == member_id,
    ).first()

    capa_by_cat: dict[str, float] = {}
    if sc:
        capa_by_cat = {
            "stories_dev":       sc.capa_stories_h,
            "bugs_maintenance":  sc.capa_bugs_h,
            "imprevus":          sc.capa_imprevus_h,
            "agility":           sc.capa_agility_h,
            "reunions":          sc.capa_reunions_h,
            "psm":               sc.capa_psm_h,
            "montee_competence": sc.capa_montee_h,
        }
    else:
        blocks = db.query(PlanningBlock).filter(
            PlanningBlock.pi_id == pi_id,
            PlanningBlock.sprint_number == sprint_num,
            PlanningBlock.team_member_id == member_id,
            PlanningBlock.layer == 1,
        ).all()
        for b in blocks:
            capa_by_cat[b.category] = capa_by_cat.get(b.category, 0.0) + b.duration_days * HOURS_PER_DAY

    # ── Tâches du membre dans ce sprint ──────────────────────────────────────
    member_name_lower = member.display_name.strip().lower()

    all_tasks_in_sprint = []
    if sprint_paths:
        all_tasks_in_sprint = db.query(WorkItem).filter(
            WorkItem.type == "Task",
            WorkItem.iteration_path.in_(sprint_paths),
        ).all()

    member_tasks = [
        t for t in all_tasks_in_sprint
        if (t.assigned_to or "").strip().lower() == member_name_lower
    ]

    # Sépare production vs Hors-Prod
    hors_prod_tasks = [t for t in member_tasks if t.title.strip().startswith("Hors-Prod")]
    prod_tasks = [t for t in member_tasks if not t.title.strip().startswith("Hors-Prod")]

    # Parent des tâches de production
    parent_ids = {t.parent_id for t in prod_tasks if t.parent_id}
    parents = {
        wi.id: wi
        for wi in db.query(WorkItem).filter(WorkItem.id.in_(parent_ids)).all()
    } if parent_ids else {}

    # ── Formatage du message utilisateur pour le LLM ─────────────────────────

    # Bloc tâches de production
    prod_lines = []
    work_prod_total = 0.0
    for t in sorted(prod_tasks, key=lambda x: x.title):
        parent = parents.get(t.parent_id) if t.parent_id else None
        parent_info = f"[Parent: {parent.type} #{parent.id} - {parent.title}]" if parent else "[Sans parent]"
        cw = t.completed_work or 0.0
        work_prod_total += cw
        prod_lines.append(
            f"  - #{t.id} | {t.title} | État: {t.state} | Réalisé: {cw} h | {parent_info}"
        )

    # Bloc tâches Hors-Prod avec description
    hors_prod_lines = []
    work_hp_by_cat: dict[str, float] = {}
    for t in sorted(hors_prod_tasks, key=lambda x: x.title):
        cw = t.completed_work or 0.0
        cat = _hors_prod_category(t.title)
        work_hp_by_cat[cat] = work_hp_by_cat.get(cat, 0.0) + cw
        desc = _strip_html(t.description or "")
        hors_prod_lines.append(
            f"\n  [{t.title}] — Réalisé: {cw} h\n"
            f"  Description:\n{desc if desc else '(vide)'}"
        )

    # Tableau capacité vs réalisé
    all_cats = sorted(set(list(capa_by_cat.keys()) + list(work_hp_by_cat.keys()) + ["stories_dev", "stories_qa"]))
    table_lines = [
        "| Catégorie | Capa estimée (h) | Réalisé Hors-Prod (h) | Réalisé Production (h) |",
        "|-----------|-----------------|----------------------|----------------------|",
    ]
    for cat in all_cats:
        label = _CAPA_LABELS.get(cat, cat)
        capa_h = capa_by_cat.get(cat, 0.0)
        hp_h = work_hp_by_cat.get(cat, 0.0)
        # Production s'applique aux stories (tout ce qui n'est pas Hors-Prod)
        prod_h = work_prod_total if cat in ("stories_dev", "stories_qa") else 0.0
        table_lines.append(f"| {label} | {capa_h:.1f} | {hp_h:.1f} | {prod_h:.1f} |")

    user_message = f"""Collaborateur : {member.display_name}
Sprint : {sprint_label}
PI : {pi.name}
Unité : heures (h)
Profil : {member.profile}

=== TABLEAU CAPACITÉ VS RÉALISÉ ===

{chr(10).join(table_lines)}

Capacité totale estimée : {sum(capa_by_cat.values()):.1f} h
Réalisé Production (tâches stories/bugs) : {work_prod_total:.1f} h
Réalisé Hors-Production total : {sum(work_hp_by_cat.values()):.1f} h
Réalisé TOTAL : {work_prod_total + sum(work_hp_by_cat.values()):.1f} h

=== TÂCHES DE PRODUCTION ({len(prod_tasks)} tâches) ===

{chr(10).join(prod_lines) if prod_lines else '(aucune tâche de production saisie)'}

=== TÂCHES HORS-PRODUCTION ({len(hors_prod_tasks)} tâches) ===

{''.join(hors_prod_lines) if hors_prod_lines else '(aucune tâche Hors-Prod trouvée pour ce sprint)'}
"""

    # ── Appel LLM ─────────────────────────────────────────────────────────────
    from app.services.llm.client import LLMClient

    t0 = datetime.utcnow()
    try:
        client = LLMClient(db)
        analysis = await client.analyze_productivity(user_message)
        duration_ms = int((datetime.utcnow() - t0).total_seconds() * 1000)

        # Sauvegarde le rapport complet (écrase le précédent pour ce membre/sprint/PI)
        existing = db.query(LLMLog).filter(
            LLMLog.log_type == "PRODUCTIVITY_REPORT",
            LLMLog.pi_id == pi_id,
            LLMLog.sprint_num == sprint_num,
            LLMLog.member_id == member_id,
        ).first()
        if existing:
            existing.content = analysis
            existing.summary = f"Productivité {member.display_name} {sprint_label} {pi.name}"
            existing.duration_ms = duration_ms
            existing.created_at = datetime.utcnow()
        else:
            db.add(LLMLog(
                log_type="PRODUCTIVITY_REPORT",
                pi_id=pi_id,
                sprint_num=sprint_num,
                member_id=member_id,
                summary=f"Productivité {member.display_name} {sprint_label} {pi.name}",
                content=analysis,
                duration_ms=duration_ms,
            ))
        db.commit()

        return {"analysis": analysis, "member": member.display_name, "sprint": sprint_label, "saved": True}

    except Exception as exc:
        db.add(LLMLog(log_type="ERROR", summary=f"Erreur analyse productivité: {exc}", content=str(exc)))
        db.commit()
        raise HTTPException(status_code=500, detail=f"Erreur LLM : {exc}")


@router.get("/pi/{pi_id}/sprint/{sprint_num}/analyze-member/{member_id}/latest")
def get_latest_productivity_report(
    pi_id: int, sprint_num: int, member_id: int, db: Session = Depends(get_db)
):
    """Retourne le dernier rapport d'analyse de productivité sauvegardé."""
    report = db.query(LLMLog).filter(
        LLMLog.log_type == "PRODUCTIVITY_REPORT",
        LLMLog.pi_id == pi_id,
        LLMLog.sprint_num == sprint_num,
        LLMLog.member_id == member_id,
    ).order_by(LLMLog.created_at.desc()).first()
    if not report:
        raise HTTPException(status_code=404, detail="Aucun rapport sauvegardé")
    return {
        "analysis": report.content,
        "member": report.summary,
        "sprint": f"Sprint {sprint_num}",
        "created_at": report.created_at.isoformat() if report.created_at else None,
    }


# ── Stories planifiées par sprint ─────────────────────────────────────────────

@router.get("/pi/{pi_id}/sprint/{sprint_num}/planned-stories")
def get_planned_stories(pi_id: int, sprint_num: int, db: Session = Depends(get_db)):
    """Retourne les stories planifiées (Layer 2) du sprint, groupées par Feature/Enabler parent.

    Inclut le statut DoR depuis le PBRItem le plus récent pour chaque story.
    """
    from app.models.pi_planning import PlanningBlock
    from app.models.work_item import WorkItem
    from app.models.team_member import TeamMember
    from app.models.pbr import PBRItem
    from collections import defaultdict

    # Blocs Layer 2 du sprint avec work_item_id
    blocks = (
        db.query(PlanningBlock)
        .filter(
            PlanningBlock.pi_id == pi_id,
            PlanningBlock.layer == 2,
            PlanningBlock.sprint_number == sprint_num,
            PlanningBlock.work_item_id.isnot(None),
        )
        .all()
    )
    if not blocks:
        return {"groups": [], "orphans": []}

    # Agréger par work_item_id : total jours + membres
    story_days: dict[int, float] = defaultdict(float)
    story_members: dict[int, set] = defaultdict(set)
    for b in blocks:
        story_days[b.work_item_id] += b.duration_days
        story_members[b.work_item_id].add(b.team_member_id)

    wi_ids = list(story_days.keys())

    # Charger les work items stories
    stories = {
        wi.id: wi
        for wi in db.query(WorkItem).filter(WorkItem.id.in_(wi_ids)).all()
    }

    # Charger les membres
    member_ids = {mid for mids in story_members.values() for mid in mids}
    members_map = {
        m.id: m
        for m in db.query(TeamMember).filter(TeamMember.id.in_(member_ids)).all()
    }

    # Charger les parents (Feature/Enabler)
    parent_ids = list({wi.parent_id for wi in stories.values() if wi.parent_id})
    parents = {
        wi.id: wi
        for wi in db.query(WorkItem).filter(WorkItem.id.in_(parent_ids)).all()
    } if parent_ids else {}

    # Charger le dernier PBRItem pour chaque story (pour le statut DoR)
    # On prend le plus récent (id le plus grand) pour chaque work_item_id
    pbr_items_raw = (
        db.query(PBRItem)
        .filter(PBRItem.work_item_id.in_(wi_ids))
        .order_by(PBRItem.id.desc())
        .all()
    )
    pbr_by_story: dict[int, PBRItem] = {}
    for pi_item in pbr_items_raw:
        if pi_item.work_item_id not in pbr_by_story:
            pbr_by_story[pi_item.work_item_id] = pi_item

    # Construire les données story
    def build_story(wid: int) -> dict:
        wi = stories.get(wid)
        if not wi:
            return {"id": wid, "title": "?", "type": "?", "state": "?", "members": [], "total_days": 0, "total_hours": 0}
        mids = story_members.get(wid, set())
        member_list = [
            {"id": m.id, "name": m.display_name, "profile": m.profile}
            for m in (members_map.get(mid) for mid in mids) if m
        ]
        pbr = pbr_by_story.get(wid)
        return {
            "id": wid,
            "title": wi.title,
            "type": wi.type,
            "state": wi.state,
            "members": member_list,
            "total_days": round(story_days[wid], 2),
            "total_hours": round(story_days[wid] * 8, 1),
            "pbr_item_id": pbr.id if pbr else None,
            "dor_note": pbr.ia_dor_note if pbr else None,
            "dor_comment": pbr.ia_comment if pbr else None,
            "dor_analyzed_at": pbr.ia_analyzed_at.isoformat() if pbr and pbr.ia_analyzed_at else None,
        }

    # Grouper par parent (Feature/Enabler)
    grouped: dict[int | None, list] = defaultdict(list)
    for wid, wi in stories.items():
        grouped[wi.parent_id].append(wid)

    groups = []
    orphan_ids = []
    for parent_id, wids in grouped.items():
        parent = parents.get(parent_id) if parent_id else None
        if parent:
            groups.append({
                "parent_id": parent.id,
                "parent_title": parent.title,
                "parent_type": parent.type,
                "parent_state": parent.state,
                "stories": [build_story(wid) for wid in sorted(wids)],
            })
        else:
            orphan_ids.extend(wids)

    # Tri des groupes par title du parent
    groups.sort(key=lambda g: g["parent_title"] or "")

    orphans = [build_story(wid) for wid in sorted(orphan_ids)]

    return {"groups": groups, "orphans": orphans}
