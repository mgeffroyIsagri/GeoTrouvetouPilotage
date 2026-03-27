"""Endpoints KPI du Train — gestion des équipes et analyse Git AZDO par PI.

Les équipes du train (``TrainTeam``) sont des entités de configuration
indépendantes du PI. Les entrées KPI (``TrainKpiEntry``) sont générées par
l'analyse automatique des commits AZDO et enrichies par saisie manuelle de
la capacité.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db, SessionLocal
from app.models.train_kpi import TrainTeam, TrainKpiEntry
from app.services.azdo.commits import TrainKpiAnalyzer

router = APIRouter()

# ── Store de jobs (polling Option A) ──────────────────────────────────────────
# Dictionnaire en mémoire : job_id → état de progression.
# Nettoyé automatiquement des jobs terminés depuis plus d'une heure.

_jobs: dict[str, dict[str, Any]] = {}


def _cleanup_old_jobs() -> None:
    """Supprime du store les jobs terminés depuis plus d'une heure."""
    now = datetime.utcnow()
    to_delete = [
        jid for jid, job in _jobs.items()
        if job["status"] in ("done", "error")
        and (now - job["started_at"]).total_seconds() > 3600
    ]
    for jid in to_delete:
        del _jobs[jid]


async def _run_analysis_job(job_id: str, pi_id: int, team_id: int) -> None:
    """Tâche de fond : analyse les commits AZDO et met à jour le store de progression.

    Crée sa propre session SQLAlchemy (indépendante de la session HTTP fermée
    au moment du retour de la réponse initiale).

    Args:
        job_id:  Identifiant unique du job dans ``_jobs``.
        pi_id:   Identifiant du PI à analyser.
        team_id: Identifiant de l'équipe à analyser.
    """
    db = SessionLocal()
    try:
        def on_progress(current: int, total: int, repo: str) -> None:
            if job_id in _jobs:
                _jobs[job_id]["current_commit"] = current
                _jobs[job_id]["total_commits"] = total
                _jobs[job_id]["current_repo"] = repo

        analyzer = TrainKpiAnalyzer(db, progress_callback=on_progress)
        result = await analyzer.analyze(pi_id, team_id)
        if job_id in _jobs:
            _jobs[job_id].update({
                "status": "done",
                "result": result,
                "current_commit": _jobs[job_id].get("total_commits", 0),
            })
    except Exception as exc:
        if job_id in _jobs:
            _jobs[job_id].update({"status": "error", "error": str(exc)})
    finally:
        db.close()


# ── Schémas Pydantic ──────────────────────────────────────────────────────────


class TeamCreate(BaseModel):
    """Payload de création d'une équipe du train."""

    name: str
    azdo_repos: list[str]
    branch_filter: str = "main"
    color: Optional[str] = None


class TeamUpdate(BaseModel):
    """Payload de mise à jour partielle d'une équipe du train (tous champs optionnels)."""

    name: Optional[str] = None
    azdo_repos: Optional[list[str]] = None
    branch_filter: Optional[str] = None
    color: Optional[str] = None


class TeamResponse(BaseModel):
    """Représentation complète d'une équipe du train en réponse."""

    id: int
    name: str
    azdo_repos: list[str]
    branch_filter: str
    color: Optional[str]

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm_team(cls, team: TrainTeam) -> "TeamResponse":
        """Construit un ``TeamResponse`` depuis un objet ORM ``TrainTeam``.

        Args:
            team: Instance ORM ``TrainTeam``.

        Returns:
            Schéma Pydantic peuplé.
        """
        return cls(
            id=team.id,
            name=team.name,
            azdo_repos=team.repos_list,
            branch_filter=team.branch_filter,
            color=team.color,
        )


class KpiEntryResponse(BaseModel):
    """Représentation d'une entrée KPI (PI × équipe) en réponse."""

    id: int
    pi_id: int
    team_id: int
    team: TeamResponse
    capacity_days: Optional[float]
    lines_added: int
    lines_deleted: int
    commits_count: int
    files_changed: int
    is_partial: bool
    analyzed_at: Optional[str]

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm_entry(cls, entry: TrainKpiEntry) -> "KpiEntryResponse":
        """Construit un ``KpiEntryResponse`` depuis un objet ORM ``TrainKpiEntry``.

        Args:
            entry: Instance ORM ``TrainKpiEntry`` avec la relation ``team`` chargée.

        Returns:
            Schéma Pydantic peuplé.
        """
        return cls(
            id=entry.id,
            pi_id=entry.pi_id,
            team_id=entry.team_id,
            team=TeamResponse.from_orm_team(entry.team),
            capacity_days=entry.capacity_days,
            lines_added=entry.lines_added,
            lines_deleted=entry.lines_deleted,
            commits_count=entry.commits_count,
            files_changed=entry.files_changed,
            is_partial=entry.is_partial,
            analyzed_at=entry.analyzed_at.isoformat() if entry.analyzed_at else None,
        )


