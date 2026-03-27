"""Endpoints Admin PI — opérations AZDO d'écriture pour le passage de PI.

Toutes les mutations AZDO (création/mise à jour de work items et d'itérations)
sont effectuées ici. Les endpoints nécessitent que le PI soit verrouillé.
Le PAT AZDO doit avoir les droits Work Items Read & Write et Project Read.
"""

import asyncio
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models.pi import PI
from app.models.iteration import Iteration
from app.models.pi_planning import PlanningBlock
from app.models.team_member import TeamMember
from app.models.work_item import WorkItem
from app.models.app_settings import AppSettings
from app.services.azdo.client import AzdoClient
from app.services.crypto import decrypt_value, SENSITIVE_KEYS

router = APIRouter()

# ── Constantes ────────────────────────────────────────────────────────────────

HOURS_PER_DAY = 8.0

SPRINT_PATH_LABELS: dict[int, str] = {
    1: "Sprint 1",
    2: "Sprint 2",
    3: "Sprint 3",
    4: "Sprint 4",
}

# Catégories de blocs Layer 1 qui génèrent des tâches Hors-Prod
HORS_PROD_CATEGORIES: dict[str, str] = {
    "agility": "Cérémonies Agile",
    "reunions": "Réunions / Divers",
    "montee_competence": "Montée en compétence",
    "imprevus": "Gestion des imprévus",
    "psm": "Activité PSM",
}

# Types de parents à mettre à jour (Features / Enablers)
PARENT_WI_TYPES = {"Feature", "Enabler", "Epic"}

# États considérés comme "fermés" pour filtrer les items non clôturés
CLOSED_STATES = {"Closed", "Removed", "Done", "Completed", "Inactive", "Cancelled", "Resolved"}


# ── Helpers ──────────────────────────────────────────────────────────────────

def _get_setting(db: Session, key: str) -> str | None:
    row = db.query(AppSettings).filter(AppSettings.key == key).first()
    value = row.value if row else None
    return decrypt_value(value) if key in SENSITIVE_KEYS else value


def _build_client(db: Session) -> AzdoClient:
    org = _get_setting(db, "azdo_organization")
    project = _get_setting(db, "azdo_project")
    pat = _get_setting(db, "azdo_pat")
    if not all([org, project, pat]):
        raise HTTPException(
            status_code=400,
            detail="Paramètres AZDO incomplets. Vérifiez l'organisation, le projet et le PAT.",
        )
    return AzdoClient(org, project, pat)


def _get_locked_pi(pi_id: int, db: Session) -> PI:
    pi = db.query(PI).filter(PI.id == pi_id).first()
    if not pi:
        raise HTTPException(status_code=404, detail="PI non trouvé")
    if not pi.is_locked:
        raise HTTPException(status_code=403, detail="Le PI doit être verrouillé pour accéder au panel admin.")
    return pi


def _path_segments(path: str, skip_prefix: str | None = None) -> list[str]:
    """Découpe un chemin (séparateurs \\ ou /) en segments, en sautant le préfixe si demandé."""
    segments = [s for s in path.replace("\\", "/").split("/") if s]
    if skip_prefix and segments and segments[0].lower() == skip_prefix.lower():
        segments = segments[1:]
    return segments


def _find_node(node: dict, segments: list[str]) -> dict | None:
    """Cherche récursivement un nœud dans l'arbre de classification AZDO par segments de nom."""
    if not segments:
        return node
    target = segments[0].lower()
    for child in node.get("children") or []:
        if child.get("name", "").lower() == target:
            return _find_node(child, segments[1:])
    return None


def _team_base_path(pi_path: str, team: str) -> str:
    """Retourne le chemin du nœud équipe.

    Si ``pi_path`` se termine déjà par le nom de l'équipe (l'utilisateur a inclus
    le nœud équipe dans le chemin configuré), on l'utilise tel quel.
    Sinon, on ajoute ``\\{team}``.
    """
    if not team:
        return pi_path
    last_segment = pi_path.rstrip("/\\").rsplit("\\", 1)[-1].rsplit("/", 1)[-1]
    if last_segment.lower() == team.lower():
        return pi_path
    return f"{pi_path}\\{team}"


