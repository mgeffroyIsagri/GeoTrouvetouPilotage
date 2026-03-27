"""Modèles ORM pour le module KPI du Train.

Deux tables :
- ``train_teams`` — configuration des équipes du train (indépendant du PI)
- ``train_kpi_entries`` — résultats KPI par couple PI × équipe
"""

import json
from datetime import datetime

from sqlalchemy import Integer, String, Float, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class TrainTeam(Base):
    """Équipe du train : regroupe un ensemble de dépôts Git AZDO à analyser.

    Le champ ``azdo_repos`` est stocké en JSON (liste de noms de dépôts).
    Le champ ``branch_filter`` précise la branche analysée (par défaut ``main``).
    Le champ ``color`` est une couleur hexadécimale optionnelle pour l'affichage.
    """

    __tablename__ = "train_teams"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # Liste JSON de noms de dépôts, ex: '["MonRepo1", "MonRepo2"]'
    azdo_repos: Mapped[str] = mapped_column(String(4000), nullable=False, default="[]")
    branch_filter: Mapped[str] = mapped_column(String(200), nullable=False, default="main")
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # ── Relation ────────────────────────────────────────────────────────────────
    kpi_entries: Mapped[list["TrainKpiEntry"]] = relationship(
        back_populates="team", cascade="all, delete-orphan"
    )

    @property
    def repos_list(self) -> list[str]:
        """Désérialise ``azdo_repos`` en liste Python."""
        try:
            return json.loads(self.azdo_repos)
        except (json.JSONDecodeError, TypeError):
            return []

    @repos_list.setter
    def repos_list(self, value: list[str]) -> None:
        """Sérialise une liste Python en JSON pour ``azdo_repos``."""
        self.azdo_repos = json.dumps(value, ensure_ascii=False)


class TrainKpiEntry(Base):
    """Résultat KPI Git pour un couple PI × équipe du train.

    Les métriques Git (lignes ajoutées/supprimées, commits, fichiers modifiés)
    sont remplies par l'analyse automatique via ``TrainKpiAnalyzer``.
    ``capacity_days`` est une saisie manuelle optionnelle.
    ``is_partial`` indique que le nombre de commits était limité à 500 (résultats
    potentiellement tronqués).

    La contrainte d'unicité ``(pi_id, team_id)`` garantit une seule entrée par
    PI et par équipe.
    """

    __tablename__ = "train_kpi_entries"
    __table_args__ = (UniqueConstraint("pi_id", "team_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pi_id: Mapped[int] = mapped_column(Integer, ForeignKey("pi.id"), nullable=False)
    team_id: Mapped[int] = mapped_column(Integer, ForeignKey("train_teams.id"), nullable=False)

    # Saisie manuelle de la capacité (en jours)
    capacity_days: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Métriques Git agrégées sur la période du PI
    lines_added: Mapped[int] = mapped_column(Integer, default=0)
    lines_deleted: Mapped[int] = mapped_column(Integer, default=0)
    commits_count: Mapped[int] = mapped_column(Integer, default=0)
    files_changed: Mapped[int] = mapped_column(Integer, default=0)

    # True si les commits ont été tronqués à 500 (résultats partiels)
    is_partial: Mapped[bool] = mapped_column(Boolean, default=False)
    analyzed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # ── Relations ────────────────────────────────────────────────────────────────
    team: Mapped["TrainTeam"] = relationship(back_populates="kpi_entries")
