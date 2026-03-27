"""Service d'analyse des commits Azure DevOps pour les KPIs du Train.

Ce module expose ``TrainKpiAnalyzer``, qui interroge l'API Git AZDO pour
agréger les métriques de commits (lignes ajoutées/supprimées, nombre de
commits, fichiers modifiés) sur la période d'un PI pour une équipe donnée.

Toutes les opérations sont **en lecture seule** vis-à-vis d'Azure DevOps.
"""

from __future__ import annotations

import asyncio
import difflib
import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy.orm import Session

from app.models.app_settings import AppSettings
from app.models.iteration import Iteration
from app.models.train_kpi import TrainTeam, TrainKpiEntry
from app.services.azdo.client import AzdoClient

logger = logging.getLogger(__name__)

# Nombre maximum de commits récupérés par repo (limite API AZDO)
_COMMITS_TOP = 500
# Nombre maximum de commits pour lesquels on calcule les stats de lignes
_STATS_MAX_PER_REPO = 200
# Nombre maximum de fichiers analysés par commit pour les stats de lignes
_MAX_FILES_PER_COMMIT = 10
# Nombre maximum de requêtes AZDO simultanées (contrôle du débit)
_CONCURRENCY = 10

# Préfixes identifiant les merge commits à exclure de l'analyse
_MERGE_PREFIXES = ("Merged PR", "Merge branch", "Merge pull request")


def _is_merge_commit(message: str) -> bool:
    """Retourne ``True`` si le message de commit correspond à un merge automatique.

    Args:
        message: Message du commit AZDO.

    Returns:
        ``True`` si le commit doit être exclu de l'analyse.
    """
    msg = (message or "").strip()
    return any(msg.startswith(prefix) for prefix in _MERGE_PREFIXES)


def _diff_line_counts(old_content: str, new_content: str) -> tuple[int, int]:
    """Calcule les lignes ajoutées et supprimées entre deux versions de fichier.

    Utilise ``difflib.unified_diff`` pour produire un diff unifié et compte
    les lignes commençant par ``+`` (ajouts) et ``-`` (suppressions), en
    excluant les marqueurs d'en-tête ``+++`` / ``---``.

    Args:
        old_content: Contenu de l'ancienne version (texte brut).
        new_content: Contenu de la nouvelle version (texte brut).

    Returns:
        Tuple ``(lines_added, lines_deleted)``.
    """
    diff = list(difflib.unified_diff(
        old_content.splitlines(),
        new_content.splitlines(),
        lineterm="",
    ))
    added = sum(1 for ln in diff if ln.startswith("+") and not ln.startswith("+++"))
    deleted = sum(1 for ln in diff if ln.startswith("-") and not ln.startswith("---"))
    return added, deleted