def _build_sprint_path(pi_path: str, team: str, sprint_number: int) -> str:
    label = SPRINT_PATH_LABELS.get(sprint_number, f"Sprint {sprint_number}")
    base = _team_base_path(pi_path, team)
    return f"{base}\\{label}"


def _extract_assigned_to(field_value) -> str:
    if isinstance(field_value, dict):
        return field_value.get("displayName", "") or field_value.get("uniqueName", "")
    return str(field_value) if field_value else ""


# ══════════════════════════════════════════════════════════════════════════════
# TAB 1 — Itérations AZDO
# ══════════════════════════════════════════════════════════════════════════════

class IterationStatus(BaseModel):
    label: str
    path: str
    exists: bool


class IterationCheckResult(BaseModel):
    pi_path: str
    team: str
    items: list[IterationStatus]


@router.get("/pi/{pi_id}/iterations/check", response_model=IterationCheckResult)
async def check_iterations(pi_id: int, db: Session = Depends(get_db)):
    """Vérifie l'existence des nœuds d'itération AZDO attendus pour ce PI."""
    pi = _get_locked_pi(pi_id, db)
    if not pi.azdo_iteration_path:
        raise HTTPException(400, "Le PI n'a pas de chemin d'itération AZDO configuré.")

    client = _build_client(db)
    team = _get_setting(db, "azdo_team") or ""
    project = client.project

    tree = await client.get_classification_nodes()

    team_path = _team_base_path(pi.azdo_iteration_path, team)
    expected: list[tuple[str, str]] = []
    if team:
        expected.append((f"Nœud équipe ({team})", team_path))
    for sprint_num, label in SPRINT_PATH_LABELS.items():
        expected.append((label, _build_sprint_path(pi.azdo_iteration_path, team, sprint_num)))

    items = []
    for label, path in expected:
        segs = _path_segments(path, skip_prefix=project)
        node = _find_node(tree, segs)
        items.append(IterationStatus(label=label, path=path, exists=node is not None))

    return IterationCheckResult(pi_path=pi.azdo_iteration_path, team=team, items=items)


class IterationCreateResult(BaseModel):
    created: list[str]
    errors: list[dict]


@router.post("/pi/{pi_id}/iterations/create", response_model=IterationCreateResult)
async def create_missing_iterations(pi_id: int, db: Session = Depends(get_db)):
    """Crée les nœuds d'itération AZDO manquants pour ce PI (équipe + 4 sprints)."""
    pi = _get_locked_pi(pi_id, db)
    if not pi.azdo_iteration_path:
        raise HTTPException(400, "Le PI n'a pas de chemin d'itération AZDO configuré.")

    client = _build_client(db)
    team = _get_setting(db, "azdo_team") or ""
    project = client.project

    # Dates des sprints depuis la DB
    iterations = (
        db.query(Iteration)
        .filter(Iteration.pi_id == pi_id)
        .order_by(Iteration.sprint_number)
        .all()
    )
    sprint_dates: dict[int, Iteration] = {it.sprint_number: it for it in iterations}

    # Chemin relatif du PI (sans préfixe projet)
    pi_segs = _path_segments(pi.azdo_iteration_path, skip_prefix=project)
    pi_relative = "/".join(pi_segs)

    team_path = _team_base_path(pi.azdo_iteration_path, team)
    team_segs = _path_segments(team_path, skip_prefix=project)
    team_relative = "/".join(team_segs)

    tree = await client.get_classification_nodes()

    created: list[str] = []
    errors: list[dict] = []

    # 1. Créer le nœud équipe si nécessaire
    if team:
        if not _find_node(tree, team_segs):
            # Le parent du nœud équipe est le chemin PI (sans le segment équipe si déjà inclus)
            parent_relative = "/".join(team_segs[:-1]) if len(team_segs) > 1 else pi_relative
            try:
                await client.create_classification_node(parent_relative, team)
                created.append(team_path)
                tree = await client.get_classification_nodes()  # refresh
            except Exception as exc:
                errors.append({"path": team_path, "error": str(exc)})

    # 2. Créer les nœuds sprint
    for sprint_num, label in SPRINT_PATH_LABELS.items():
        full_path = _build_sprint_path(pi.azdo_iteration_path, team, sprint_num)
        segs = _path_segments(full_path, skip_prefix=project)
        if _find_node(tree, segs):
            continue  # already exists
        it = sprint_dates.get(sprint_num)
        sd = it.start_date.strftime("%Y-%m-%dT00:00:00Z") if it and it.start_date else None
        fd = it.end_date.strftime("%Y-%m-%dT00:00:00Z") if it and it.end_date else None
        try:
            await client.create_classification_node(team_relative, label, sd, fd)
            created.append(full_path)
        except Exception as exc:
            errors.append({"path": full_path, "error": str(exc)})

    return IterationCreateResult(created=created, errors=errors)


