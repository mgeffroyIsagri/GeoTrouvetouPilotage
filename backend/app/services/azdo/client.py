"""Client HTTP asynchrone pour l'API REST Azure DevOps (lecture seule)."""

import httpx
import base64
from typing import Any


class AzdoClient:
    """Client HTTP pour l'API REST Azure DevOps.

    Toutes les opérations sont **en lecture seule** : aucune écriture n'est
    effectuée dans Azure DevOps.

    Args:
        organization: Nom de l'organisation ou URL complète
                      (``https://dev.azure.com/MonOrg`` ou ``MonOrg``).
        project:      Nom du projet Azure DevOps.
        pat:          Personal Access Token avec les permissions Work Items Read
                      et Iterations Read.
    """

    API_VERSION = "7.0"

    def __init__(self, organization: str, project: str, pat: str):
        # Accepte "https://dev.azure.com/MonOrg" ou juste "MonOrg"
        if organization.startswith("http"):
            organization = organization.rstrip("/").split("/")[-1]
        self.organization = organization
        self.project = project
        self.base_url = f"https://dev.azure.com/{organization}/{project}"
        token = base64.b64encode(f":{pat}".encode()).decode()
        self.headers = {
            "Authorization": f"Basic {token}",
            "Content-Type": "application/json",
        }

    async def get_iterations(self, team: str) -> list[dict]:
        """Retourne les itérations configurées pour l'équipe.

        Args:
            team: Nom de l'équipe (chaîne vide → itérations du projet entier).

        Returns:
            Liste des objets itération AZDO (avec attributs startDate / finishDate).
        """
        team = (team or "").strip()
        team_segment = f"/{team}" if team else ""
        url = f"https://dev.azure.com/{self.organization}/{self.project}{team_segment}/_apis/work/teamsettings/iterations"
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                url,
                headers=self.headers,
                params={"api-version": self.API_VERSION, "$expand": "attributes"},
            )
            resp.raise_for_status()
            return resp.json().get("value", [])

    async def get_team_members(self, team: str) -> list[dict]:
        """Retourne les membres de l'équipe avec leurs identités AZDO.

        Args:
            team: Nom de l'équipe Azure DevOps.

        Returns:
            Liste des objets membre (``identity.displayName``, ``identity.uniqueName``…).
        """
        url = f"https://dev.azure.com/{self.organization}/_apis/projects/{self.project}/teams/{team}/members"
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                url,
                headers=self.headers,
                params={"api-version": self.API_VERSION},
            )
            resp.raise_for_status()
            return resp.json().get("value", [])

    async def run_wiql(self, query: str) -> list[int]:
        """Exécute une requête WIQL et retourne la liste des IDs de work items.

        Args:
            query: Requête WIQL (``SELECT [System.Id] FROM WorkItems WHERE ...``).

        Returns:
            Liste ordonnée des identifiants de work items correspondants.
        """
        url = f"{self.base_url}/_apis/wit/wiql"
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                url,
                headers=self.headers,
                params={"api-version": self.API_VERSION},
                json={"query": query},
            )
            resp.raise_for_status()
            items = resp.json().get("workItems", [])
            return [item["id"] for item in items]

    async def get_work_item_detail(self, work_item_id: int) -> dict:
        """Récupère un work item avec TOUS ses champs + relations.
        Note : AZDO refuse la combinaison fields= + $expand=relations,
        donc on fetche tous les champs sans filtre."""
        url = f"{self.base_url}/_apis/wit/workitems/{work_item_id}"
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                url,
                headers=self.headers,
                params={"$expand": "relations", "api-version": self.API_VERSION},
            )
            resp.raise_for_status()
            return resp.json()

    async def get_work_item_comments(self, work_item_id: int, top: int = 10) -> list[dict]:
        """Récupère les commentaires/discussion d'un work item."""
        url = f"{self.base_url}/_apis/wit/workitems/{work_item_id}/comments"
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                url,
                headers=self.headers,
                params={"$top": top, "api-version": "7.1-preview.3"},
            )
            resp.raise_for_status()
            return resp.json().get("comments", [])

    async def get_work_items(self, ids: list[int]) -> list[dict]:
        """Récupère plusieurs work items en lot (champs standards uniquement).

        Les IDs sont découpés en tranches de 200 pour respecter la limite AZDO.

        Args:
            ids: Liste des identifiants de work items à récupérer.

        Returns:
            Liste des objets work item avec leurs champs (``fields`` dict).
        """
        if not ids:
            return []
        # AZDO limite à 200 IDs par requête
        results = []
        for chunk in [ids[i : i + 200] for i in range(0, len(ids), 200)]:
            url = f"{self.base_url}/_apis/wit/workitems"
            fields = [
                "System.Id",
                "System.Title",
                "System.WorkItemType",
                "System.State",
                "System.IterationPath",
                "System.AssignedTo",
                "System.Description",
                "Microsoft.VSTS.Common.AcceptanceCriteria",
                "Microsoft.VSTS.Scheduling.StoryPoints",
                "Microsoft.VSTS.Scheduling.OriginalEstimate",
                "Microsoft.VSTS.Scheduling.CompletedWork",
                "Microsoft.VSTS.Scheduling.RemainingWork",
                "System.Parent",
                "Microsoft.VSTS.Common.BusinessValue",
                "Microsoft.VSTS.Scheduling.Effort",
            ]
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    url,
                    headers=self.headers,
                    params={
                        "ids": ",".join(str(i) for i in chunk),
                        "fields": ",".join(fields),
                        "api-version": self.API_VERSION,
                    },
                )
                resp.raise_for_status()
                results.extend(resp.json().get("value", []))
        return results

    async def get_classification_nodes(self, depth: int = 10) -> dict:
        """Retourne l'arbre des nœuds de classification Iterations du projet."""
        url = f"{self.base_url}/_apis/wit/classificationnodes/iterations"
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                url, headers=self.headers,
                params={"$depth": depth, "api-version": self.API_VERSION},
            )
            resp.raise_for_status()
            return resp.json()

    async def create_classification_node(
        self, parent_relative_path: str, name: str,
        start_date: str | None = None, finish_date: str | None = None,
    ) -> dict:
        """Crée un nœud d'itération enfant sous un parent donné.

        Args:
            parent_relative_path: Chemin relatif depuis la racine Iterations,
                                   séparateurs "/" ou "\\", sans le nom du projet.
                                   Ex: "2025-2026/P.I.26.03" ou "2025-2026/P.I.26.03/GeoTrouveTou".
            name: Nom du nœud à créer (ex: "Sprint 1").
        """
        import urllib.parse
        segments = [s for s in parent_relative_path.replace("\\", "/").split("/") if s]
        encoded = "/".join(urllib.parse.quote(s, safe="") for s in segments)
        url = f"{self.base_url}/_apis/wit/classificationnodes/iterations/{encoded}" if encoded else f"{self.base_url}/_apis/wit/classificationnodes/iterations"
        body: dict[str, Any] = {"name": name}
        if start_date and finish_date:
            body["attributes"] = {"startDate": start_date, "finishDate": finish_date}
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                url, headers=self.headers,
                params={"api-version": self.API_VERSION}, json=body,
            )
            resp.raise_for_status()
            return resp.json()

    async def update_work_item(self, work_item_id: int, patch_ops: list[dict]) -> dict:
        """Met à jour un work item via JSON Patch (RFC 6902).

        Args:
            work_item_id: Identifiant AZDO du work item.
            patch_ops: Liste d'opérations JSON Patch,
                       ex: [{"op": "replace", "path": "/fields/System.State", "value": "Closed"}].

        Raises:
            httpx.HTTPStatusError avec le corps de réponse AZDO inclus dans le message.
        """
        url = f"{self.base_url}/_apis/wit/workitems/{work_item_id}"
        headers = {**self.headers, "Content-Type": "application/json-patch+json"}
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.patch(
                url, headers=headers,
                params={"api-version": self.API_VERSION}, json=patch_ops,
            )
            if resp.is_error:
                try:
                    detail = resp.json()
                    msg = detail.get("message") or detail.get("value", {}).get("Message") or resp.text
                except Exception:
                    msg = resp.text
                raise httpx.HTTPStatusError(
                    f"AZDO {resp.status_code}: {msg}",
                    request=resp.request,
                    response=resp,
                )
            return resp.json()

    async def create_work_item(self, work_item_type: str, patch_ops: list[dict]) -> dict:
        """Crée un nouveau work item du type spécifié.

        Args:
            work_item_type: Type AZDO (ex: "Task", "Bug", "User Story").
            patch_ops: Opérations JSON Patch pour les champs du work item.
        """
        import urllib.parse
        wtype_encoded = urllib.parse.quote(work_item_type, safe="")
        url = f"{self.base_url}/_apis/wit/workitems/${wtype_encoded}"
        headers = {**self.headers, "Content-Type": "application/json-patch+json"}
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                url, headers=headers,
                params={"api-version": self.API_VERSION}, json=patch_ops,
            )
            resp.raise_for_status()
            return resp.json()
