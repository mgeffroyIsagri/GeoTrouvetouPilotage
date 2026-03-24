# Cahier des charges V2 — GeoTrouvetouPilotage
> Application de pilotage de la production de l'équipe GeoTrouvetou
> Stack : Angular · FastAPI · SQLite
> Version : 2.0 — Mars 2026 (mise à jour du périmètre réalisé)

---

## 1. Contexte & Objectifs

Remplacer les outils actuels (Klaxoon, scripts Python ad hoc) par une application centralisée permettant de :
- Préparer et animer les sessions de **Product Backlog Refinement (PBR)**
- Construire et visualiser le **PI Planning** (calendrier capacitaire + engagement)
- **Suivre l'avancement** d'un PI en cours avec des KPIs enrichis par IA
- Consulter l'**historique** des PI passés
- **Synchroniser** les données depuis Azure DevOps (AZDO)

### Évolutions v1 → v2

Les modules PI Planning, Synchronisation AZDO et PBR/Refinement sont **opérationnels**. La V2 documente le périmètre réalisé et précise les fonctionnalités ajoutées depuis le cahier des charges initial.

---

## 2. Utilisateurs & Accès

| Profil | Rôle |
|--------|------|
| PO / PSM | Administration, saisie, configuration, analyse |
| Dev | Consultation, votes PBR, saisie capacité |
| QA | Consultation, votes PBR, saisie capacité |

- **v1 locale** : application tournant en local (front Angular + back FastAPI), pas d'authentification
- **v2 cible** : hébergement sur un serveur accessible par toute l'équipe (auth à définir lors de cette évolution)

---

## 3. Architecture technique

```
Frontend        Angular 19 (SPA standalone components, lazy-loaded)
Backend         FastAPI (Python 3.11+)
Base de données SQLite (locale, fichier unique geotrouvetou.db)
IA              Appel LLM configurable (OpenAI, Anthropic Claude, Azure AI Foundry)
AZDO            API REST Azure DevOps v7.0 via PAT (Personal Access Token)
```