# ══════════════════════════════════════════════════════════════════════════════
# TAB 2 — Items non clôturés (PI précédent)
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/pi/{pi_id}/unclosed-items")
async def get_unclosed_items(pi_id: int, db: Session = Depends(get_db)):
    """Retourne les work items non clôturés du PI précédent."""
    pi = _get_locked_pi(pi_id, db)

    prev_pi = (
        db.query(PI)
        .filter(PI.start_date < pi.start_date)
        .order_by(PI.start_date.desc())
        .first()
    )
    if not prev_pi or not prev_pi.azdo_iteration_path:
        return {
            "prev_pi": None,
            "current_pi": {"name": pi.name, "azdo_iteration_path": pi.azdo_iteration_path},
            "items": [],
        }

    client = _build_client(db)

    wiql = (
        f"SELECT [System.Id] FROM WorkItems "
        f"WHERE [System.IterationPath] UNDER '{prev_pi.azdo_iteration_path}' "
        f"AND [System.State] NOT IN ('Closed','Removed','Done','Completed','Inactive','Cancelled') "
        f"AND [System.WorkItemType] IN ('Task','Bug','User Story','Enabler Story','Maintenance','Question','Feature','Enabler') "
        f"ORDER BY [System.WorkItemType]"
    )

    ids = await client.run_wiql(wiql)
    items_raw = await client.get_work_items(ids[:200]) if ids else []

    items = []
    for item in items_raw:
        f = item.get("fields", {})
        items.append({
            "id": item["id"],
            "title": f.get("System.Title", ""),
            "type": f.get("System.WorkItemType", ""),
            "state": f.get("System.State", ""),
            "assigned_to": _extract_assigned_to(f.get("System.AssignedTo")),
            "iteration_path": f.get("System.IterationPath", ""),
        })

    return {
        "prev_pi": {
            "name": prev_pi.name,
            "azdo_iteration_path": prev_pi.azdo_iteration_path,
        },
        "current_pi": {
            "name": pi.name,
            "azdo_iteration_path": pi.azdo_iteration_path,
        },
        "items": items,
    }


class CloseTasksRequest(BaseModel):
    work_item_ids: list[int]


@router.post("/pi/{pi_id}/close-tasks")
async def close_tasks(pi_id: int, payload: CloseTasksRequest, db: Session = Depends(get_db)):
    """Ferme les work items spécifiés (State → Closed)."""
    _get_locked_pi(pi_id, db)
    client = _build_client(db)
    updated, errors = [], []
    for wid in payload.work_item_ids:
        try:
            await client.update_work_item(wid, [
                {"op": "replace", "path": "/fields/System.State", "value": "Closed"},
            ])
            updated.append(wid)
        except Exception as exc:
            errors.append({"id": wid, "error": str(exc)})
    return {"updated": updated, "errors": errors}


class MoveItemsRequest(BaseModel):
    work_item_ids: list[int]
    target_iteration_path: str


