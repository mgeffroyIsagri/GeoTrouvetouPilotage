"""Modèle ORM pour les logs des interactions LLM et AZDO."""

from datetime import datetime
from sqlalchemy import Integer, String, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


# ── Types de log ───────────────────────────────────────────────────────────────

# Valeurs possibles du champ log_type
LOG_TYPE_LLM_REQUEST = "LLM_REQUEST"
LOG_TYPE_LLM_RESPONSE = "LLM_RESPONSE"
LOG_TYPE_AZDO_FETCH = "AZDO_FETCH"
LOG_TYPE_ERROR = "ERROR"
LOG_TYPE_PRODUCTIVITY_REPORT = "PRODUCTIVITY_REPORT"


# ── Modèle ─────────────────────────────────────────────────────────────────────

class LLMLog(Base):
    """Trace d'une interaction LLM ou d'un appel AZDO.

    Ce modèle centralise toutes les interactions du système avec des services
    externes (LLM : OpenAI, Anthropic, Azure AI Foundry ; AZDO : récupération
    de work items). Il permet de déboguer les analyses DoR et les rapports de
    productivité.

    Le champ ``content`` contient le contenu complet (prompt, réponse,
    payload AZDO), tandis que ``summary`` est une version abrégée affichable
    dans l'interface Logs.

    Les entrées ``PRODUCTIVITY_REPORT`` sont upsertées (une seule par
    combinaison ``pi_id / sprint_num / member_id``).
    """

    __tablename__ = "llm_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    # Type d'entrée : LLM_REQUEST, LLM_RESPONSE, AZDO_FETCH, ERROR, PRODUCTIVITY_REPORT
    log_type: Mapped[str] = mapped_column(String(30))
    # Contexte optionnel : ID du work item AZDO concerné
    work_item_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Contexte optionnel : ID de la session PBR concernée
    session_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Contexte optionnel : ID du PI concerné (rapports de productivité)
    pi_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Contexte optionnel : numéro du sprint concerné
    sprint_num: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Contexte optionnel : ID du membre concerné (rapports de productivité)
    member_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Résumé court affichable dans l'interface (max 300 chars)
    summary: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # Contenu complet : prompt, réponse LLM, payload AZDO…
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Durée de l'appel en millisecondes (LLM et AZDO)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
