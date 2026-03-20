# GeoTrouvetouPilotage

Application de pilotage de la production de l'équipe **GeoTrouvetou** (Groupe Isagri).
Elle remplace les outils Klaxoon et scripts Python ad hoc par une interface centralisée couvrant le refinement, le PI Planning, le suivi de production et l'historique inter-PI.

---

## Fonctionnalités

- 📅 **PI Planning** — Calendrier capacitaire avec génération automatique des briques d'activité et ajustement manuel (drag & drop)
- 🔍 **PBR / Refinement** — Suivi des sessions de Product Backlog Refinement avec votes, notes DOR et analyse IA
- 📊 **Suivi & KPIs** — Vélocité, taux de complétion, comparaison estimé/réalisé, analyses IA individuelles et collectives
- 🕓 **Historique** — Consultation et comparaison des PI passés, export PDF
- 🔄 **Synchronisation AZDO** — Import manuel des données depuis Azure DevOps via PAT

---

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Frontend | Angular (dernière version stable) |
| Backend | Python 3.11+ / FastAPI |
| Base de données | SQLite (fichier local) |
| IA | API LLM configurable (OpenAI, Anthropic, etc.) |
| Source de données | Azure DevOps REST API v7.0 |

---

## Prérequis

### Backend
- Python 3.11+
- `pip` ou `uv`

### Frontend
- Node.js 20+
- Angular CLI : `npm install -g @angular/cli`

---

## Installation

### 1. Cloner le repo

```bash
git clone https://github.com/<org>/GeoTrouvetouPilotage.git
cd GeoTrouvetouPilotage
```

### 2. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows : .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

L'API est accessible sur `http://localhost:8000`
La documentation Swagger est disponible sur `http://localhost:8000/docs`

### 3. Frontend

```bash
cd frontend
npm install
ng serve
```

L'application est accessible sur `http://localhost:4200`

---

## Configuration

Au premier lancement, renseigner les paramètres dans l'interface (menu **Paramètres**) :

| Paramètre | Description |
|-----------|-------------|
| `AZDO Organisation` | URL de l'organisation Azure DevOps |
| `AZDO Projet` | Nom du projet (ex: `Isagri_Dev_PV_IsaPV`) |
| `AZDO PAT` | Personal Access Token (permissions : Work Items Read, Iterations Read) |
| `LLM Provider` | Fournisseur IA (OpenAI, Anthropic…) |
| `LLM Modèle` | Nom du modèle (ex: `gpt-4o`, `claude-sonnet-4-6`) |
| `LLM Clé API` | Clé secrète du fournisseur IA |

---

## Structure du projet

```
GeoTrouvetouPilotage/
├── docs/
│   ├── cahier-des-charges.md
│   └── architecture.md
├── frontend/                  # Application Angular
│   ├── src/
│   │   ├── app/
│   │   │   ├── modules/
│   │   │   │   ├── pi-planning/
│   │   │   │   ├── pbr/
│   │   │   │   ├── suivi/
│   │   │   │   ├── historique/
│   │   │   │   └── parametres/
│   │   │   └── core/          # Services, modèles, guards
│   │   └── assets/
│   └── package.json
├── backend/                   # API FastAPI
│   ├── app/
│   │   ├── api/               # Routers FastAPI
│   │   ├── models/            # Modèles SQLAlchemy / SQLite
│   │   ├── services/          # Logique métier
│   │   │   ├── azdo/          # Intégration Azure DevOps
│   │   │   └── llm/           # Intégration LLM
│   │   └── core/              # Config, constantes
│   ├── main.py
│   └── requirements.txt
├── .gitignore
└── README.md
```

---

## Roadmap

- [x] Cahier des charges
- [ ] **M1** — Socle technique (FastAPI + SQLite + Angular routing)
- [ ] **M2** — Synchronisation AZDO
- [ ] **M3** — Module PI Planning (calendrier + capacité + drag & drop)
- [ ] **M4** — Module PBR / Refinement
- [ ] **M5** — Module Suivi & KPIs
- [ ] **M6** — Historique inter-PI + Export PDF

---

## Équipe

Projet interne — Équipe **GeoTrouvetou**, Groupe Isagri.

---

## Licence

Usage interne uniquement — © Groupe Isagri
