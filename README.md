# GeoTrouvetouPilotage

Application de pilotage de la production de l'équipe **GeoTrouvetou** (Groupe Isagri).
Elle remplace les outils Klaxoon et scripts Python ad hoc par une interface centralisée couvrant le refinement, le PI Planning, le suivi de production et l'historique inter-PI.

---

## Fonctionnalités

- 📅 **PI Planning** — Calendrier capacitaire responsive avec génération automatique des briques d'activité, ajustement manuel (drag & drop), panneau de détail chronologique par collaborateur, sélection visuelle des stories multi-sprint, impression / export PDF sélectif (sprint × collaborateurs)
- 🔍 **PBR / Refinement** — Suivi des sessions de Product Backlog Refinement avec votes, notes DOR et analyse IA (DoR). Groupement parent/enfant avec indentation. Responsable de refinement, plan d'action, déprioritisation, copie de session, synchronisation des stories enfants AZDO
- 📊 **Suivi & KPIs** — Tableau des tâches par story/feature, graphiques estimation vs réalisé, KPIs sprint par collaborateur (capacité vs réalisé par catégorie), saisie manuelle des capacités, analyses IA de productivité individuelles sauvegardables
- 🕓 **Historique** — Consultation et comparaison des PI passés, export PDF *(à venir)*
- 🔎 **Logs** — Consultation des traces LLM et AZDO (requêtes, réponses, erreurs, rapports de productivité)
- 🔄 **Synchronisation AZDO** — Import manuel des données depuis Azure DevOps via PAT (Feature, Enabler, User Story, Enabler Story, Bug, Task, Maintenance)

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
uvicorn main:app --port 8002
```

L'API est accessible sur `http://localhost:8002`
La documentation Swagger est disponible sur `http://localhost:8002/docs`

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
| `LLM Endpoint` | URL Azure AI Foundry (uniquement pour le provider `azure`) |

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
│   │   │   │   ├── parametres/
│   │   │   │   └── logs/
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
- [x] **M1** — Socle technique (FastAPI + SQLite + Angular routing)
- [x] **M2** — Synchronisation AZDO
- [x] **M3** — Module PI Planning (calendrier + capacité + drag & drop)
- [x] **M4** — Module PBR / Refinement (votes, analyse IA DoR, groupement, responsable, copie, sync, logs)
- [x] **M5** — Module Suivi & KPIs (tâches, graphiques, KPIs sprint, capacités manuelles, analyse IA productivité)
- [x] **M5.1** — PI Planning : calendrier responsive (ResizeObserver), panneau de détail par collaborateur, infobulle capacité position fixe, sélection visuelle story multi-sprint, impression / export PDF
- [ ] **M6** — Historique inter-PI + Export PDF

---

## Équipe

Projet interne — Équipe **GeoTrouvetou**, Groupe Isagri.

---

## Licence

Usage interne uniquement — © Groupe Isagri
