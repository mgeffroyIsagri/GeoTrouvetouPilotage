"""Point d'entrée principal de l'API GeoTrouvetouPilotage.

Configure l'application FastAPI, le middleware CORS, le routeur API et le
serveur statique pour le frontend Angular en production.

Utilisation en développement :
    uvicorn main:app --port 8002

Utilisation en production (Azure) :
    La variable d'environnement AZURE_URL doit contenir l'URL publique de
    l'application pour que CORS l'autorise.
"""

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi import Response

from app.database import init_db, SessionLocal
from app.api.router import api_router
from app.services.scheduler import init_scheduler, shutdown_scheduler

# ── Application FastAPI ────────────────────────────────────────────────────────

app = FastAPI(
    title="GeoTrouvetouPilotage API",
    description="API de pilotage de la production de l'équipe GeoTrouvetou",
    version="1.0.0",
)

# ── CORS ───────────────────────────────────────────────────────────────────────

# En développement : autoriser localhost:4200 (frontend Angular)
# En production : ajouter l'URL Azure si définie dans l'environnement
_origins = ["http://localhost:4200"]
_azure_url = os.environ.get("AZURE_URL", "")
if _azure_url:
    _origins.append(_azure_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routeur API ────────────────────────────────────────────────────────────────

app.include_router(api_router, prefix="/api")


# ── Événements de cycle de vie ─────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    """Initialise la base de données et démarre le scheduler au démarrage.

    Crée les tables manquantes, exécute les migrations idempotentes
    définies dans ``app/database.py``, puis démarre le scheduler APScheduler
    et charge les triggers actifs depuis la base.
    """
    init_db()
    init_scheduler(lambda: iter([SessionLocal()]))


@app.on_event("shutdown")
async def shutdown():
    """Arrête proprement le scheduler APScheduler."""
    shutdown_scheduler()


# ── Endpoint de santé ──────────────────────────────────────────────────────────

@app.get("/health")
def health():
    """Endpoint de vérification de santé (health check).

    Utilisé par les sondes Azure App Service pour confirmer que l'application
    est démarrée et répond correctement.
    """
    return {"status": "ok"}


# ── Serveur statique (frontend Angular) ───────────────────────────────────────

# En production, le build Angular est copié dans le dossier ``static/``.
# Le catch-all sert index.html pour toutes les routes inconnues (SPA routing).
_static_dir = os.path.join(os.path.dirname(__file__), "static")

if os.path.isdir(_static_dir):
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Sert les fichiers statiques Angular ou redirige vers index.html.

        Pour les routes Angular inconnues du serveur, retourne ``index.html``
        afin que le routeur Angular prenne le relais côté client.
        """
        file_path = os.path.join(_static_dir, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        index_path = os.path.join(_static_dir, "index.html")
        if os.path.isfile(index_path):
            return FileResponse(index_path)
        return Response(status_code=404)
