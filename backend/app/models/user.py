"""Modèle ORM pour les utilisateurs de l'application."""

from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class AppUser(Base):
    """Utilisateur de l'application (accès unique login/mot de passe).

    L'authentification repose sur un JWT signé (voir ``app/services/auth.py``).
    Le mot de passe est stocké sous forme hashée (bcrypt) dans
    ``hashed_password`` — jamais en clair.

    Un seul utilisateur est prévu par déploiement (usage interne d'équipe).
    Le compte par défaut est créé au démarrage dans ``init_db()`` si aucun
    utilisateur n'existe.
    """

    __tablename__ = "app_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    # Mot de passe hashé (bcrypt) — ne jamais stocker en clair
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
