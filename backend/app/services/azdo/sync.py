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
    def __init__(self, db: Session):
        self.db = db

    def _get_setting(self, key: str) -> str | None:
        row = self.db.query(AppSettings).filter(AppSettings.key == key).first()
        return row.value if row else None

    def _build_client(self) -> AzdoClient:
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

    async def sync_all(self) -> dict:
        client = self._build_client()
        team = self._get_setting("azdo_team") or ""
        counts = {"iterations": 0, "members": 0, "work_items": 0}

        try:
            # Synchronisation des itérations
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

            # Synchronisation des membres d'équipe
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

            # Synchronisation des work items
            query = (
                "SELECT [System.Id] FROM WorkItems "
                "WHERE [System.TeamProject] = @project "
                "AND [System.WorkItemType] IN ('User Story', 'Bug', 'Task', 'Feature', 'Enabler Story') "
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
                existing.synced_at = datetime.utcnow()
                counts["work_items"] += 1

            self.db.commit()

            total = sum(counts.values())
            log = SyncLog(
                status="success",
                details=json.dumps(counts, ensure_ascii=False),
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