class TrainKpiAnalyzer:
    """Analyse les commits AZDO pour une équipe sur la période d'un PI.

    Flow d'analyse par repo :

    1. ``GET /commits`` — liste des commits sur la branche et la période du PI.
       La réponse inclut directement ``changeCounts`` (Add/Edit/Delete fichiers).
    2. ``GET /commits/{id}`` — détail du commit pour récupérer ``parents[0]``.
    3. ``GET /commits/{id}/changes`` — liste des fichiers modifiés avec leur chemin
       et ``changeType`` (add / edit / delete).
    4. ``GET /items?path=…&version=commitId`` — contenu du fichier à une révision
       donnée, pour calculer les lignes via ``difflib`` côté client.

    Les requêtes vers AZDO sont limitées à ``_CONCURRENCY`` en parallèle via
    un ``asyncio.Semaphore`` pour ne pas saturer le débit de l'API.

    Args:
        db:                Session SQLAlchemy active fournie par l'injection de dépendances.
        progress_callback: Callable optionnel ``(current: int, total: int, repo: str) -> None``
                           appelé à chaque commit analysé pour permettre un suivi de progression.
    """

    def __init__(self, db: Session, progress_callback=None):
        self.db = db
        self._progress_callback = progress_callback
        self._progress_current = 0
        self._progress_total = 0
        self._semaphore = asyncio.Semaphore(_CONCURRENCY)

    def _report(self, current: int, total: int, repo: str) -> None:
        """Notifie le callback de progression si présent."""
        if self._progress_callback:
            self._progress_callback(current, total, repo)

    # ── Accès aux paramètres ─────────────────────────────────────────────────

    def _get_setting(self, key: str) -> str | None:
        """Lit un paramètre applicatif et déchiffre les clés sensibles."""
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
            raise ValueError(
                "Paramètres AZDO incomplets. Vérifiez l'organisation, le projet et le PAT."
            )
        return AzdoClient(org, project, pat)

    # ── Récupération des dates du PI ─────────────────────────────────────────

    def _get_pi_dates(self, pi_id: int) -> tuple[datetime, datetime]:
        """Retourne les dates de début et de fin d'un PI via ses itérations.

        Args:
            pi_id: Identifiant du PI.

        Returns:
            Tuple ``(start_datetime, end_datetime)`` en UTC.

        Raises:
            ValueError: Si le PI n'a pas d'itérations avec des dates.
        """
        iterations = (
            self.db.query(Iteration)
            .filter(Iteration.pi_id == pi_id)
            .order_by(Iteration.start_date)
            .all()
        )
        if not iterations:
            raise ValueError(f"Aucune itération trouvée pour le PI {pi_id}.")

        first = next((it for it in iterations if it.start_date), None)
        last = next((it for it in reversed(iterations) if it.end_date), None)
        if not first or not last:
            raise ValueError(f"Les itérations du PI {pi_id} n'ont pas toutes des dates.")

        start_dt = datetime(
            first.start_date.year, first.start_date.month, first.start_date.day,
            tzinfo=timezone.utc,
        )
        end_dt = datetime(
            last.end_date.year, last.end_date.month, last.end_date.day,
            23, 59, 59, tzinfo=timezone.utc,
        )
        return start_dt, end_dt

    # ── Appels Git AZDO ──────────────────────────────────────────────────────

    async def _get_repo_id(
        self,
        http_client: httpx.AsyncClient,
        headers: dict,
        org: str,
        project: str,
        repo_name: str,
    ) -> str | None:
        """Retourne l'ID AZDO d'un dépôt Git par son nom (insensible à la casse).

        Args:
            repo_name: Nom du dépôt à rechercher.

        Returns:
            ID du dépôt (GUID string) ou ``None`` si introuvable.
        """
        url = f"https://dev.azure.com/{org}/{project}/_apis/git/repositories"
        async with self._semaphore:
            resp = await http_client.get(url, headers=headers, params={"api-version": "7.0"})
        resp.raise_for_status()
        repos = resp.json().get("value", [])
        name_lower = repo_name.lower()
        for repo in repos:
            if repo.get("name", "").lower() == name_lower:
                return repo["id"]
        return None

    async def _get_commits(
        self,
        http_client: httpx.AsyncClient,
        headers: dict,
        org: str,
        project: str,
        repo_id: str,
        branch: str,
        from_date: datetime,
        to_date: datetime,
    ) -> tuple[list[dict], bool]:
        """Récupère les commits d'un dépôt sur une période donnée.

        La réponse AZDO inclut directement ``changeCounts`` par commit
        (nombre de fichiers Add/Edit/Delete), ce qui évite un appel
        supplémentaire pour compter les fichiers modifiés.

        Args:
            branch:    Nom de la branche (ex. ``main``).
            from_date: Date de début (inclusive).
            to_date:   Date de fin (inclusive).

        Returns:
            Tuple ``(commits_filtres, is_partial)`` où ``commits_filtres`` est
            la liste des commits non-merge et ``is_partial`` indique si les
            résultats ont été tronqués à ``_COMMITS_TOP``.
        """
        url = (
            f"https://dev.azure.com/{org}/{project}"
            f"/_apis/git/repositories/{repo_id}/commits"
        )
        params = {
            "searchCriteria.fromDate": from_date.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "searchCriteria.toDate": to_date.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "searchCriteria.itemVersion.version": branch,
            "searchCriteria.itemVersion.versionType": "branch",
            "$top": _COMMITS_TOP,
            "api-version": "7.0",
        }
        async with self._semaphore:
            resp = await http_client.get(url, headers=headers, params=params)
        resp.raise_for_status()
        raw_commits = resp.json().get("value", [])

        is_partial = len(raw_commits) >= _COMMITS_TOP
        filtered = [c for c in raw_commits if not _is_merge_commit(c.get("comment", ""))]
        return filtered, is_partial

    async def _get_commit_parent(
        self,
        http_client: httpx.AsyncClient,
        headers: dict,
        org: str,
        project: str,
        repo_id: str,
        commit_id: str,
    ) -> str | None:
        """Retourne le SHA du commit parent (premier parent) d'un commit donné.

        Args:
            commit_id: SHA complet du commit.

        Returns:
            SHA du commit parent, ou ``None`` s'il est introuvable ou si c'est
            le premier commit du dépôt.
        """
        url = (
            f"https://dev.azure.com/{org}/{project}"
            f"/_apis/git/repositories/{repo_id}/commits/{commit_id}"
        )
        async with self._semaphore:
            resp = await http_client.get(url, headers=headers, params={"api-version": "7.0"})
        if resp.status_code != 200:
            return None
        parents = resp.json().get("parents") or []
        return parents[0] if parents else None

    async def _get_commit_changes(
        self,
        http_client: httpx.AsyncClient,
        headers: dict,
        org: str,
        project: str,
        repo_id: str,
        commit_id: str,
    ) -> list[dict]:
        """Retourne la liste des fichiers modifiés par un commit (hors dossiers).

        Args:
            commit_id: SHA complet du commit.

        Returns:
            Liste des entrées de changement (``item.path``, ``changeType``),
            limitée à ``_MAX_FILES_PER_COMMIT`` éléments.
        """
        url = (
            f"https://dev.azure.com/{org}/{project}"
            f"/_apis/git/repositories/{repo_id}/commits/{commit_id}/changes"
        )
        async with self._semaphore:
            resp = await http_client.get(url, headers=headers, params={"api-version": "7.0"})
        if resp.status_code != 200:
            return []
        changes = resp.json().get("changes", [])
        # Exclure les dossiers (isFolder=True) et limiter le nombre de fichiers
        return [
            c for c in changes
            if not c.get("item", {}).get("isFolder", False)
        ][:_MAX_FILES_PER_COMMIT]

    async def _get_file_content(
        self,
        http_client: httpx.AsyncClient,
        headers: dict,
        org: str,
        project: str,
        repo_id: str,
        path: str,
        commit_id: str,
    ) -> str | None:
        """Retourne le contenu texte d'un fichier à une révision donnée.

        Les fichiers binaires (Content-Type non textuel) sont ignorés.

        Args:
            path:      Chemin du fichier dans le dépôt (ex. ``/src/main.py``).
            commit_id: SHA du commit auquel lire le fichier.

        Returns:
            Contenu texte du fichier, ou ``None`` pour les binaires/erreurs.
        """
        url = (
            f"https://dev.azure.com/{org}/{project}"
            f"/_apis/git/repositories/{repo_id}/items"
        )
        params = {
            "path": path,
            "versionDescriptor.version": commit_id,
            "versionDescriptor.versionType": "commit",
            "api-version": "7.0",
        }
        try:
            async with self._semaphore:
                resp = await http_client.get(url, headers=headers, params=params)
            if resp.status_code != 200:
                return None
            content_type = resp.headers.get("content-type", "")
            if "text" not in content_type and "json" not in content_type and "xml" not in content_type:
                return None  # fichier binaire
            return resp.text
        except Exception:
            return None

    async def _compute_commit_line_stats(
        self,
        http_client: httpx.AsyncClient,
        headers: dict,
        org: str,
        project: str,
        repo_id: str,
        commit_id: str,
    ) -> tuple[int, int]:
        """Calcule les lignes ajoutées et supprimées pour un commit.

        Récupère le commit parent, la liste des fichiers modifiés, puis
        le contenu de chaque fichier avant et après pour calculer le diff.

        - Fichier **ajouté** : toutes les lignes du nouveau fichier sont des ajouts.
        - Fichier **supprimé** : toutes les lignes de l'ancien fichier sont des suppressions.
        - Fichier **édité** : diff unifié entre l'ancienne et la nouvelle version.

        Args:
            commit_id: SHA complet du commit.

        Returns:
            Tuple ``(lines_added, lines_deleted)``.
        """
        parent_id = await self._get_commit_parent(
            http_client, headers, org, project, repo_id, commit_id
        )
        changes = await self._get_commit_changes(
            http_client, headers, org, project, repo_id, commit_id
        )

        lines_added = 0
        lines_deleted = 0

        for change in changes:
            path = change.get("item", {}).get("path", "")
            change_type = change.get("changeType", "")
            if not path:
                continue

            try:
                if change_type == "add":
                    content = await self._get_file_content(
                        http_client, headers, org, project, repo_id, path, commit_id
                    )
                    if content is not None:
                        lines_added += len(content.splitlines())

                elif change_type == "delete" and parent_id:
                    content = await self._get_file_content(
                        http_client, headers, org, project, repo_id, path, parent_id
                    )
                    if content is not None:
                        lines_deleted += len(content.splitlines())

                elif change_type == "edit" and parent_id:
                    new_c, old_c = await asyncio.gather(
                        self._get_file_content(
                            http_client, headers, org, project, repo_id, path, commit_id
                        ),
                        self._get_file_content(
                            http_client, headers, org, project, repo_id, path, parent_id
                        ),
                    )
                    if new_c is not None and old_c is not None:
                        a, d = _diff_line_counts(old_c, new_c)
                        lines_added += a
                        lines_deleted += d

            except Exception as exc:
                logger.debug("Diff ignoré pour %s@%s : %s", path, commit_id[:8], exc)

        return lines_added, lines_deleted

    # ── Analyse principale ───────────────────────────────────────────────────

    async def _analyze_repo(
        self,
        http_client: httpx.AsyncClient,
        headers: dict,
        org: str,
        project: str,
        repo_name: str,
        branch: str,
        from_date: datetime,
        to_date: datetime,
    ) -> dict:
        """Analyse un dépôt Git et agrège les métriques de commits.

        Retourne un dictionnaire vide (métriques nulles) si le dépôt est
        introuvable, pour ne pas bloquer l'analyse des autres repos.

        Returns:
            ``{"commits_count": int, "lines_added": int, "lines_deleted": int,
            "files_changed": int, "is_partial": bool}``.
        """
        empty = {
            "commits_count": 0, "lines_added": 0, "lines_deleted": 0,
            "files_changed": 0, "is_partial": False,
        }

        # Résolution du nom du repo en ID AZDO
        try:
            repo_id = await self._get_repo_id(http_client, headers, org, project, repo_name)
        except Exception as exc:
            logger.warning("Impossible de lister les dépôts AZDO : %s", exc)
            return empty

        if repo_id is None:
            logger.warning("Dépôt '%s' introuvable dans le projet '%s'. Ignoré.", repo_name, project)
            return empty

        # Récupération des commits (changeCounts inclus dans la réponse liste)
        try:
            commits, is_partial = await self._get_commits(
                http_client, headers, org, project, repo_id, branch, from_date, to_date
            )
        except Exception as exc:
            logger.warning("Erreur lors de la récupération des commits de '%s' : %s", repo_name, exc)
            return empty

        if not commits:
            return empty

        # ── Fichiers modifiés ────────────────────────────────────────────────
        # changeCounts est déjà présent dans chaque commit de la liste,
        # donc pas d'appel API supplémentaire nécessaire.
        total_files = 0
        for c in commits:
            cc = c.get("changeCounts") or {}
            total_files += (cc.get("Add") or 0) + (cc.get("Edit") or 0) + (cc.get("Delete") or 0)

        # ── Lignes ajoutées / supprimées ─────────────────────────────────────
        # Calcul via diff client (parent → commit) pour les premiers commits.
        commits_for_stats = commits[:_STATS_MAX_PER_REPO]
        self._progress_total += len(commits_for_stats)
        self._report(self._progress_current, self._progress_total, repo_name)

        total_added = 0
        total_deleted = 0

        for commit in commits_for_stats:
            commit_id = commit.get("commitId", "")
            if not commit_id:
                self._progress_current += 1
                self._report(self._progress_current, self._progress_total, repo_name)
                continue
            try:
                added, deleted = await self._compute_commit_line_stats(
                    http_client, headers, org, project, repo_id, commit_id
                )
                total_added += added
                total_deleted += deleted
            except Exception as exc:
                logger.debug("Stats de lignes ignorées pour %s : %s", commit_id[:8], exc)
            finally:
                self._progress_current += 1
                self._report(self._progress_current, self._progress_total, repo_name)

        return {
            "commits_count": len(commits),
            "lines_added": total_added,
            "lines_deleted": total_deleted,
            "files_changed": total_files,
            "is_partial": is_partial,
        }

    async def analyze(self, pi_id: int, team_id: int) -> dict:
        """Lance l'analyse des commits AZDO pour un PI et une équipe.

        Args:
            pi_id:   Identifiant du PI à analyser.
            team_id: Identifiant de l'équipe du train à analyser.

        Returns:
            Dictionnaire des métriques agrégées :
            ``{"pi_id", "team_id", "commits_count", "lines_added",
              "lines_deleted", "files_changed", "is_partial", "analyzed_at"}``.

        Raises:
            ValueError: Si le PI ou l'équipe est introuvable, ou si les
                        paramètres AZDO sont incomplets.
        """
        from app.models.pi import PI
        pi = self.db.query(PI).filter(PI.id == pi_id).first()
        if pi is None:
            raise ValueError(f"PI {pi_id} introuvable.")

        team = self.db.query(TrainTeam).filter(TrainTeam.id == team_id).first()
        if team is None:
            raise ValueError(f"Équipe {team_id} introuvable.")

        start_dt, end_dt = self._get_pi_dates(pi_id)
        repos = team.repos_list
        branch = team.branch_filter or "main"

        client = self._build_client()
        org = client.organization
        project = client.project

        totals = {
            "commits_count": 0, "lines_added": 0, "lines_deleted": 0,
            "files_changed": 0, "is_partial": False,
        }

        async with httpx.AsyncClient(timeout=60.0) as http_client:
            for repo_name in repos:
                result = await self._analyze_repo(
                    http_client, client.headers, org, project,
                    repo_name, branch, start_dt, end_dt,
                )
                totals["commits_count"] += result["commits_count"]
                totals["lines_added"] += result["lines_added"]
                totals["lines_deleted"] += result["lines_deleted"]
                totals["files_changed"] += result["files_changed"]
                if result["is_partial"]:
                    totals["is_partial"] = True

        # Upsert TrainKpiEntry
        analyzed_at = datetime.utcnow()
        entry = (
            self.db.query(TrainKpiEntry)
            .filter(TrainKpiEntry.pi_id == pi_id, TrainKpiEntry.team_id == team_id)
            .first()
        )
        if entry is None:
            entry = TrainKpiEntry(pi_id=pi_id, team_id=team_id)
            self.db.add(entry)

        entry.commits_count = totals["commits_count"]
        entry.lines_added = totals["lines_added"]
        entry.lines_deleted = totals["lines_deleted"]
        entry.files_changed = totals["files_changed"]
        entry.is_partial = totals["is_partial"]
        entry.analyzed_at = analyzed_at
        self.db.commit()
        self.db.refresh(entry)

        return {
            "pi_id": pi_id,
            "team_id": team_id,
            "commits_count": entry.commits_count,
            "lines_added": entry.lines_added,
            "lines_deleted": entry.lines_deleted,
            "files_changed": entry.files_changed,
            "is_partial": entry.is_partial,
            "analyzed_at": analyzed_at.isoformat(),
        }