class CapacityUpdate(BaseModel):
    """Payload pour la mise à jour manuelle de la capacité d'une entrée KPI."""

    capacity_days: float


# ── Endpoints équipes ─────────────────────────────────────────────────────────


@router.get("/teams", response_model=list[TeamResponse])
def list_teams(db: Session = Depends(get_db)):
    """Retourne la liste de toutes les équipes du train.

    Returns:
        Liste des équipes triées par nom.
    """
    teams = db.query(TrainTeam).order_by(TrainTeam.name).all()
    return [TeamResponse.from_orm_team(t) for t in teams]


@router.post("/teams", response_model=TeamResponse, status_code=201)
def create_team(payload: TeamCreate, db: Session = Depends(get_db)):
    """Crée une nouvelle équipe du train.

    Args:
        payload: Données de l'équipe (name, azdo_repos, branch_filter, color).

    Returns:
        L'équipe créée avec son identifiant.
    """
    team = TrainTeam(
        name=payload.name,
        azdo_repos=json.dumps(payload.azdo_repos, ensure_ascii=False),
        branch_filter=payload.branch_filter,
        color=payload.color,
    )
    db.add(team)
    db.commit()
    db.refresh(team)
    return TeamResponse.from_orm_team(team)


@router.put("/teams/{team_id}", response_model=TeamResponse)
def update_team(team_id: int, payload: TeamUpdate, db: Session = Depends(get_db)):
    """Met à jour partiellement une équipe du train.

    Seuls les champs fournis (non-None) sont modifiés.

    Args:
        team_id: Identifiant de l'équipe à modifier.
        payload: Champs à mettre à jour.

    Returns:
        L'équipe mise à jour.

    Raises:
        HTTPException 404: Si l'équipe n'existe pas.
    """
    team = db.query(TrainTeam).filter(TrainTeam.id == team_id).first()
    if team is None:
        raise HTTPException(status_code=404, detail="Équipe introuvable.")

    if payload.name is not None:
        team.name = payload.name
    if payload.azdo_repos is not None:
        team.azdo_repos = json.dumps(payload.azdo_repos, ensure_ascii=False)
    if payload.branch_filter is not None:
        team.branch_filter = payload.branch_filter
    if payload.color is not None:
        team.color = payload.color

    db.commit()
    db.refresh(team)
    return TeamResponse.from_orm_team(team)


@router.delete("/teams/{team_id}", status_code=204)
def delete_team(team_id: int, db: Session = Depends(get_db)):
    """Supprime une équipe du train ainsi que toutes ses entrées KPI.

    Args:
        team_id: Identifiant de l'équipe à supprimer.

    Raises:
        HTTPException 404: Si l'équipe n'existe pas.
    """
    team = db.query(TrainTeam).filter(TrainTeam.id == team_id).first()
    if team is None:
        raise HTTPException(status_code=404, detail="Équipe introuvable.")
    db.delete(team)
    db.commit()


# ── Endpoints KPI par PI ──────────────────────────────────────────────────────


@router.get("/pi/{pi_id}", response_model=list[KpiEntryResponse])
def list_kpi_entries(pi_id: int, db: Session = Depends(get_db)):
    """Retourne toutes les entrées KPI pour un PI donné (toutes équipes).

    Args:
        pi_id: Identifiant du PI.

    Returns:
        Liste des entrées KPI, chacune avec les détails de l'équipe imbriqués.
    """
    entries = (
        db.query(TrainKpiEntry)
        .filter(TrainKpiEntry.pi_id == pi_id)
        .all()
    )
    return [KpiEntryResponse.from_orm_entry(e) for e in entries]


@router.put("/pi/{pi_id}/team/{team_id}/capacity", response_model=KpiEntryResponse)
def update_capacity(
    pi_id: int,
    team_id: int,
    payload: CapacityUpdate,
    db: Session = Depends(get_db),
):
    """Met à jour la capacité manuelle (en jours) pour une entrée KPI.

    Si aucune entrée n'existe encore pour ce couple PI × équipe, elle est créée
    avec les métriques Git à zéro.

    Args:
        pi_id:   Identifiant du PI.
        team_id: Identifiant de l'équipe.
        payload: Nouveau nombre de jours de capacité.

    Returns:
        L'entrée KPI mise à jour.

    Raises:
        HTTPException 404: Si l'équipe n'existe pas.
    """
    # Vérifier que l'équipe existe
    team = db.query(TrainTeam).filter(TrainTeam.id == team_id).first()
    if team is None:
        raise HTTPException(status_code=404, detail="Équipe introuvable.")

    entry = (
        db.query(TrainKpiEntry)
        .filter(TrainKpiEntry.pi_id == pi_id, TrainKpiEntry.team_id == team_id)
        .first()
    )
    if entry is None:
        entry = TrainKpiEntry(pi_id=pi_id, team_id=team_id)
        db.add(entry)

    entry.capacity_days = payload.capacity_days
    db.commit()
    db.refresh(entry)
    return KpiEntryResponse.from_orm_entry(entry)