@router.post("/pi/{pi_id}/move-items")
async def move_items(pi_id: int, payload: MoveItemsRequest, db: Session = Depends(get_db)):
    """Déplace des work items vers un chemin d'itération cible."""
    _get_locked_pi(pi_id, db)
    client = _build_client(db)
    updated, errors = [], []
    for wid in payload.work_item_ids:
        try:
            await client.update_work_item(wid, [
                {"op": "replace", "path": "/fields/System.IterationPath", "value": payload.target_iteration_path},
            ])
            updated.append(wid)
        except Exception as exc:
            errors.append({"id": wid, "error": str(exc)})
    return {"updated": updated, "errors": errors}


RESOLVED_REASON_FIELD = "Isagri.ResolvedReason"

# Types pour lesquels le champ raison doit être renseigné (pas les tâches)
RESOLVED_REASON_TYPES = {"User Story", "Enabler Story", "Maintenance", "Feature", "Enabler", "Question"}

RESOLVE_REASONS = ["Réalisé", "Reporté", "Fractionné", "Obsolète"]


class ResolveTasksRequest(BaseModel):
    work_item_ids: list[int]
    resolved_reason: str


@router.post("/pi/{pi_id}/resolve-tasks")
async def resolve_tasks(pi_id: int, payload: ResolveTasksRequest, db: Session = Depends(get_db)):
    """Passe les work items spécifiés à l'état Resolved avec une raison.

    Opère en deux étapes distinctes pour faciliter le diagnostic :
    1. Transition d'état → Resolved
    2. Mise à jour du champ raison (RESOLVED_REASON_FIELD)
    Si l'étape 2 échoue, l'item est quand même considéré comme résolu
    mais un avertissement est inclus dans la réponse.
    """
    _get_locked_pi(pi_id, db)
    if payload.resolved_reason not in RESOLVE_REASONS:
        raise HTTPException(400, f"Raison invalide. Valeurs acceptées : {RESOLVE_REASONS}")
    client = _build_client(db)
    # Récupérer les types depuis la DB pour savoir si le champ raison s'applique
    wi_types: dict[int, str] = {
        wi.id: wi.type
        for wi in db.query(WorkItem).filter(WorkItem.id.in_(payload.work_item_ids)).all()
    }
    updated, errors, warnings = [], [], []
    for wid in payload.work_item_ids:
        # Étape 1 : transition d'état
        try:
            await client.update_work_item(wid, [
                {"op": "replace", "path": "/fields/System.State", "value": "Resolved"},
            ])
        except Exception as exc:
            errors.append({"id": wid, "error": f"Transition état Resolved impossible : {exc}"})
            continue
        updated.append(wid)
        # Étape 2 : champ raison uniquement pour les types concernés (pas Task/Bug)
        wi_type = wi_types.get(wid, "")
        if wi_type in RESOLVED_REASON_TYPES:
            try:
                await client.update_work_item(wid, [
                    {"op": "replace", "path": f"/fields/{RESOLVED_REASON_FIELD}", "value": payload.resolved_reason},
                ])
            except Exception as exc:
                warnings.append({"id": wid, "warning": f"État mis à jour mais champ raison ({RESOLVED_REASON_FIELD}) non appliqué : {exc}"})
    return {"updated": updated, "errors": errors, "warnings": warnings}


