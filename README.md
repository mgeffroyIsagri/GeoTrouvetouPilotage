# GeoTrouvetouPilotage

Application de pilotage de la production de l'équipe **GeoTrouvetou** (Groupe Isagri).
Elle remplace les outils Klaxoon et scripts Python ad hoc par une interface centralisée couvrant le refinement, le PI Planning, le suivi de production et l'historique inter-PI.

**Production** : https://GeotrouvetouWeb.azurewebsites.net

---

## Fonctionnalités

- 📅 **PI Planning** — Calendrier capacitaire avec génération automatique des briques d'activité (matrices Dev/QA/PSM, support demi-journées), ajustement manuel (drag & drop, snap 0,5j), panneau de détail chronologique par collaborateur, sélection visuelle des stories multi-sprint. Modales de reset et génération ciblées (collaborateur + périmètre).
- 🛠️ **Admin PI** — Panel d'administration AZDO intégré au PI Planning (6 onglets) : vérification et création des itérations manquantes, clôture/résolution des work items non clôturés, contrôle des chemins parents des stories, transfert vers nouveau PI, reset de sprint, génération automatique des tâches enfants AZDO.
- 🔍 **PBR / Refinement** — Suivi des sessions de Product Backlog Refinement avec votes, notes DoR (/5) et analyse IA. Groupement parent/enfant, responsable de refinement, plan d'action, déprioritisation, copie de session, synchronisation des stories enfants AZDO.
- 📊 **Suivi & KPIs** — Résumé d'avancement sprint (terminées/en cours/non démarrées/DoR), stories planifiées par Feature/Enabler avec analyse DoR directe et liens AZDO, génération de CR Scrum of Scrums IA, graphiques estimation vs réalisé, KPIs sprint par collaborateur, analyses IA de productivité individuelles.
- 🕓 **Historique** — Consultation et comparaison des PI passés *(à venir)*
- 🔎 **Logs** — Consultation des traces LLM et AZDO (requêtes, réponses, erreurs, rapports de productivité)
- 🔄 **Synchronisation AZDO** — Import manuel des données depuis Azure DevOps via PAT (Feature, Enabler, User Story, Enabler Story, Bug, Task, Maintenance)
- ⚡ **Automatisations** — Triggers planifiés pour sync incrémentale, triage IA des bugs, création automatique de bugs depuis App Insights *(à venir)*

---

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Frontend | Angular 19 (standalone components, lazy-loaded) |
| Backend | Python 3.11+ / FastAPI |
| Base de données | SQLite (fichier local `geotrouvetou.db`) |
| IA | API LLM configurable (OpenAI, Anthropic, Azure AI Foundry) |
| Source de données | Azure DevOps REST API v7.0 |
| Hébergement | Azure App Service (France Central) |

---

## Prérequis

### Backend
- Python 3.11+

### Frontend
- Node.js 20+

---

## Installation locale

### 1. Cloner le repo

```bash
git clone https://github.com/<org>/GeoTrouvetouPilotage.git
cd GeoTrouvetouPilotage
```

### 2. Backend

```bash
cd backend
python -m venv .venv
source .venv/Scripts/activate        # Linux/Mac : source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --port 8002
```

API : `http://localhost:8002`
Swagger : `http://localhost:8002/docs`

### 3. Frontend

```bash
cd frontend
npm install
npx ng serve --port 4200
```

App : `http://localhost:4200`

---

## Déploiement Azure

```powershell
powershell.exe -ExecutionPolicy Bypass -File "deploy.ps1"
```

Le script effectue : build Angular (production) → copie dans `backend/static` → zip → `az webapp deploy`.

---

## Configuration

Au premier lancement, renseigner les paramètres dans l'interface (menu **Paramètres**) :

| Paramètre | Description |
|-----------|-------------|
| `AZDO Organisation` | URL de l'organisation Azure DevOps |
| `AZDO Projet` | Nom du projet (ex: `Isagri_Dev_PV_IsaPV`) |
| `AZDO Équipe` | Nom de l'équipe AZDO |
| `AZDO PAT` | Personal Access Token (Work Items Read+Write, Iterations Read+Write) |
| `LLM Provider` | Fournisseur IA (`openai` / `anthropic` / `azure`) |
| `LLM Modèle` | Nom du modèle (ex: `gpt-4o`, `claude-sonnet-4-6`) |
| `LLM Clé API` | Clé secrète du fournisseur IA |
| `LLM Endpoint` | URL Azure AI Foundry (uniquement pour le provider `azure`) |

---

## Structure du projet

```
GeoTrouvetouPilotage/
├── docs/
│   ├── cahier-des-charges.md         (v1)
│   ├── cahier-des-charges-V2.md      (v2)
│   ├── cahier-des-charges-V3.md      (v3)
│   └── cahier-des-charges-V4.md      (v4 — courant)
├── frontend/                          Angular 19
│   └── src/app/
│       ├── modules/
│       │   ├── pi-planning/           ✅ + admin-panel/
│       │   ├── pbr/                   ✅
│       │   ├── suivi/                 ✅
│       │   ├── logs/                  ✅
│       │   ├── parametres/            ✅
│       │   ├── historique/            🔲 À réaliser
│       │   └── automatisations/       📋 Spécifié
│       └── core/
│           ├── models/index.ts
│           └── services/api.service.ts
├── backend/                           FastAPI
│   ├── app/
│   │   ├── api/endpoints/             pi.py, pi_planning.py, pbr.py, azdo.py,
│   │   │                              settings.py, team_members.py, leaves.py,
│   │   │                              logs.py, suivi.py, admin.py
│   │   ├── models/                    SQLAlchemy ORM
│   │   └── services/
│   │       ├── azdo/                  client.py, sync.py, errors.py
│   │       ├── llm/client.py
│   │       └── capacity.py
│   ├── main.py
│   └── requirements.txt
├── deploy.ps1
├── README.md
└── CLAUDE.md
```

---

## Roadmap

- [x] **M1** — Socle technique (FastAPI + SQLite + Angular routing)
- [x] **M2** — Synchronisation AZDO (Feature, Enabler, Story, Bug, Task, Maintenance)
- [x] **M3** — Module PI Planning (calendrier + capacité + drag & drop + matrices demi-journées)
- [x] **M4** — Module PBR / Refinement (votes, analyse IA DoR, groupement, responsable, copie, sync, logs)
- [x] **M5** — Module Suivi & KPIs (tâches, graphiques, KPIs sprint, capacités manuelles, analyse IA productivité)
- [x] **M5b** — Admin PI (6 onglets : itérations AZDO, clôture WI, chemins parents, transfert, reset, tâches enfants)
- [x] **M5c** — Suivi enrichi (stories planifiées, DoR direct, CR Scrum of Scrums IA, résumé sprint)
- [ ] **M6** — Module Automatisations / Triggers (sync incrémentale, triage bugs IA, App Insights → bugs)
- [ ] **M7** — Historique inter-PI + Export PDF

---

## Équipe

Projet interne — Équipe **GeoTrouvetou**, Groupe Isagri.

---

## Licence

Usage interne uniquement — © Groupe Isagri
