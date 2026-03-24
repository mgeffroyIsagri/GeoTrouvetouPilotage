import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import init_db
from app.api.router import api_router

app = FastAPI(
    title="GeoTrouvetouPilotage API",
    description="API de pilotage de la production de l'équipe GeoTrouvetou",
    version="1.0.0",
)

# CORS : localhost en dev, domaine Azure en prod
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

app.include_router(api_router, prefix="/api")


@app.on_event("startup")
async def startup():
    init_db()


@app.get("/health")
def health():
    return {"status": "ok"}


# Servir le frontend Angular (doit être en dernier)
_static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(_static_dir):
    app.mount("/", StaticFiles(directory=_static_dir, html=True), name="spa")