# ══════════════════════════════════════════════════════════════════════════════
# TAB 3 — Chemins d'itération parents (Features / Enablers)
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/pi/{pi_id}/parent-iterations/check")
async def check_parent_iterations(pi_id: int, db: Session = Depends(get_db)):
    """Liste les Features/Enablers parents des stories du PI courant dont le chemin d'itération doit être mis à jour."""
    pi = _get_locked_pi(pi_id, db)
    if not pi.azdo_iteration_path:
        raise HTTPException(400, "PI path manquant")

    # Stories planifiées dans ce PI (blocs Layer 2 avec work_item_id)
    blocks = (
        db.query(PlanningBlock)
        .filter(
            PlanningBlock.pi_id == pi_id,
            PlanningBlock.layer == 2,
            PlanningBlock.work_item_id.isnot(None),
        )
        .all()
    )
    story_wi_ids = list({b.work_item_id for b in blocks})

    if not story_wi_ids:
        return {
            "current_pi": {"name": pi.name, "azdo_iteration_path": pi.azdo_iteration_path},
            "items": [],
        }

    # Récupérer les work items stories pour extraire leurs parent_id
    stories = db.query(WorkItem).filter(WorkItem.id.in_(story_wi_ids)).all()
    parent_ids = list({s.parent_id for s in stories if s.parent_id is not None})

    if not parent_ids:
        return {
            "current_pi": {"name": pi.name, "azdo_iteration_path": pi.azdo_iteration_path},
            "items": [],
        }

    # Récupérer les parents (Feature / Enabler / Epic)
    parents = (
        db.query(WorkItem)
        .filter(
            WorkItem.id.in_(parent_ids),
            WorkItem.type.in_(PARENT_WI_TYPES),
        )
        .all()
    )

    target_path = pi.azdo_iteration_path
    items = [
        {
            "id": p.id,
            "title": p.title,
            "type": p.type,
            "state": p.state,
            "current_path": p.iteration_path,
            "new_path": target_path,
            "needs_update": p.iteration_path != target_path,
        }
        for p in parents
        if p.iteration_path != target_path
    ]

    return {
        "current_pi": {"name": pi.name, "azdo_iteration_path": pi.azdo_iteration_path},
        "items": items,
    }


class UpdateParentsRequest(BaseModel):
    work_item_ids: list[int]


@router.post("/pi/{pi_id}/parent-iterations/update")
async def update_parent_iterations(pi_id: int, payload: UpdateParentsRequest, db: Session = Depends(get_db)):
    """Met à jour le chemin d'itération des Features/Enablers vers le nouveau PI."""
    pi = _get_locked_pi(pi_id, db)
    client = _build_client(db)
    updated, errors = [], []
    for wid in payload.work_item_ids:
        try:
            await client.update_work_item(wid, [
                {"op": "replace", "path": "/fields/System.IterationPath", "value": pi.azdo_iteration_path},
            ])
            updated.append(wid)
        except Exception as exc:
            errors.append({"id": wid, "error": str(exc)})
    return {"updated": updated, "errors": errors}


# ══════════════════════════════════════════════════════════════════════════════
# TAB 4 — Chemins d'itération stories
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/pi/{pi_id}/story-iterations/check")
async def check_story_iterations(pi_id: int, db: Session = Depends(get_db)):
    """Liste les stories (blocs Layer 2) dont le chemin d'itération doit être mis à jour."""
    pi = _get_locked_pi(pi_id, db)
    if not pi.azdo_iteration_path:
        raise HTTPException(400, "PI path manquant")

    team = _get_setting(db, "azdo_team") or ""

    blocks = (
        db.query(PlanningBlock)
        .filter(
            PlanningBlock.pi_id == pi_id,
            PlanningBlock.layer == 2,
            PlanningBlock.work_item_id.isnot(None),
        )
        .all()
    )

    if not blocks:
        return {"items": []}

    wi_ids = list({b.work_item_id for b in blocks})
    wi_map = {
        wi.id: wi
        for wi in db.query(WorkItem).filter(WorkItem.id.in_(wi_ids)).all()
    }

    items = []
    seen: set[int] = set()
    for block in blocks:
        wid = block.work_item_id
        if wid in seen or wid not in wi_map:
            continue
        seen.add(wid)
        wi = wi_map[wid]
        new_path = _build_sprint_path(pi.azdo_iteration_path, team, block.sprint_number)
        items.append({
            "id": wi.id,
            "title": wi.title,
            "type": wi.type,
            "sprint_number": block.sprint_number,
            "current_path": wi.iteration_path,
            "new_path": new_path,
            "needs_update": wi.iteration_path != new_path,
        })

    return {"items": items}


class UpdateStoriesRequest(BaseModel):
    items: list[dict]  # [{id: int, new_path: str}]


@router.post("/pi/{pi_id}/story-iterations/update")
async def update_story_iterations(pi_id: int, payload: UpdateStoriesRequest, db: Session = Depends(get_db)):
    """Met à jour le chemin d'itération des stories vers leur sprint respectif."""
    _get_locked_pi(pi_id, db)
    client = _build_client(db)
    updated, errors = [], []
    for item in payload.items:
        wid = item.get("id")
        new_path = item.get("new_path")
        if not wid or not new_path:
            continue
        try:
            await client.update_work_item(wid, [
                {"op": "replace", "path": "/fields/System.IterationPath", "value": new_path},
            ])
            updated.append(wid)
        except Exception as exc:
            errors.append({"id": wid, "error": str(exc)})
    return {"updated": updated, "errors": errors}


