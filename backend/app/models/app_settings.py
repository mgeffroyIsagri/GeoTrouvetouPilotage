"""Modèle ORM et constantes pour les paramètres de l'application."""

from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class AppSettings(Base):
    """Paramètres de l'application stockés sous forme clé/valeur.

    Chaque paramètre est identifié par une clé unique (``key``) et contient
    une valeur textuelle (``value``) potentiellement chiffrée pour les clés
    sensibles (PAT, clé API LLM). La liste des clés prédéfinies est dans
    ``SETTING_KEYS``.

    Le chiffrement et le masquage des clés sensibles sont gérés dans
    ``app/services/crypto.py`` et appliqués dans l'endpoint ``settings.py``.
    """

    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Clé unique du paramètre (voir SETTING_KEYS pour les clés prédéfinies)
    key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    # Valeur textuelle, potentiellement chiffrée (clés sensibles)
    value: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(String(500))


# ── Clés prédéfinies ───────────────────────────────────────────────────────────

# Mapping clé → description affichée dans l'interface Paramètres
SETTING_KEYS = {
    "azdo_organization": "URL organisation Azure DevOps",
    "azdo_project": "Nom du projet Azure DevOps",
    "azdo_team": "Nom de l'équipe Azure DevOps",
    "azdo_pat": "Personal Access Token Azure DevOps",
    "llm_provider": "Fournisseur LLM (openai / anthropic / azure)",
    "llm_model": "Modèle LLM ou nom du déploiement Azure (ex: gpt-4o)",
    "llm_api_key": "Clé API LLM",
    "llm_endpoint": "Endpoint Azure AI Foundry (ex: https://xxx.services.ai.azure.com/)",
    "capacity_matrix_dev": "Matrice de capacité Dev (JSON)",
    "capacity_matrix_qa": "Matrice de capacité QA (JSON)",
    "capacity_matrix_psm": "Matrice de capacité PSM (JSON)",
    "block_colors": "Couleurs des briques par catégorie (JSON)",
}
