import httpx
import base64
from typing import Any


class AzdoClient:
    """Client HTTP pour l'API REST Azure DevOps."""

    API_VERSION = "7.0"

    def __init__(self, organization: str, project: str, pat: str):
        self.organization = organization
        self.project = project
        self.base_url = f"https://dev.azure.com/{organization}/{project}"
        token = base64.b64encode(f":{pat}".encode()).decode()
        self.headers = {
            "Authorization": f"Basic {token}",
            "Content-Type": "application/json",
        }

    async def get_iterations(self, team: str) -> list[dict]:
        url = f"{self.base_url}/_apis/work/teamsettings/iterations"
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                url,
                headers=self.headers,
                params={"api-version": self.API_VERSION, "$expand": "attributes"},
            )
            resp.raise_for_status()
            return resp.json().get("value", [])

    async def get_team_members(self, team: str) -> list[dict]:
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

    async def get_work_items(self, ids: list[int]) -> list[dict]:
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