# ══════════════════════════════════════════════════════════════════════════════
# TAB 5 — Tâches Hors-Prod
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/pi/{pi_id}/hors-prod/preview")
async def hors_prod_preview(pi_id: int, db: Session = Depends(get_db)):
    """Prévisualise les tâches Hors-Prod à créer dans AZDO depuis les blocs Layer 1."""
    pi = _get_locked_pi(pi_id, db)
    if not pi.azdo_iteration_path:
        raise HTTPException(400, "PI path manquant")

    team = _get_setting(db, "azdo_team") or ""

    blocks = (
        db.query(PlanningBlock)
        .filter(
            PlanningBlock.pi_id == pi_id,
            PlanningBlock.layer == 1,
            PlanningBlock.category.in_(list(HORS_PROD_CATEGORIES.keys())),
        )
        .all()
    )

    member_ids = {b.team_member_id for b in blocks}
    members: dict[int, TeamMember] = {
        m.id: m
        for m in db.query(TeamMember).filter(TeamMember.id.in_(member_ids)).all()
    }

    # Agréger par (membre, sprint, catégorie)
    groups: dict[tuple, float] = defaultdict(float)
    for block in blocks:
        member = members.get(block.team_member_id)
        if not member:
            continue
        if block.category == "psm" and member.profile != "PSM":
            continue  # Activité PSM réservée au profil PSM
        groups[(block.team_member_id, block.sprint_number, block.category)] += block.duration_days

    tasks = []
    for (member_id, sprint_num, category), total_days in sorted(
        groups.items(), key=lambda x: (x[0][1], x[0][0])  # tri par sprint, puis membre
    ):
        member = members[member_id]
        iteration_path = _build_sprint_path(pi.azdo_iteration_path, team, sprint_num)
        assigned_to = member.unique_name or member.display_name
        category_label = HORS_PROD_CATEGORIES[category]
        tasks.append({
            "member_id": member_id,
            "member_name": member.display_name,
            "sprint_number": sprint_num,
            "category": category,
            "category_label": category_label,
            "duration_days": round(total_days, 2),
            "hours": round(total_days * HOURS_PER_DAY, 1),
            "iteration_path": iteration_path,
            "assigned_to": assigned_to,
            "title": f"[Hors-Prod] {category_label} — {member.display_name}",
        })

    return {"tasks": tasks, "total": len(tasks)}


class HorsProdCreateRequest(BaseModel):
    tasks: list[dict]  # Liste issue de la prévisualisation


@router.post("/pi/{pi_id}/hors-prod/create")
async def create_hors_prod_tasks(
    pi_id: int, payload: HorsProdCreateRequest, db: Session = Depends(get_db)
):
    """Crée les tâches Hors-Prod dans AZDO."""
    _get_locked_pi(pi_id, db)
    client = _build_client(db)

    created, errors = [], []
    for task in payload.tasks:
        title = task.get("title", "")
        try:
            ops = [
                {"op": "add", "path": "/fields/System.Title", "value": title},
                {"op": "add", "path": "/fields/System.IterationPath", "value": task["iteration_path"]},
                {
                    "op": "add",
                    "path": "/fields/Microsoft.VSTS.Scheduling.OriginalEstimate",
                    "value": task["hours"],
                },
            ]
            if task.get("assigned_to"):
                ops.append(
                    {"op": "add", "path": "/fields/System.AssignedTo", "value": task["assigned_to"]}
                )
            result = await client.create_work_item("Task", ops)
            created.append(result.get("id"))
        except Exception as exc:
            errors.append({"task": title, "error": str(exc)})

    return {"created": [c for c in created if c is not None], "errors": errors}