@router.post("/pi/{pi_id}/analyze")
async def analyze_all_teams(pi_id: int, db: Session = Depends(get_db)):
    """Lance l'analyse des commits AZDO pour toutes les équipes du PI.

    Chaque équipe est analysée séquentiellement. Les erreurs par équipe sont
    collectées et retournées sans interrompre l'analyse des autres équipes.

    Args:
        pi_id: Identifiant du PI à analyser.

    Returns:
        Dictionnaire ``{"results": list, "errors": list}`` avec le détail
        des métriques par équipe et les erreurs éventuelles.
    """
    teams = db.query(TrainTeam).order_by(TrainTeam.name).all()
    analyzer = TrainKpiAnalyzer(db)
    results = []
    errors = []

    for team in teams:
        try:
            result = await analyzer.analyze(pi_id, team.id)
            results.append(result)
        except Exception as exc:
            errors.append({"team_id": team.id, "team_name": team.name, "error": str(exc)})

    return {"results": results, "errors": errors}


@router.post("/pi/{pi_id}/team/{team_id}/analyze", response_model=KpiEntryResponse)
async def analyze_one_team(
    pi_id: int,
    team_id: int,
    db: Session = Depends(get_db),
):
    """Lance l'analyse des commits AZDO pour une équipe spécifique sur un PI.

    Args:
        pi_id:   Identifiant du PI.
        team_id: Identifiant de l'équipe.

    Returns:
        L'entrée KPI mise à jour avec les métriques calculées.

    Raises:
        HTTPException 404: Si l'équipe ou le PI est introuvable.
        HTTPException 422: En cas d'erreur lors de l'analyse (AZDO inaccessible,
                           paramètres manquants, etc.).
    """
    # Vérifier l'existence de l'équipe
    team = db.query(TrainTeam).filter(TrainTeam.id == team_id).first()
    if team is None:
        raise HTTPException(status_code=404, detail="Équipe introuvable.")

    analyzer = TrainKpiAnalyzer(db)
    try:
        await analyzer.analyze(pi_id, team_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Erreur lors de l'analyse : {exc}",
        ) from exc

    entry = (
        db.query(TrainKpiEntry)
        .filter(TrainKpiEntry.pi_id == pi_id, TrainKpiEntry.team_id == team_id)
        .first()
    )
    return KpiEntryResponse.from_orm_entry(entry)


# ── Endpoints analyse asynchrone (Option A polling) ───────────────────────────


@router.post("/pi/{pi_id}/team/{team_id}/analyze-async")
async def analyze_one_team_async(pi_id: int, team_id: int, db: Session = Depends(get_db)):
    """Démarre l'analyse commits pour une équipe en tâche de fond et retourne un job_id.

    Le client doit ensuite interroger ``GET /jobs/{job_id}`` toutes les 500 ms
    pour suivre la progression et récupérer le résultat final.

    Returns:
        ``{"job_id": str}`` — identifiant à utiliser pour le polling.

    Raises:
        HTTPException 404: Si l'équipe n'existe pas.
    """
    team = db.query(TrainTeam).filter(TrainTeam.id == team_id).first()
    if team is None:
        raise HTTPException(status_code=404, detail="Équipe introuvable.")

    _cleanup_old_jobs()
    job_id = str(uuid.uuid4())[:8]
    _jobs[job_id] = {
        "status": "running",
        "pi_id": pi_id,
        "team_id": team_id,
        "team_name": team.name,
        "current_commit": 0,
        "total_commits": 0,
        "current_repo": "",
        "started_at": datetime.utcnow(),
        "result": None,
        "error": None,
    }
    asyncio.create_task(_run_analysis_job(job_id, pi_id, team_id))
    return {"job_id": job_id}


@router.get("/jobs/{job_id}")
async def get_job_progress(job_id: str):
    """Retourne l'état de progression d'un job d'analyse asynchrone.

    Returns:
        Dictionnaire : status, current_commit, total_commits, current_repo, result, error.

    Raises:
        HTTPException 404: Si le job_id est inconnu ou expiré.
    """
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job introuvable ou expiré.")
    return {
        "status": job["status"],
        "team_name": job["team_name"],
        "current_commit": job["current_commit"],
        "total_commits": job["total_commits"],
        "current_repo": job["current_repo"],
        "result": job.get("result"),
        "error": job.get("error"),
    }