- Port backend : **8002** (8000 et 8001 réservés à d'autres applications)
- Port frontend : **4200**
- Le PAT AZDO et la configuration LLM sont stockés dans la table `app_settings`
- Migrations de schéma SQLite : `ALTER TABLE ... ADD COLUMN` dans `_run_migrations()` (idempotent)

---

## 4. Modules — État d'avancement

| Priorité | Module | État |
|----------|--------|------|
| 1 | **PI Planning** (calendrier + capacité) | ✅ Réalisé |
| 2 | **Synchronisation AZDO** (socle technique) | ✅ Réalisé |
| 3 | **PBR / Refinement** | ✅ Réalisé |
| 3b | **Logs** (traces LLM et AZDO) | ✅ Réalisé |
| 4 | **Suivi & KPIs** | 🔲 À réaliser |
| 5 | **Historique inter-PI** | 🔲 À réaliser |

---

## 5. Module 1 — PI Planning (Calendrier capacitaire)

### 5.1 Structure d'un PI
- **Fixe** : 4 sprints par PI
  - Sprint 1 : 3 semaines
  - Sprint 2 : 3 semaines
  - Sprint 3 : 4 semaines
  - Sprint 4 : IP Sprint — 3 semaines (Innovation & Planning)
- **Bornes d'un sprint** : commence le **vendredi matin**, se termine le **jeudi soir** (validé à la création du PI)
- **IP Sprint** : pas de règle restrictive sur les catégories
- Un PI est lié à une `IterationPath` AZDO

### 5.2 Vue calendrier
- Affichage **par sprint**, avec une colonne par **jour ouvré** (vendredi → jeudi)
- Une **ligne par collaborateur** avec nom + profil (Dev / QA / PSM)
- **St = X** : capacité stories disponible, calculée automatiquement
- **Filtre de vue** : tous les collaborateurs (vue équipe) ou un seul (vue individuelle)
- Les **congés** sont saisis manuellement dans l'appli

### 5.3 Catégories de briques (couleurs configurables)

| Catégorie | Profils concernés |
|-----------|-------------------|
| Stories / Dev | Dev |
| Stories / Test (QA) | QA |
| Bugs & Maintenances | Dev, QA |
| Imprévus | Dev, QA |
| Agility (cérémonies) | Dev, QA, PSM |
| Réunions | Dev, QA, PSM |
| Product Security Manager (PSM) | PSM |
| Montée en compétence | Dev, QA |
| Congés / Absences | Tous |

Les profils `Squad Lead` et `Automate` sont ignorés lors de la génération automatique.

### 5.4 Matrices de capacité
- Configurables par profil : **Dev/DevOps**, **QA**, **PSM**
- Chaque matrice définit, pour un nombre de jours travaillés dans la semaine (0–5), la répartition en jours par catégorie
- Modifiables dans l'interface Paramètres

### 5.5 Génération automatique
- `POST /api/planning/pi/{id}/generate` : régénère uniquement les **briques Layer 1** (capacité fixe)
- Les **briques Stories (Layer 2)** ne sont jamais auto-générées
- Les congés sont pris en compte semaine par semaine pour choisir la ligne de matrice correcte

### 5.6 Règles des briques

| Catégorie | Couche | Redimensionnable | Déplaçable |
|-----------|--------|-----------------|-----------|
| Congés / Absences | Layer 1 | Non | Non |
| Toutes capacités fixes | Layer 1 | Non | Non |
| Stories / Dev | Layer 2 | Oui (½ jour min) | Oui (libre dans le sprint) |
| Stories / Test (QA) | Layer 2 | Oui (½ jour min) | Oui (libre dans le sprint) |

- Drag & drop : natif (mousedown → document mousemove/mouseup), snap à 0,5 jour
- `day_offset` (float) : position canonique dans le sprint. `0.0` = vendredi matin, `0.5` = vendredi PM, `1.0` = lundi

### 5.7 Reset
- `DELETE /api/planning/pi/{pi_id}/reset` — supprime tous blocs + congés du PI
- `DELETE /api/planning/pi/{pi_id}/sprint/{n}/reset` — supprime blocs + congés d'un sprint (options : layer1, stories, congés)

---

## 6. Module 2 — Synchronisation AZDO

### 6.1 Déclenchement
- **Manuelle** uniquement : bouton "Synchroniser" dans Paramètres → Données synchronisées
- Le PAT AZDO est stocké côté backend uniquement (jamais exposé au front)

### 6.2 Données synchronisées

| Donnée | Endpoint AZDO |
|--------|--------------|
| Work items (Feature, Enabler, User Story, Enabler Story, Bug, Task) | `_apis/wit/wiql` + `_apis/wit/workitems` |
| Iterations / sprints | `_apis/work/teamsettings/iterations` |
| Membres de l'équipe | `_apis/projects/{project}/teams/{team}/members` |
| Completed Work | Champ `Microsoft.VSTS.Scheduling.CompletedWork` |
| Story Points, état, assigné, critères d'acceptation | Champs AZDO standard + champs Isagri |

- Le champ `organization` accepte une URL complète (`https://dev.azure.com/MonOrg`) ou simplement le nom de l'organisation
- Toutes les opérations AZDO sont **en lecture seule** — aucune écriture dans AZDO

### 6.3 Modèle de données local (SQLite)

Tables principales :
- `work_items` (id, type, title, state, iteration_path, assigned_to, description, acceptance_criteria, story_points, parent_id, …)
- `iterations` (id, name, start_date, end_date, path)
- `team_members` (id, display_name, unique_name, profile, is_active)
- `pi` (id, name, start_date, end_date, azdo_iteration_path, is_active)
- `sync_log` (synced_at, status, details JSON, items_synced)
- `app_settings` (key, value)

---

## 7. Module 3 — PBR / Refinement

### 7.1 Gestion des sessions

- Chaque session PBR peut être liée à un PI (relation optionnelle)
- Le PO/PSM crée une session en lui donnant un nom, une date et un PI optionnel
- **Une seule session active à la fois** ; activation/clôture manuelle
- La liste des sessions est filtrable par PI
- **Copie de session** : création d'une nouvelle session à partir d'une existante, en reprenant tous les sujets (sans les votes) avec leur plan d'action, responsable et statut de priorité

### 7.2 Gestion des sujets

- Le PO/PSM saisit les **IDs AZDO** des sujets à raffiner
- Lors de l'ajout d'un **Enabler ou Feature**, les stories enfants présentes en base sont **automatiquement ajoutées**
- **Synchronisation des enfants** : bouton 🔄 sur chaque parent pour ajouter les nouvelles stories enfants découvertes depuis le dernier ajout
- **Suppression d'un sujet** : supprime aussi les votes associés

### 7.3 Affichage et navigation

- Les sujets sont **groupés par parent/enfant** : les enablers/features sont affichés au niveau 0, leurs stories enfants en retrait (indentation + bordure bleue)
- L'appartenance parent/enfant est déterminée via `WorkItem.parent_id` (côté frontend, sans appel API supplémentaire)
- Chaque sujet est **repliable/déployable** (toggle)

### 7.4 Informations par sujet (mode développé)

**En-tête** :
- Type (chip coloré), titre (lien AZDO cliquable), story points
- Badge DOR moyen des votes (coloré selon la note 1–5)
- Badge note IA (italique, même palette), affiché même si la note est 0
- Bouton sync enfants (🔄, parents uniquement)
- Bouton analyse IA (🤖)
- Bouton suppression

**Corps développé** :
- Description et critères d'acceptation (rendu HTML)
- Métadonnées : état, assigné, iteration path
- **Barre méta** (parents uniquement) :
  - **Responsable de refinement** : sélecteur parmi les membres Dev/QA/PSM actifs, sauvegarde immédiate
  - **Toggle déprioritisation** : marque le sujet comme "Non priorisé" (visuel : opacité réduite, titre barré, badge gris) ; les stories enfants héritent du style
- **Plan d'action** (parents) : section bleue, saisie libre, sauvegardable indépendamment
- **Table des votes** par participant (Dev/QA/PSM actifs)
- **Plan d'action non-DOR** (tous items, affiché si note DOR moyenne < 4) : section jaune

### 7.5 Votes

Pour chaque sujet, chaque participant peut saisir :

| Information | Détail |
|-------------|--------|
| Note DOR | 1 à 5 (ou vide) |
| Story Points | Numérique (pas 0,5) |
| Charge Dev | En jours (pas 0,25) |
| Charge QA | En jours (pas 0,25) |
| Commentaire | Texte libre |

### 7.6 Analyse IA DoR

- Déclenchée sur un sujet individuel
- Récupère depuis AZDO : champs détaillés, commentaires, hiérarchie parent/enfant
- **Deux prompts système distincts** selon le type de work item :
  - **Enabler/Feature** : vérifie description, valeur métier, critères d'acceptation, risques, effort, présence de stories enfants
  - **Story** : vérifie description, critères d'acceptation, refinement technique, SP, charge DEV/QA, plan de test, adhérences
- Pour une **story analysée seule** : récupère automatiquement son parent enabler (via `Isagri.Agile.ParentId`) pour fournir le contexte
- Nettoyage du contenu avant envoi : suppression HTML (préservation des génériques C# `<T>` → `[T]`), troncature par champ (sauf Notes), suppression des métadonnées vides
- Résultat : note globale (0–5) + commentaire structuré stockés sur le `PBRItem`
- Le LLM est configurable (provider, modèle, clé API, endpoint Azure)

### 7.7 Modèle de données PBR

```
pbr_sessions     (id, name, date, is_active, pi_id)
pbr_items        (id, session_id, work_item_id, action_plan,
                  ia_dor_note, ia_comment, ia_analyzed_at,
                  refinement_owner_id → team_members.id,
                  is_deprioritized)
pbr_votes        (id, session_id, team_member_id, work_item_id,
                  dor_note, comment, story_points,
                  charge_dev_days, charge_qa_days, created_at)
```

---

## 8. Module 3b — Logs

### 8.1 Objectif
Permettre au PO/PSM de vérifier ce qui est transmis au LLM et à AZDO lors des analyses PBR (débogage, contrôle qualité des prompts, suivi des coûts tokens).

### 8.2 Types de logs

| Type | Contenu |
|------|---------|
| `AZDO_FETCH` | Work items récupérés, types, titres, champs bruts |
| `LLM_REQUEST` | Provider, modèle, type de prompt (enabler/story), message utilisateur complet |
| `LLM_RESPONSE` | Note extraite, commentaire complet, durée en ms |
| `ERROR` | Erreur AZDO ou LLM avec message détaillé |

### 8.3 Interface

- Liste chronologique (plus récent en haut) avec filtres : type, limite
- Panneau détail JSON à droite au clic
- Bouton "Rafraîchir" et "Vider les logs"
- Modèle : `llm_log` (id, created_at, log_type, work_item_id, session_id, summary, content, duration_ms)

---

## 9. Module 4 — Suivi & KPIs *(à réaliser)*

### 9.1 Source de données
- Données AZDO synchronisées dans la BDD locale

### 9.2 KPIs prévus

**Par sprint / par collaborateur :**
- Vélocité (story points livrés)
- Taux de complétion des stories
- Temps passé par catégorie (via Completed Work des tâches)
- Comparaison estimé vs réalisé

**Bugs & Maintenances :**
- Nombre traités, temps passé, taux de résolution

**Analyses IA :**
- Analyse de productivité individuelle (synthèse narrative)
- Analyse de productivité collective

---

## 10. Module 5 — Historique inter-PI *(à réaliser)*

### 10.1 Données conservées
- Tous les PI passés (calendriers, engagements, réalisé)
- Notes et analyses PBR

### 10.2 Indicateurs inter-PI
- Vélocité globale inter-PI (tendance)
- Comparaison engagements vs réalisé par PI
- Évolution de la qualité DOR dans le temps

### 10.3 Export
- Export **PDF** d'un rapport de PI (calendrier + KPIs + analyses IA)

---

## 11. Paramètres de l'application

| Paramètre | Description |
|-----------|-------------|
| `azdo_organization` | URL ou nom de l'organisation Azure DevOps |
| `azdo_project` | Nom du projet AZDO |
| `azdo_team` | Nom de l'équipe AZDO |
| `azdo_pat` | Personal Access Token (Work Items Read, Iterations Read) |
| `llm_provider` | `openai` / `anthropic` / `azure` |
| `llm_model` | Nom du modèle (ex: `gpt-4o`, `claude-sonnet-4-6`, `chat-gpt41-mini`) |
| `llm_api_key` | Clé secrète du fournisseur IA |
| `llm_endpoint` | URL Azure AI Foundry (uniquement pour `azure`) |
| `capacity_matrix_dev` | Matrice JSON de capacité Dev |
| `capacity_matrix_qa` | Matrice JSON de capacité QA |
| `capacity_matrix_psm` | Matrice JSON de capacité PSM |
| `block_colors` | Couleurs des catégories de briques (JSON) |

Membres de l'équipe : profil (Dev / QA / PSM / Squad Lead / Automate) et statut actif/inactif gérés dans l'interface.

---

## 12. Contraintes & Non-fonctionnel

- **v1** : déploiement 100% local, aucune dépendance externe hormis AZDO et LLM
- BDD SQLite : fichier unique `geotrouvetou.db`, sauvegardable simplement par copie
- Pas d'authentification en v1
- Interface en **français**
- Compatibilité navigateur : Chrome / Edge (dernières versions)
- Migrations de schéma : `ALTER TABLE ... ADD COLUMN` dans `_run_migrations()`, idempotentes (try/except)
- Toutes les opérations AZDO sont en **lecture seule**

---

## 13. Structure du projet

```
GeoTrouvetouPilotage/
├── docs/
│   ├── cahier-des-charges.md        (v1 — référence initiale)
│   └── cahier-des-charges-V2.md     (v2 — périmètre réalisé)
├── frontend/                         Angular 19
│   └── src/app/
│       ├── modules/
│       │   ├── pi-planning/          ✅ Réalisé
│       │   ├── pbr/                  ✅ Réalisé
│       │   ├── logs/                 ✅ Réalisé
│       │   ├── suivi/                🔲 À réaliser
│       │   ├── historique/           🔲 À réaliser
│       │   └── parametres/           ✅ Réalisé
│       └── core/
│           ├── models/index.ts       Interfaces TypeScript
│           └── services/api.service.ts
├── backend/                          FastAPI
│   ├── app/
│   │   ├── api/endpoints/            pi.py, pi_planning.py, pbr.py,
│   │   │                             azdo.py, settings.py, team_members.py,
│   │   │                             leaves.py, logs.py
│   │   ├── models/                   SQLAlchemy ORM
│   │   └── services/
│   │       ├── azdo/                 client.py, sync.py, errors.py
│   │       ├── llm/client.py         OpenAI / Anthropic / Azure
│   │       └── capacity.py           Génération Layer 1
│   ├── main.py
│   └── requirements.txt
├── README.md
└── CLAUDE.md
```
