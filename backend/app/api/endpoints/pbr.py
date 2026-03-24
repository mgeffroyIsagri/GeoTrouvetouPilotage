from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime

from app.database import get_db
from app.models.pbr import PBRSession, PBRItem, PBRVote

router = APIRouter()


# ── Schémas ───────────────────────────────────────────────────────────────────

class SessionCreate(BaseModel):
    name: str
    date: datetime
    pi_id: int | None = None


class SessionResponse(BaseModel):
    id: int
    name: str
    date: datetime
    is_active: bool
    pi_id: int | None
    excluded_member_ids: list[int] = []

    @classmethod
    def from_orm_custom(cls, obj):
        import json as _json
        data = {
            "id": obj.id, "name": obj.name, "date": obj.date,
            "is_active": obj.is_active, "pi_id": obj.pi_id,
            "excluded_member_ids": _json.loads(obj.excluded_member_ids) if obj.excluded_member_ids else [],
        }
        return cls(**data)

    class Config:
        from_attributes = True


class ItemCreate(BaseModel):
    work_item_id: int


class ItemUpdate(BaseModel):
    action_plan: str | None = None
    refinement_owner_id: int | None = None
    is_deprioritized: bool | None = None


class ItemResponse(BaseModel):
    id: int
    session_id: int
    work_item_id: int
    action_plan: str | None
    ia_dor_note: int | None
    ia_comment: str | None
    ia_analyzed_at: datetime | None
    refinement_owner_id: int | None
    is_deprioritized: bool

    class Config:
        from_attributes = True


class VoteCreate(BaseModel):
    team_member_id: int
    work_item_id: int
    dor_compliant: bool | None = None
    comment: str | None = None
    story_points: float | None = None
    charge_dev_days: float | None = None
    charge_qa_days: float | None = None


class VoteUpdate(BaseModel):
    dor_compliant: bool | None = None
    comment: str | None = None
    story_points: float | None = None
    charge_dev_days: float | None = None
    charge_qa_days: float | None = None


class VoteResponse(BaseModel):
    id: int
    session_id: int
    team_member_id: int
    work_item_id: int
    dor_compliant: bool | None
    comment: str | None
    story_points: float | None
    charge_dev_days: float | None
    charge_qa_days: float | None

    class Config:
        from_attributes = True


# ── Sessions ──────────────────────────────────────────────────────────────────