# ══════════════════════════════════════════════════════════════════════════════
# TAB 6 — Tâches enfants des stories
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/pi/{pi_id}/story-tasks/preview")
async def story_tasks_preview(pi_id: int, db: Session = Depends(get_db)):
    """Prévisualise les tâches enfants à créer pour chaque story planifiée dans ce PI.

    Logique :
    - Groupe les blocs Layer 2 par work_item_id et somme les duration_days (tous membres, tous sprints).
    - Utilise le sprint le plus petit comme sprint de référence pour l'itération.
    - Vérifie dans la DB si une Task enfant existe déjà (parent_id = story id).
    """
    pi = _get_locked_pi(pi_id, db)
    if not pi.azdo_iteration_path:
        raise HTTPException(400, "PI path manquant")

    team = _get_setting(db, "azdo_team") or ""

    blocks = (
        db.query(PlanningBlock)
        .filter(
            PlanningBlock.pi_id == pi_id,
            PlanningBlock.layer == 2,
            PlanningBlock.work_item_id.isnot(None),
        )
        .all()
    )
    if not blocks:
        return {"items": []}

    # Agréger par work_item_id : total jours + premier sprint
    totals: dict[int, float] = defaultdict(float)
    first_sprint: dict[int, int] = {}
    for b in blocks:
        wid = b.work_item_id
        totals[wid] += b.duration_days
        if wid not in first_sprint or b.sprint_number < first_sprint[wid]:
            first_sprint[wid] = b.sprint_number

    wi_ids = list(totals.keys())
    wi_map = {
        wi.id: wi
        for wi in db.query(WorkItem).filter(WorkItem.id.in_(wi_ids)).all()
    }

    # Vérifier si une Task enfant existe déjà dans la DB locale
    existing_children: set[int] = {
        wi.parent_id
        for wi in db.query(WorkItem).filter(
            WorkItem.parent_id.in_(wi_ids),
            WorkItem.type == "Task",
        ).all()
        if wi.parent_id is not None
    }

    items = []
    for wid, total_days in sorted(totals.items(), key=lambda x: first_sprint.get(x[0], 0)):
        wi = wi_map.get(wid)
        if not wi:
            continue
        sprint_num = first_sprint[wid]
        iteration_path = _build_sprint_path(pi.azdo_iteration_path, team, sprint_num)
        items.append({
            "story_id": wid,
            "title": wi.title,
            "type": wi.type,
            "sprint_number": sprint_num,
            "iteration_path": iteration_path,
            "total_days": round(total_days, 2),
            "total_hours": round(total_days * HOURS_PER_DAY, 1),
            "has_existing_task": wid in existing_children,
        })

    return {"items": items}


class StoryTaskItem(BaseModel):
    story_id: int
    title: str
    iteration_path: str
    total_hours: float


class CreateStoryTasksRequest(BaseModel):
    tasks: list[StoryTaskItem]


@router.post("/pi/{pi_id}/story-tasks/create")
async def create_story_tasks(
    pi_id: int, payload: CreateStoryTasksRequest, db: Session = Depends(get_db)
):
    """Crée une tâche enfant dans AZDO pour chaque story sélectionnée."""
    _get_locked_pi(pi_id, db)
    client = _build_client(db)

    created, errors = [], []
    for task in payload.tasks:
        try:
            ops = [
                {"op": "add", "path": "/fields/System.Title", "value": task.title},
                {"op": "add", "path": "/fields/System.IterationPath", "value": task.iteration_path},
                {
                    "op": "add",
                    "path": "/fields/Microsoft.VSTS.Scheduling.OriginalEstimate",
                    "value": task.total_hours,
                },
                {
                    "op": "add",
                    "path": "/relations/-",
                    "value": {
                        "rel": "System.LinkTypes.Hierarchy-Reverse",
                        "url": f"{client.base_url}/_apis/wit/workitems/{task.story_id}",
                    },
                },
            ]
            result = await client.create_work_item("Task", ops)
            created.append({"story_id": task.story_id, "task_id": result.get("id")})
        except Exception as exc:
            errors.append({"story_id": task.story_id, "title": task.title, "error": str(exc)})

    return {"created": created, "errors": errors}
