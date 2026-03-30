"""Orchestration de la synchronisation Azure DevOps → base de données locale.

Ce module expose ``AzdoSyncService``, le point d'entrée unique pour :
- tester la connexion AZDO (``test_connection``)
- synchroniser itérations, membres et work items (``sync_all``)

Toutes les opérations AZDO sont **en lecture seule**.
"""

import json
from datetime import datetime
from sqlalchemy.orm import Session

from app.services.azdo.client import AzdoClient
from app.services.azdo.errors import map_azdo_error
from app.models.work_item import WorkItem
from app.models.iteration import Iteration
from app.models.team_member import TeamMember
from app.models.sync_log import SyncLog
from app.models.app_settings import AppSettings


class AzdoSyncService:
    """Service d'orchestration de la synchronisation Azure DevOps.

    Args:
        db: Session SQLAlchemy active fournie par l'injection de dépendances.
    """

    def __init__(self, db: Session):
        self.db = db

    def _get_setting(self, key: str) -> str | None:
        """Lit un paramètre applicatif et déchiffre les clés sensibles.

        Args:
            key: Clé dans la table ``app_settings``.

        Returns:
            Valeur déchiffrée (ou en clair si non sensible), ou ``None`` si absente.
        """
        row = self.db.query(AppSettings).filter(AppSettings.key == key).first()
        value = row.value if row else None
        from app.services.crypto import decrypt_value, SENSITIVE_KEYS
        return decrypt_value(value) if key in SENSITIVE_KEYS else value

    def _build_client(self) -> AzdoClient:
        """Construit un ``AzdoClient`` à partir des paramètres stockés en base.

        Raises:
            ValueError: Si l'organisation, le projet ou le PAT sont manquants.
        """
        org = self._get_setting("azdo_organization")
        project = self._get_setting("azdo_project")
        pat = self._get_setting("azdo_pat")
        if not all([org, project, pat]):
            raise ValueError("Paramètres AZDO incomplets. Vérifiez l'organisation, le projet et le PAT.")
        return AzdoClient(org, project, pat)

    async def test_connection(self) -> dict:
        """Teste la connexion AZDO sans écrire en base."""
        try:
            client = self._build_client()
            team = self._get_setting("azdo_team") or ""
            iterations = await client.get_iterations(team)
            return {
                "ok": True,
                "error": None,
                "details": f"{len(iterations)} itération(s) trouvée(s)",
            }
        except Exception as exc:
            return {
                "ok": False,
                "error": map_azdo_error(exc),
                "details": None,
            }

    def _last_successful_sync_date(self) -> datetime | None:
        """Retourne la date de la dernière synchro réussie, ou None si aucune."""
        log = (
            self.db.query(SyncLog)
            .filter(SyncLog.status == "success")
            .order_by(SyncLog.synced_at.desc())
            .first()
        )
        return log.synced_at if log else None

    async def sync_all(self, full_sync: bool = False, since_date: datetime | None = None) -> dict:
        """Synchronise itérations, membres et work items depuis AZDO.

        Args:
            full_sync:  Si ``True``, ignore le filtre de date (synchro complète).
            since_date: Date minimale de modification pour le filtre incrémental.
                        Si ``None`` et ``full_sync=False``, utilise la date de la
                        dernière synchro réussie.

        Returns:
            Dictionnaire ``{"items_synced": int, "counts": {"iterations": int, ...}}``.

        Raises:
            ValueError: En cas d'erreur AZDO (message traduit par ``map_azdo_error``).
        """
        client = self._build_client()
        team = self._get_setting("azdo_team") or ""
        counts = {"iterations": 0, "members": 0, "work_items": 0}

        # Détermine la date de filtrage
        if full_sync:
            since_date = None  # Pas de filtre → synchro complète
        elif since_date is None:
            since_date = self._last_successful_sync_date()  # Auto-détection

        try:
            # ── Synchronisation des itérations ────────────────────────────────
            iterations = await client.get_iterations(team)
            for it in iterations:
                attrs = it.get("attributes", {})
                existing = self.db.query(Iteration).filter(Iteration.azdo_id == it["id"]).first()
                if not existing:
                    existing = Iteration(azdo_id=it["id"])
                    self.db.add(existing)
                existing.name = it.get("name", "")
                existing.path = it.get("path", "")
                if attrs.get("startDate"):
                    existing.start_date = datetime.fromisoformat(attrs["startDate"][:10]).date()
                if attrs.get("finishDate"):
                    existing.end_date = datetime.fromisoformat(attrs["finishDate"][:10]).date()
                counts["iterations"] += 1
            self.db.commit()

            # ── Synchronisation des membres d'équipe ──────────────────────────
            if team:
                members = await client.get_team_members(team)
                for m in members:
                    identity = m.get("identity", {})
                    azdo_id = identity.get("id")
                    existing = self.db.query(TeamMember).filter(TeamMember.azdo_id == azdo_id).first()
                    if not existing:
                        existing = TeamMember(azdo_id=azdo_id)
                        self.db.add(existing)
                    existing.display_name = identity.get("displayName", "")
                    existing.unique_name = identity.get("uniqueName", "")
                    counts["members"] += 1
                self.db.commit()

            # ── Synchronisation des work items ────────────────────────────────
            date_filter = ""
            if since_date:
                since_str = since_date.strftime("%Y-%m-%d")
                date_filter = f"AND [System.ChangedDate] >= '{since_str}' "

            query = (
                "SELECT [System.Id] FROM WorkItems "
                "WHERE [System.TeamProject] = @project "
                "AND [System.WorkItemType] IN ('User Story', 'Bug', 'Task', 'Feature', 'Enabler Story', 'Enabler', 'Question', 'Maintenance') "
                f"{date_filter}"
                "ORDER BY [System.Id]"
            )
            ids = await client.run_wiql(query)
            work_items = await client.get_work_items(ids)

            for wi in work_items:
                fields = wi.get("fields", {})
                wi_id = fields.get("System.Id")
                existing = self.db.query(WorkItem).filter(WorkItem.id == wi_id).first()
                if not existing:
                    existing = WorkItem(id=wi_id)
                    self.db.add(existing)
                existing.type = fields.get("System.WorkItemType", "")
                existing.title = fields.get("System.Title", "")
                existing.state = fields.get("System.State")
                existing.iteration_path = fields.get("System.IterationPath")
                assigned = fields.get("System.AssignedTo")
                existing.assigned_to = assigned.get("displayName") if isinstance(assigned, dict) else assigned
                existing.description = fields.get("System.Description")
                existing.acceptance_criteria = fields.get("Microsoft.VSTS.Common.AcceptanceCriteria")
                existing.story_points = fields.get("Microsoft.VSTS.Scheduling.StoryPoints")
                existing.original_estimate = fields.get("Microsoft.VSTS.Scheduling.OriginalEstimate")
                existing.completed_work = fields.get("Microsoft.VSTS.Scheduling.CompletedWork")
                existing.remaining_work = fields.get("Microsoft.VSTS.Scheduling.RemainingWork")
                existing.parent_id = fields.get("System.Parent")
                existing.business_value = fields.get("Microsoft.VSTS.Common.BusinessValue")
                existing.effort = fields.get("Microsoft.VSTS.Scheduling.Effort")
                existing.synced_at = datetime.utcnow()
                counts["work_items"] += 1

            self.db.commit()

            total = sum(counts.values())
            details = dict(counts)
            details["mode"] = "full" if full_sync else "incremental"
            if since_date:
                details["since"] = since_date.isoformat()
            log = SyncLog(
                status="success",
                details=json.dumps(details, ensure_ascii=False),
                items_synced=total,
            )
            self.db.add(log)
            self.db.commit()

        except Exception as exc:
            self.db.rollback()
            error_msg = map_azdo_error(exc)
            log = SyncLog(
                status="error",
                details=error_msg,
                items_synced=sum(counts.values()),
            )
            self.db.add(log)
            self.db.commit()
            raise ValueError(error_msg) from exc

        return {"items_synced": sum(counts.values()), "counts": counts}
