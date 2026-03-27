"""Configuration de l'application via variables d'environnement.

Les valeurs par défaut conviennent pour un environnement de développement local.
En production, surcharger via un fichier ``.env`` ou des variables d'environnement
Azure App Service.

Variables disponibles :
    - ``APP_NAME`` : nom affiché de l'application
    - ``DEBUG`` : active le mode debug FastAPI (ne pas utiliser en production)
    - ``DATABASE_URL`` : URL SQLAlchemy de la base de données SQLite
"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Paramètres de configuration chargés depuis l'environnement ou le fichier .env."""

    app_name: str = "GeoTrouvetouPilotage"
    debug: bool = False
    # Chemin relatif à la racine du backend (dossier d'exécution uvicorn)
    database_url: str = "sqlite:///./geotrouvetou.db"

    class Config:
        env_file = ".env"
        extra = "ignore"


# Instance singleton utilisée dans toute l'application
settings = Settings()