@router.get("/sessions", response_model=list[SessionResponse])
def list_sessions(pi_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(PBRSession)
    if pi_id is not None:
        q = q.filter(PBRSession.pi_id == pi_id)
    return [SessionResponse.from_orm_custom(s) for s in q.order_by(PBRSession.date.desc()).all()]


@router.get("/sessions/{session_id}", response_model=SessionResponse)
def get_session(session_id: int, db: Session = Depends(get_db)):
    session = db.query(PBRSession).filter(PBRSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
    return SessionResponse.from_orm_custom(session)


@router.post("/sessions", response_model=SessionResponse, status_code=201)
def create_session(payload: SessionCreate, db: Session = Depends(get_db)):
    session = PBRSession(**payload.model_dump(), is_active=False)
    db.add(session)
    db.commit()
    db.refresh(session)
    return SessionResponse.from_orm_custom(session)


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: int, db: Session = Depends(get_db)):
    session = db.query(PBRSession).filter(PBRSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
    db.delete(session)
    db.commit()


class SessionCopy(BaseModel):
    name: str
    date: datetime
    pi_id: int | None = None


@router.post("/sessions/{session_id}/copy", response_model=SessionResponse, status_code=201)
def copy_session(session_id: int, payload: SessionCopy, db: Session = Depends(get_db)):
    """Crée une nouvelle session en reprenant les items (sans votes) d'une session existante."""
    source = db.query(PBRSession).filter(PBRSession.id == session_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Session source non trouvée")
    new_session = PBRSession(
        name=payload.name.strip(),
        date=payload.date,
        pi_id=payload.pi_id,
        is_active=False,
    )
    db.add(new_session)
    db.flush()
    source_items = db.query(PBRItem).filter(PBRItem.session_id == session_id).all()
    for src in source_items:
        db.add(PBRItem(
            session_id=new_session.id,
            work_item_id=src.work_item_id,
            action_plan=src.action_plan,
            refinement_owner_id=src.refinement_owner_id,
            is_deprioritized=src.is_deprioritized,
        ))
    db.commit()
    db.refresh(new_session)
    return SessionResponse.from_orm_custom(new_session)


@router.put("/sessions/{session_id}/activate", response_model=SessionResponse)
def activate_session(session_id: int, db: Session = Depends(get_db)):
    session = db.query(PBRSession).filter(PBRSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
    db.query(PBRSession).filter(PBRSession.is_active == True).update({"is_active": False})
    session.is_active = True
    db.commit()
    db.refresh(session)
    return SessionResponse.from_orm_custom(session)


@router.put("/sessions/{session_id}/deactivate", response_model=SessionResponse)
def deactivate_session(session_id: int, db: Session = Depends(get_db)):
    session = db.query(PBRSession).filter(PBRSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
    session.is_active = False
    db.commit()
    db.refresh(session)
    return SessionResponse.from_orm_custom(session)


class ExcludedMembersUpdate(BaseModel):
    excluded_member_ids: list[int]


@router.put("/sessions/{session_id}/excluded-members", response_model=SessionResponse)
def update_excluded_members(session_id: int, payload: ExcludedMembersUpdate, db: Session = Depends(get_db)):
    import json as _json
    session = db.query(PBRSession).filter(PBRSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
    session.excluded_member_ids = _json.dumps(payload.excluded_member_ids)
    db.commit()
    db.refresh(session)
    return SessionResponse.from_orm_custom(session)


# ── Items (sujets) ─────────────────────────────────────────────────────────────

@router.get("/sessions/{session_id}/items", response_model=list[ItemResponse])
def list_items(session_id: int, db: Session = Depends(get_db)):
    return db.query(PBRItem).filter(PBRItem.session_id == session_id).all()


@router.post("/sessions/{session_id}/items", response_model=list[ItemResponse], status_code=201)
def add_item(session_id: int, payload: ItemCreate, db: Session = Depends(get_db)):
    session = db.query(PBRSession).filter(PBRSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
    existing = db.query(PBRItem).filter(
        PBRItem.session_id == session_id,
        PBRItem.work_item_id == payload.work_item_id,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Ce work item est déjà dans la session")
    from app.models.work_item import WorkItem
    wi = db.query(WorkItem).filter(WorkItem.id == payload.work_item_id).first()
    if not wi:
        raise HTTPException(status_code=404, detail=f"Work item #{payload.work_item_id} non trouvé (synchroniser AZDO d'abord)")

    created = []
    item = PBRItem(session_id=session_id, work_item_id=payload.work_item_id)
    db.add(item)
    created.append(item)

    # Auto-ajout des stories enfants si l'élément est un Enabler ou une Feature
    if wi.type in ("Feature", "Enabler", "Enabler Story"):
        children = db.query(WorkItem).filter(WorkItem.parent_id == wi.id).all()
        existing_ids = {
            row.work_item_id for row in db.query(PBRItem.work_item_id)
            .filter(PBRItem.session_id == session_id).all()
        }
        for child in children:
            if child.id not in existing_ids:
                child_item = PBRItem(session_id=session_id, work_item_id=child.id)
                db.add(child_item)
                created.append(child_item)

    db.commit()
    for c in created:
        db.refresh(c)
    return created


@router.delete("/items/{item_id}", status_code=204)
def remove_item(item_id: int, db: Session = Depends(get_db)):
    item = db.query(PBRItem).filter(PBRItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item non trouvé")
    # Supprimer les votes associés
    db.query(PBRVote).filter(
        PBRVote.session_id == item.session_id,
        PBRVote.work_item_id == item.work_item_id,
    ).delete()
    db.delete(item)
    db.commit()


@router.put("/items/{item_id}", response_model=ItemResponse)
def update_item(item_id: int, payload: ItemUpdate, db: Session = Depends(get_db)):
    item = db.query(PBRItem).filter(PBRItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item non trouvé")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    db.commit()
    db.refresh(item)
    return item


@router.post("/items/{item_id}/sync", response_model=list[ItemResponse], status_code=201)
def sync_item_children(item_id: int, db: Session = Depends(get_db)):
    """Ajoute automatiquement les nouvelles stories enfants d'un enabler/feature."""
    from app.models.work_item import WorkItem
    item = db.query(PBRItem).filter(PBRItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item non trouvé")
    wi = db.query(WorkItem).filter(WorkItem.id == item.work_item_id).first()
    if not wi or wi.type not in ("Feature", "Enabler", "Enabler Story"):
        raise HTTPException(status_code=400, detail="La synchronisation n'est applicable qu'aux Enablers et Features")
    existing_ids = {
        row.work_item_id for row in db.query(PBRItem.work_item_id)
        .filter(PBRItem.session_id == item.session_id).all()
    }
    children = db.query(WorkItem).filter(WorkItem.parent_id == wi.id).all()
    created = []
    for child in children:
        if child.id not in existing_ids:
            child_item = PBRItem(session_id=item.session_id, work_item_id=child.id)
            db.add(child_item)
            created.append(child_item)
    if created:
        db.commit()
        for c in created:
            db.refresh(c)
    return created


@router.post("/items/{item_id}/analyze", response_model=ItemResponse)
async def analyze_item(item_id: int, db: Session = Depends(get_db)):
    """Déclenche l'analyse IA DOR sur un sujet."""
    item = db.query(PBRItem).filter(PBRItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item non trouvé")

    import re as _re
    import html as _html
    import json as _json
    import time as _time
    from datetime import datetime as _dt
    from app.models.work_item import WorkItem
    from app.models.llm_log import LLMLog
    from app.services.azdo.sync import AzdoSyncService

    def _save_log(log_type: str, summary: str, content: str, duration_ms: int | None = None):
        try:
            db.add(LLMLog(
                log_type=log_type,
                work_item_id=item.work_item_id,
                session_id=item.session_id,
                summary=summary[:300],
                content=content,
                duration_ms=duration_ms,
            ))
            db.commit()
        except Exception:
            pass

    wi_db = db.query(WorkItem).filter(WorkItem.id == item.work_item_id).first()

    # ── Helpers ──────────────────────────────────────────────────────────────

    def strip_html(value) -> str:
        if not value:
            return ""
        text = _html.unescape(str(value))
        # Préserver les génériques C# (<string>, <T>, etc.) avant le strip HTML
        text = _re.sub(r"<([A-Za-z][A-Za-z0-9_,\s]*(?:\[\])?)>", r"[\1]", text)
        text = _re.sub(r"(?i)<\s*br\s*/?\s*>", "\n", text)
        text = _re.sub(r"(?i)</\s*p\s*>", "\n", text)
        text = _re.sub(r"(?i)<\s*p\s*>", "", text)
        text = _re.sub(r"<[^>]+>", "", text)
        text = _re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()

    def truncate(text: str, max_chars: int, label: str = "") -> str:
        """Tronque un texte avec indicateur, en coupant proprement à la phrase."""
        if not text or len(text) <= max_chars:
            return text
        cut = text[:max_chars].rsplit("\n", 1)[0]
        suffix = f"\n[... {label}tronqué à {max_chars} car. sur {len(text)}]"
        return cut + suffix

    def clean_metadata(text: str) -> str:
        """Supprime les entrées clé-valeur vides dans les champs de métadonnées Isagri."""
        if not text:
            return ""
        # Remplace "Clé : " suivi de rien ou d'un autre "Clé :" par rien
        text = _re.sub(r"\b[\w\s]+\s*:\s*(?=\s*(?:[\w\s]+\s*:|$))", "", text)
        text = _re.sub(r"\s{2,}", " ", text).strip()
        return text

    def display_name(assigned) -> str | None:
        return assigned.get("displayName") if isinstance(assigned, dict) else assigned

    def get_ac(fields: dict) -> str | None:
        """Isagri.Feature.CritereAcceptance prioritaire sur le champ standard."""
        return fields.get("Isagri.Feature.CritereAcceptance") or \
               fields.get("Microsoft.VSTS.Common.AcceptanceCriteria")

    def find_notes(fields: dict) -> str | None:
        for k in fields:
            if "notes" in k.lower():
                return k
        return None

    def hierarchy_child_ids(azdo_raw: dict) -> list[int]:
        ids = []
        for rel in azdo_raw.get("relations", []):
            if rel.get("rel") == "System.LinkTypes.Hierarchy-Forward":
                try:
                    ids.append(int(rel["url"].rstrip("/").split("/")[-1]))
                except (ValueError, KeyError):
                    pass
        return ids

    DEP_LABELS = {
        "System.LinkTypes.Dependency-Forward": "Dépend de",
        "System.LinkTypes.Dependency-Reverse": "Bloqué par",
        "System.LinkTypes.Related": "Lié à",
    }
    STORY_TYPES = {"User Story", "Enabler Story", "Bug"}
    TASK_TYPES  = {"Task"}

    # ── Récupération AZDO (tous champs + relations) ───────────────────────────
    azdo_raw:      dict[int, dict]  = {}
    azdo_comments: dict[int, list]  = {}

    try:
        azdo_client = AzdoSyncService(db)._build_client()

        async def fetch(wi_id: int, with_comments: bool = False):
            try:
                azdo_raw[wi_id] = await azdo_client.get_work_item_detail(wi_id)
            except Exception:
                return
            if with_comments:
                try:
                    azdo_comments[wi_id] = await azdo_client.get_work_item_comments(wi_id, top=5)
                except Exception:
                    pass

        await fetch(item.work_item_id, with_comments=True)
        root_raw = azdo_raw.get(item.work_item_id, {})
        root_wi_type = root_raw.get("fields", {}).get("System.WorkItemType", "")

        # Si c'est une story, fetcher aussi son parent enabler pour le contexte
        if root_wi_type in STORY_TYPES:
            parent_azdo_id = root_raw.get("fields", {}).get("Isagri.Agile.ParentId")
            if not parent_azdo_id and wi_db and wi_db.parent_id:
                parent_wi = db.query(WorkItem).filter(WorkItem.id == wi_db.parent_id).first()
                if parent_wi:
                    parent_azdo_id = parent_wi.id  # utilise l'id DB comme fallback
            if parent_azdo_id:
                try:
                    azdo_raw[int(parent_azdo_id)] = await azdo_client.get_work_item_detail(int(parent_azdo_id))
                except Exception:
                    pass

        # Fetcher les stories enfants du parent (pour les enablers/features)
        for cid in hierarchy_child_ids(root_raw):
            await fetch(cid, with_comments=True)
            ctype = azdo_raw.get(cid, {}).get("fields", {}).get("System.WorkItemType", "")
            if ctype in STORY_TYPES:
                for tid in hierarchy_child_ids(azdo_raw.get(cid, {})):
                    ctype_t = (await azdo_client.get_work_item_detail(tid)).get("fields", {}).get("System.WorkItemType", "")
                    if ctype_t in TASK_TYPES:
                        azdo_raw[tid] = await azdo_client.get_work_item_detail(tid)
    except Exception as azdo_err:
        _save_log("ERROR", f"AZDO fetch échoué WI#{item.work_item_id}", str(azdo_err))

    # Log du contenu récupéré depuis AZDO
    azdo_summary_parts = [f"WI#{wid}: {azdo_raw[wid].get('fields', {}).get('System.WorkItemType','?')} - {azdo_raw[wid].get('fields', {}).get('System.Title','?')[:80]}" for wid in azdo_raw]
    _save_log(
        "AZDO_FETCH",
        f"Fetch AZDO WI#{item.work_item_id} — {len(azdo_raw)} work items récupérés",
        _json.dumps({
            "work_items_fetched": list(azdo_raw.keys()),
            "summary": azdo_summary_parts,
            "comments_fetched": {str(k): len(v) for k, v in azdo_comments.items()},
            "raw_fields": {
                str(wid): {k: v for k, v in azdo_raw[wid].get("fields", {}).items()
                           if v is not None and str(v).strip() not in ("", "null")}
                for wid in azdo_raw
            },
        }, ensure_ascii=False, indent=2),
    )

    # ── Formatage parent (Enabler / Feature) ─────────────────────────────────

    def format_parent(wi_id: int) -> str:
        f     = azdo_raw.get(wi_id, {}).get("fields", {})
        raw   = azdo_raw.get(wi_id, {})
        wtype = f.get("System.WorkItemType") or (wi_db.type  if wi_db else "?")
        title = f.get("System.Title")        or (wi_db.title if wi_db else f"WI#{wi_id}")

        lines = [f"===== ENABLER / FEATURE PARENT #{wi_id} =====",
                 f"Type : {wtype}  |  Titre : {title}"]

        state     = f.get("System.State")        or (wi_db.state          if wi_db else None)
        iteration = f.get("System.IterationPath") or (wi_db.iteration_path if wi_db else None)
        assigned  = display_name(f.get("System.AssignedTo")) or (wi_db.assigned_to if wi_db else None)
        changed   = f.get("System.ChangedDate")

        if state:     lines.append(f"État : {state}")
        if iteration: lines.append(f"Itération : {iteration}")
        if assigned:  lines.append(f"Assigné à : {assigned}")
        if changed:
            try:
                changed = _dt.fromisoformat(changed.replace("Z", "+00:00")).strftime("%Y-%m-%d %H:%M")
            except Exception:
                pass
            lines.append(f"Dernière mise à jour : {changed}")

        effort = f.get("Microsoft.VSTS.Scheduling.Effort") or \
                 f.get("Microsoft.VSTS.Scheduling.OriginalEstimate") or \
                 (wi_db.original_estimate if wi_db else None)
        if effort: lines.append(f"Effort estimé : {effort}")

        # Champs Isagri spécifiques
        benefit = truncate(strip_html(f.get("Isagri.Feature.HypotheseBenefice")), 800, "bénéfice ")
        if benefit:
            lines.append(f"\nHypothèse de bénéfice :\n{benefit}")

        risks = truncate(strip_html(f.get("Isagri.Feature.RisquesEtDependances")), 600, "risques ")
        if risks:
            lines.append(f"\nRisques et dépendances :\n{risks}")

        autres = clean_metadata(strip_html(f.get("Isagri.Feature.AutresInformations") or ""))
        if autres:
            lines.append(f"\nAutres informations :\n{truncate(autres, 400, 'métadonnées ')}")

        desc = truncate(strip_html(f.get("System.Description") or (wi_db.description if wi_db else "")), 2000, "description ")
        if desc:
            lines.append(f"\nDescription :\n{desc}")

        ac = truncate(strip_html(get_ac(f) or (wi_db.acceptance_criteria if wi_db else "")), 1500, "AC ")
        if ac:
            lines.append(f"\nCritères d'acceptation :\n{ac}")

        notes_key = find_notes(f)
        if notes_key and f.get(notes_key):
            lines.append(f"\nNotes :\n{strip_html(f[notes_key])}")

        # Dépendances (hors hiérarchie)
        deps = [(DEP_LABELS[r["rel"]], r.get("url","").rstrip("/").split("/")[-1])
                for r in raw.get("relations", []) if r.get("rel") in DEP_LABELS]
        if deps:
            lines.append(f"\nRelations / Dépendances ({len(deps)}) :")
            for lbl, dep_id in deps[:8]:
                lines.append(f"  - {lbl} : WI#{dep_id}")

        return "\n".join(lines)

    # ── Formatage story enfant ────────────────────────────────────────────────

    def format_story(wi_id: int, standalone: bool = False) -> str:
        f     = azdo_raw.get(wi_id, {}).get("fields", {})
        wtype = f.get("System.WorkItemType", "Story")
        title = f.get("System.Title", f"WI#{wi_id}")

        if standalone:
            lines = [f"===== STORY #{wi_id} =====",
                     f"Type : {wtype}  |  Titre : {title}"]
        else:
            lines = [f"\n----- Story enfant #{wi_id} - {title} ({wtype}) -----"]

        state     = f.get("System.State")
        iteration = f.get("System.IterationPath")
        assigned  = display_name(f.get("System.AssignedTo"))
        sp        = f.get("Microsoft.VSTS.Scheduling.StoryPoints")

        if state:     lines.append(f"État : {state}")
        if iteration: lines.append(f"Itération : {iteration}")
        if assigned:  lines.append(f"Assigné à : {assigned}")
        if sp:        lines.append(f"Story Points : {sp}")

        desc = truncate(strip_html(f.get("System.Description") or ""), 1500, "description ")
        if desc:
            lines.append(f"\nDescription :\n{desc}")

        ac = truncate(strip_html(get_ac(f) or ""), 1500, "AC ")
        if ac:
            lines.append(f"\nCritères d'acceptation :\n{ac}")

        notes_key = find_notes(f)
        if notes_key and f.get(notes_key):
            lines.append(f"\nNotes :\n{strip_html(f[notes_key])}")

        # Tâches enfants
        task_ids = [tid for tid in hierarchy_child_ids(azdo_raw.get(wi_id, {}))
                    if azdo_raw.get(tid, {}).get("fields", {}).get("System.WorkItemType") in TASK_TYPES]
        if task_ids:
            lines.append(f"\nTâches enfants ({len(task_ids)}) :")
            for tid in task_ids:
                lines.append(format_task(tid))

        return "\n".join(lines)

    # ── Formatage tâche ───────────────────────────────────────────────────────

    def format_task(wi_id: int) -> str:
        f         = azdo_raw.get(wi_id, {}).get("fields", {})
        title     = f.get("System.Title", f"Tâche #{wi_id}")
        state     = f.get("System.State", "")
        assigned  = display_name(f.get("System.AssignedTo"))
        desc      = strip_html(f.get("System.Description") or "")
        original  = f.get("Microsoft.VSTS.Scheduling.OriginalEstimate")
        completed = f.get("Microsoft.VSTS.Scheduling.CompletedWork")
        activated = f.get("Microsoft.VSTS.Common.ActivatedDate")
        resolved  = f.get("Microsoft.VSTS.Common.ResolvedDate")

        parts = [f"  ~ Tâche #{wi_id} : {title}"]
        meta = [x for x in [state, f"assigné: {assigned}" if assigned else None] if x]
        if meta:       parts.append("    " + " | ".join(meta))
        if original:   parts.append(f"    Estimation : {original}h")
        if completed:  parts.append(f"    Réalisé : {completed}h")
        if activated:  parts.append(f"    Activée le : {activated[:10]}")
        if resolved:   parts.append(f"    Résolue le : {resolved[:10]}")
        if desc:       parts.append(f"    Description : {desc[:300]}")
        return "\n".join(parts)

    # ── Assemblage du contenu ─────────────────────────────────────────────────

    # Détecter le type du WI principal pour choisir le format
    root_type = azdo_raw.get(item.work_item_id, {}).get("fields", {}).get("System.WorkItemType") \
                or (wi_db.type if wi_db else "")
    root_is_story = root_type in STORY_TYPES

    if root_is_story:
        # Contexte parent si disponible
        root_fields = azdo_raw.get(item.work_item_id, {}).get("fields", {})
        parent_azdo_id = root_fields.get("Isagri.Agile.ParentId")
        parent_title   = root_fields.get("Isagri.Agile.ParentTitle", "")
        work_item_content = ""
        if parent_azdo_id and int(parent_azdo_id) in azdo_raw:
            work_item_content += format_parent(int(parent_azdo_id)) + "\n\n"
        elif parent_title:
            work_item_content += f"===== CONTEXTE PARENT =====\nTitre parent : {parent_title}\n\n"
        # Story analysée en standalone
        work_item_content += format_story(item.work_item_id, standalone=True)
    else:
        work_item_content = format_parent(item.work_item_id)

    for c in azdo_comments.get(item.work_item_id, []):
        author = c.get("createdBy", {}).get("displayName", "?")
        text = strip_html(c.get("text", "")).strip()
        if text:
            work_item_content += f"\n  [{author}] {text[:200]}"

    # Stories enfants — uniquement pour les parents (Enabler / Feature)
    story_ids: list[int] = []
    if not root_is_story:
        parent_raw = azdo_raw.get(item.work_item_id, {})
        story_ids  = [cid for cid in hierarchy_child_ids(parent_raw)
                      if azdo_raw.get(cid, {}).get("fields", {}).get("System.WorkItemType") in STORY_TYPES]
        if not story_ids:
            story_ids = [c.id for c in db.query(WorkItem).filter(WorkItem.parent_id == item.work_item_id).all()]

        for sid in story_ids:
            work_item_content += format_story(sid)
            for c in azdo_comments.get(sid, []):
                author = c.get("createdBy", {}).get("displayName", "?")
                text = strip_html(c.get("text", "")).strip()
                if text:
                    work_item_content += f"\n  [{author}] {text[:150]}"

    # ── Votes PBR ─────────────────────────────────────────────────────────────
    all_wi_ids = [item.work_item_id] + story_ids
    votes = db.query(PBRVote).filter(
        PBRVote.session_id == item.session_id,
        PBRVote.work_item_id.in_(all_wi_ids),
    ).all()
    pbr_lines = []
    for v in votes:
        if v.dor_compliant is not None or v.comment or v.story_points or v.charge_dev_days or v.charge_qa_days:
            parts = [f"WI#{v.work_item_id}"]
            if v.dor_compliant is not None:   parts.append(f"DOR={'Oui' if v.dor_compliant else 'Non'}")
            if v.story_points is not None:    parts.append(f"SP={v.story_points}")
            if v.charge_dev_days is not None: parts.append(f"Dev={v.charge_dev_days}j")
            if v.charge_qa_days is not None:  parts.append(f"QA={v.charge_qa_days}j")
            if v.comment:                     parts.append(f"Commentaire: {v.comment}")
            pbr_lines.append("- " + " | ".join(parts))
    pbr_notes = "\n".join(pbr_lines) or "Aucune note"

    from app.services.llm.client import LLMClient, SYSTEM_PROMPT_ENABLER, SYSTEM_PROMPT_STORY
    try:
        client = LLMClient(db)
        user_message = f"""Voici les données à analyser :

{work_item_content}

Notes PBR des participants :
{pbr_notes}"""

        system_used = SYSTEM_PROMPT_STORY if root_is_story else SYSTEM_PROMPT_ENABLER
        _save_log(
            "LLM_REQUEST",
            f"Prompt LLM WI#{item.work_item_id} ({client.provider}/{client.model}) — {'story' if root_is_story else 'enabler'} — {len(user_message)} car.",
            _json.dumps({
                "provider": client.provider,
                "model": client.model,
                "prompt_type": "story" if root_is_story else "enabler",
                "system_prompt_length": len(system_used),
                "user_message": user_message,
                "pbr_notes": pbr_notes,
            }, ensure_ascii=False, indent=2),
        )

        t0 = _time.monotonic()
        result = await client.analyze_dor(work_item_content, pbr_notes, is_story=root_is_story)
        duration_ms = int((_time.monotonic() - t0) * 1000)

        _save_log(
            "LLM_RESPONSE",
            f"Réponse LLM WI#{item.work_item_id} — note={result.get('note')} durée={duration_ms}ms",
            _json.dumps({
                "note": result.get("note"),
                "commentaire": result.get("commentaire", ""),
            }, ensure_ascii=False, indent=2),
            duration_ms=duration_ms,
        )

        item.ia_dor_note = int(result.get("note", 0))
        item.ia_comment = result.get("commentaire", "")
        item.ia_analyzed_at = datetime.utcnow()
        db.commit()
        db.refresh(item)
        return item
    except Exception as exc:
        _save_log("ERROR", f"Erreur LLM WI#{item.work_item_id}: {str(exc)[:200]}", str(exc))
        raise HTTPException(status_code=500, detail=f"Erreur IA : {exc}")


# ── Votes ─────────────────────────────────────────────────────────────────────

@router.get("/sessions/{session_id}/votes", response_model=list[VoteResponse])
def get_votes(session_id: int, db: Session = Depends(get_db)):
    return db.query(PBRVote).filter(PBRVote.session_id == session_id).all()


@router.post("/sessions/{session_id}/votes", response_model=VoteResponse, status_code=201)
def create_vote(session_id: int, payload: VoteCreate, db: Session = Depends(get_db)):
    vote = PBRVote(session_id=session_id, **payload.model_dump())
    db.add(vote)
    db.commit()
    db.refresh(vote)
    return vote


@router.put("/votes/{vote_id}", response_model=VoteResponse)
def update_vote(vote_id: int, payload: VoteUpdate, db: Session = Depends(get_db)):
    vote = db.query(PBRVote).filter(PBRVote.id == vote_id).first()
    if not vote:
        raise HTTPException(status_code=404, detail="Vote non trouvé")
    for key, value in payload.model_dump().items():
        setattr(vote, key, value)
    db.commit()
    db.refresh(vote)
    return vote


@router.delete("/votes/{vote_id}", status_code=204)
def delete_vote(vote_id: int, db: Session = Depends(get_db)):
    vote = db.query(PBRVote).filter(PBRVote.id == vote_id).first()
    if not vote:
        raise HTTPException(status_code=404, detail="Vote non trouvé")
    db.delete(vote)
    db.commit()
