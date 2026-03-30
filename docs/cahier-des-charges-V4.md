# Cahier des charges V4 — GeoTrouvetouPilotage
> Application de pilotage de la production de l'équipe GeoTrouvetou
> Stack : Angular · FastAPI · SQLite · Azure App Service
> Version : 4.0 — Mars 2026

---

## 1. Contexte & Objectifs

Remplacer les outils actuels (Klaxoon, scripts Python ad hoc) par une application centralisée permettant de :
- Préparer et animer les sessions de **Product Backlog Refinement (PBR)**
- Construire et visualiser le **PI Planning** (calendrier capacitaire + engagement)
- **Suivre l'avancement** d'un PI en cours avec des KPIs enrichis par IA
- Gérer les **opérations d'administration AZDO** depuis l'interface
- **Automatiser** des actions récurrentes via des triggers planifiés
- Consulter l'**historique** des PI passés
- **Synchroniser** les données depuis Azure DevOps (AZDO)

### Évolutions V3 → V4

**Panel Admin PI** (module entièrement nouveau) :
- Vérification de la cohérence des itérations AZDO
- Gestion des work items non clôturés (résolution, fermeture, déplacement)
- Contrôle des chemins d'itération parents des stories planifiées
- Transfert de stories vers un nouveau PI
- Reset ciblé par sprint
- Génération automatique des tâches enfants AZDO pour les stories planifiées

**Module Suivi enrichi** :
- Section "Stories planifiées" par sprint (groupement Feature/Enabler, sections repliables)
- Analyse DoR directe depuis le Suivi (sans session PBR obligatoire)
- Barre de résumé d'avancement sprint (terminées / en cours / non démarrées / issues DoR)
- Génération de CR Scrum of Scrums par IA

**PI Planning** :
- Modales de reset et génération avec sélection collaborateur + périmètre (sprint / PI entier)
- Support des demi-journées dans les matrices de capacité (pas 0,5)
- Aliases de catégories dans les matrices personnalisées (`ceremonies→agility`, `bugs→bugs_maintenance`)

**Opérations AZDO étendues** :
- Le client AZDO supporte désormais les **opérations d'écriture** (update, create work item, create classification node)
- Les écritures AZDO sont initiées **uniquement depuis le Panel Admin** ou la génération de tâches — jamais automatiquement

**Nouveau module planifié** : **Automatisations / Triggers** *(cahier des charges défini, réalisation à venir)*

---

## 2. Utilisateurs & Accès

| Profil | Rôle |
|--------|------|
| PO / PSM | Administration, saisie, configuration, analyse, admin PI, triggers |
| Dev | Consultation, votes PBR, saisie capacité |
| QA | Consultation, votes PBR, saisie capacité |

- **Déploiement actuel** : Azure App Service (`GeotrouvetouWeb`, France Central) accessible depuis tout navigateur via `https://GeotrouvetouWeb.azurewebsites.net`
- **Authentification** : non implémentée en v4 — accès ouvert sur l'URL Azure

---

## 3. Architecture technique

```
Frontend        Angular 19 (SPA standalone components, lazy-loaded)
Backend         FastAPI (Python 3.11+)
Base de données SQLite (locale, fichier unique geotrouvetou.db)
IA              Appel LLM configurable (OpenAI, Anthropic Claude, Azure AI Foundry)
AZDO            API REST Azure DevOps v7.0 via PAT
Hébergement     Azure App Service (France Central)
Déploiement     Script PowerShell deploy.ps1 (build Angular → zip → az webapp deploy)
```

- Port backend local : **8002** (8000 et 8001 réservés à d'autres applications sur la machine de dev)
- Port frontend local : **4200**
- Le PAT AZDO et la configuration LLM sont stockés dans la table `app_settings`
- Migrations de schéma SQLite : `ALTER TABLE ... ADD COLUMN` dans `_run_migrations()` (idempotent)
- **Always-On Azure** : à activer sur l'App Service pour que les triggers planifiés (APScheduler) fonctionnent en continu

---

## 4. Modules — État d'avancement

| Priorité | Module | État |
|----------|--------|------|
| 1 | **PI Planning** (calendrier + capacité) | ✅ Réalisé |
| 2 | **Synchronisation AZDO** | ✅ Réalisé |
| 3 | **PBR / Refinement** | ✅ Réalisé |
| 3b | **Logs** (traces LLM et AZDO) | ✅ Réalisé |
| 4 | **Suivi & KPIs** | ✅ Réalisé |
| 4b | **Admin PI** (opérations AZDO avancées) | ✅ Réalisé |
| 5 | **Automatisations / Triggers** | 📋 Spécifié — réalisation à venir |
| 6 | **Historique inter-PI** | 🔲 À réaliser |

---

## 5. Module 1 — PI Planning (Calendrier capacitaire)

### 5.1 Structure d'un PI
- **Fixe** : 4 sprints par PI
  - Sprint 1 : 3 semaines
  - Sprint 2 : 3 semaines
  - Sprint 3 : 4 semaines
  - Sprint 4 : 3 semaines (IP Sprint — Innovation & Planning)
- **Bornes d'un sprint** : commence le **vendredi matin**, se termine le **jeudi soir** (validé à la création du PI)
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
- Chaque matrice définit, pour un nombre de jours travaillés dans la semaine (0 à 5, **avec support des demi-journées**, pas 0,5), la répartition en jours par catégorie
- Les clés de la matrice sont des flottants (`"3.5"`, `"4.0"`, etc.)
- **Aliases de catégories** : les matrices personnalisées peuvent utiliser `"ceremonies"` (→ `agility`) ou `"bugs"` (→ `bugs_maintenance`)
- Modifiables dans l'interface Paramètres

### 5.5 Génération automatique
- `POST /api/planning/pi/{id}/generate` : régénère uniquement les **briques Layer 1** (capacité fixe)
- Périmètre sélectionnable : sprint unique ou PI entier
- Collaborateur sélectionnable : un seul ou tous
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
- Modale de confirmation avec sélection du **collaborateur** (tous ou un seul) et du **périmètre** (sprint ou PI entier)
- `DELETE /api/planning/pi/{pi_id}/reset` — supprime tous blocs + congés du PI
- `DELETE /api/planning/pi/{pi_id}/sprint/{n}/reset` — supprime blocs + congés d'un sprint

---

## 6. Module 2 — Synchronisation AZDO

### 6.1 Déclenchement
- **Manuelle** : bouton "Synchroniser" dans Paramètres → Données synchronisées
- **Automatique** (à venir via module Triggers) : sync incrémentale quotidienne

### 6.2 Données synchronisées

| Donnée | Endpoint AZDO |
|--------|--------------|
| Work items (Feature, Enabler, User Story, Enabler Story, Bug, Task, Maintenance) | `_apis/wit/wiql` + `_apis/wit/workitems` |
| Iterations / sprints | `_apis/work/teamsettings/iterations` |
| Membres de l'équipe | `_apis/projects/{project}/teams/{team}/members` |
| Completed Work | `Microsoft.VSTS.Scheduling.CompletedWork` |
| Story Points, état, assigné, critères d'acceptation | Champs AZDO standard + champs Isagri |

- Le champ `organization` accepte une URL complète ou simplement le nom de l'organisation
- **Opérations de lecture** : tous les appels de synchronisation sont en lecture seule
- **Opérations d'écriture** (Panel Admin uniquement) : update work item, create work item, create classification node

### 6.3 Client AZDO (`app/services/azdo/client.py`)

Méthodes disponibles :

| Méthode | Type | Usage |
|---------|------|-------|
| `get_iterations` | Lecture | Récupère les itérations d'une équipe |
| `get_team_members` | Lecture | Membres de l'équipe |
| `run_wiql` | Lecture | Requête WIQL → liste d'IDs |
| `get_work_items` | Lecture | Batch de work items (max 200/requête) |
| `get_work_item_detail` | Lecture | WI avec tous champs + relations |
| `get_work_item_comments` | Lecture | Commentaires d'un WI |
| `get_classification_nodes` | Lecture | Arbre des itérations |
| `create_classification_node` | **Écriture** | Crée un nœud d'itération enfant |
| `update_work_item` | **Écriture** | JSON Patch sur un WI (état, champs…) |
| `create_work_item` | **Écriture** | Crée un nouveau WI (Task, Bug…) |

### 6.4 Modèle de données local (SQLite)

```
work_items    (id=ID AZDO, type, title, state, iteration_path, assigned_to,
               description, acceptance_criteria, story_points, parent_id, …)
iterations    (id, name, start_date, end_date, path)
team_members  (id, display_name, unique_name, profile, is_active)
pi            (id, name, start_date, end_date, azdo_iteration_path, is_active)
sync_log      (synced_at, status, details JSON, items_synced)
app_settings  (key, value)
```

---

## 7. Module 3 — PBR / Refinement

### 7.1 Gestion des sessions

- Chaque session PBR peut être liée à un PI (relation optionnelle)
- **Une seule session active à la fois** ; activation/clôture manuelle
- **Copie de session** : nouvelle session à partir d'une existante, reprenant tous les sujets (sans votes) avec plan d'action, responsable et statut de priorité

### 7.2 Gestion des sujets

- Le PO/PSM saisit les **IDs AZDO** des sujets à raffiner
- Lors de l'ajout d'un **Enabler ou Feature**, les stories enfants présentes en base sont automatiquement ajoutées
- **Synchronisation des enfants** : bouton 🔄 pour ajouter les nouvelles stories enfants

### 7.3 Affichage et navigation

- Sujets **groupés par parent/enfant** : enablers/features au niveau 0, stories enfants en retrait
- Chaque sujet est **repliable/déployable**

### 7.4 Informations par sujet (mode développé)

**En-tête** : Type (chip coloré), titre (lien AZDO), story points, badge DoR votes, badge note IA, bouton sync, bouton analyse IA, bouton suppression

**Corps développé** :
- Description et critères d'acceptation (rendu HTML)
- Métadonnées : état, assigné, iteration path
- **Barre méta** (parents) : responsable de refinement, toggle déprioritisation
- **Plan d'action** (parents) : section bleue, saisie libre
- **Table des votes** par participant
- **Plan d'action non-DOR** (si note DoR moyenne < 4/5) : section jaune

### 7.5 Votes

| Information | Détail |
|-------------|--------|
| Note DoR | 1 à 5 (ou vide) |
| Story Points | Numérique |
| Charge Dev | En jours |
| Charge QA | En jours |
| Commentaire | Texte libre |

### 7.6 Analyse IA DoR

- **Deux prompts système** selon le type : Enabler/Feature ou Story
- Note globale **sur 5** + commentaire structuré
- Pour une story : récupère automatiquement son parent enabler (via `Isagri.Agile.ParentId`)
- Résultat stocké sur le `PBRItem` (`ia_dor_note`, `ia_comment`, `ia_analyzed_at`)

### 7.7 Modèle de données PBR

```
pbr_sessions  (id, name, date, is_active, pi_id)
pbr_items     (id, session_id, work_item_id, action_plan,
               ia_dor_note, ia_comment, ia_analyzed_at,
               refinement_owner_id → team_members.id,
               is_deprioritized)
pbr_votes     (id, session_id, team_member_id, work_item_id,
               dor_note, comment, story_points,
               charge_dev_days, charge_qa_days, created_at)
```

---

## 8. Module 3b — Logs

### 8.1 Types de logs

| Type | Contenu |
|------|---------|
| `AZDO_FETCH` | Work items récupérés, types, titres, champs bruts |
| `LLM_REQUEST` | Provider, modèle, type de prompt, message complet |
| `LLM_RESPONSE` | Note extraite, commentaire complet, durée en ms |
| `PRODUCTIVITY_REPORT` | Rapport narratif de productivité (upsert par pi/sprint/membre) |
| `ERROR` | Erreur AZDO ou LLM avec message détaillé |

### 8.2 Interface

- Liste chronologique (plus récent en haut), filtres type + limite
- Panneau détail JSON au clic
- Boutons "Rafraîchir" et "Vider les logs"

### 8.3 Modèle de données

```
llm_log (id, created_at, log_type, work_item_id, session_id,
         pi_id, sprint_num, member_id,
         summary, content TEXT, duration_ms)
```

---

## 9. Module 4 — Suivi & KPIs

### 9.1 Liaison AZDO

- Un PI doit être **associé à un chemin d'itération AZDO** pour activer le suivi
- Boutons "Associer" / "✕ Dissocier AZDO" dans la barre d'outils Suivi

### 9.2 Barre de résumé sprint *(nouveau V4)*

En haut de chaque onglet sprint (SP1/SP2/SP3), une barre synthétique affiche :
- ✓ Stories terminées (Closed/Resolved)
- ▶ Stories en cours (Active)
- ⏳ Stories non démarrées (New)
- ⚠ Stories avec DoR < 4/5
- Nombre total de stories planifiées
- Bouton **🤖 CR Scrum of Scrums** (génération IA)

### 9.3 Section "Stories planifiées" *(nouveau V4)*

Avant les graphiques de chaque sprint (SP1/SP2/SP3), affichage détaillé des stories Layer 2 :
- **Groupement par Feature/Enabler parent** avec sections repliables
- Filtres : collaborateur, état du work item
- Par story : type, titre (lien AZDO cliquable), état, collaborateur(s), charge planifiée, badge DoR
- **Bouton "🤖 Analyser DoR"** sur chaque story (appel direct AZDO + LLM, sans session PBR obligatoire)
  - Si un PBRItem existe pour cette story, il est mis à jour
  - Note affichée sur **5** (échelle /5)
- Bordure rouge gauche pour les stories avec DoR < 4/5
- Commentaire DoR affiché sous la story (résumé 200 car.)

### 9.4 Génération de CR Scrum of Scrums *(nouveau V4)*

- Bouton dans la barre de résumé sprint
- Agrège : liste des stories, états, assignés, charges planifiées, notes DoR
- Prompt IA structuré pour générer un CR Scrum of Scrums selon la structure SAFe/Scrum
- Résultat affiché dans un panneau repliable avec bouton ✕

### 9.5 Onglet Général — Tâches

**Filtres** : Sprint, Type de parent, Collaborateur

**Tableau groupé par story/parent** : type, titre, tâches, totaux heures, dépassement en rouge

**Graphiques** : Estimation vs Réalisé par Story, par Feature/Enabler

### 9.6 Onglets SP1 / SP2 / SP3

**4 graphiques par sprint** : Stories, Bugs & Maintenance, Imprévus & PSM, Total

**Tableau KPI par collaborateur** : Capa vs Réalisé par catégorie + % + Analyse IA

### 9.7 Analyse IA de productivité

- Déclenchée par collaborateur depuis le tableau KPI sprint
- Rapport narratif structuré (checklist, fiche d'analyse, usage IA, validation)
- Sauvegardé (`PRODUCTIVITY_REPORT`), consultable sans rappeler le LLM

### 9.8 Onglet PI ALL

- KPI cards globales, graphique SP par état AZDO, tableau Features/Enablers

### 9.9 Onglet Capacités

- Saisie manuelle par sprint et collaborateur (7 catégories en heures)
- Import depuis PI Planning (blocs Layer 1) avec confirmation
- Priorité : `SprintCapacity` > `PlanningBlocks` Layer 1

### 9.10 Modèle de données Suivi

```
sprint_capacity  (id, pi_id, sprint_number, team_member_id [UNIQUE],
                  capa_stories_h, capa_bugs_h, capa_imprevus_h,
                  capa_agility_h, capa_reunions_h, capa_psm_h, capa_montee_h)
```

---

## 10. Module 4b — Panel Admin PI *(nouveau V4)*

### 10.1 Objectif

Panneau dédié aux opérations d'administration AZDO liées à un PI, accessible depuis le module PI Planning. Regroupe des actions qui nécessitent des droits d'écriture AZDO et un contexte de PI actif.

### 10.2 Onglets et fonctionnalités

#### Onglet 1 — Vérifier les itérations AZDO

- Vérifie que toutes les itérations nécessaires au PI existent dans AZDO (PI + 4 sprints + équipe)
- Affiche un tableau avec chemin attendu, chemin trouvé, statut (✓ / manquant / dates incorrectes)
- Bouton **Créer les itérations manquantes** : crée les nœuds AZDO via `create_classification_node`

#### Onglet 2 — Work items non clôturés

- Liste les User Story, Enabler Story, Maintenance, Feature, Enabler, Question de l'itération du PI précédent dont l'état n'est pas Closed
- Filtres par type de WI
- Actions groupées (sélection multiple) :
  - **Résoudre** : passe l'état à "Resolved" + renseigne `Isagri.ResolvedReason` (liste de raisons : Reporté, Annulé, Livré partiellement, etc.). Le champ raison s'applique uniquement aux types non-Task.
  - **Fermer** : passe l'état à "Closed" (uniquement pour les WI déjà en Resolved)
  - **Déplacer vers nouveau PI** : met à jour `System.IterationPath` vers le sprint cible du PI en cours (sélectionnable)

#### Onglet 3 — Chemins parents des stories

- Liste les Features/Enablers parents des stories planifiées (Layer 2) sur le PI en cours
- Pour chaque parent : chemin d'itération AZDO actuel vs chemin attendu (itération du PI en cours)
- Badge vert/rouge selon la correspondance
- Identifie les parents dont le chemin d'itération ne correspond pas au PI en cours de préparation

#### Onglet 4 — Transférer vers nouveau PI

- Liste les stories de l'itération du PI précédent non clôturées
- Bouton **Transférer** : déplace les stories sélectionnées vers le sprint choisi du PI en cours

#### Onglet 5 — Reset sprint

- Sélection du sprint (1 à 4) et de la couche (Layer 1, stories, congés)
- Confirmation avant action
- Supprime les blocs du sprint sélectionné

#### Onglet 6 — Générer les tâches enfants AZDO

- Prévisualisation des stories Layer 2 planifiées sans tâche enfant existante dans AZDO
- Pour chaque story éligible : titre, charge planifiée totale, assignés
- **Créer les tâches** : pour chaque story sélectionnée, crée une Task AZDO avec :
  - Titre = titre de la story
  - `System.IterationPath` = itération de la story
  - `Microsoft.VSTS.Scheduling.OriginalEstimate` = charge totale planifiée (jours × 8h)
  - Relation parent–enfant (`System.LinkTypes.Hierarchy-Reverse`)

### 10.3 Champs AZDO spécifiques

| Champ | Usage |
|-------|-------|
| `System.State` | État du WI (New, Active, Resolved, Closed…) |
| `System.IterationPath` | Chemin d'itération |
| `Isagri.ResolvedReason` | Raison de résolution (hors Tasks) |
| `System.LinkTypes.Hierarchy-Reverse` | Lien parent pour les tâches créées |
| `Microsoft.VSTS.Scheduling.OriginalEstimate` | Estimation originale en heures |

---

## 11. Module 5 — Automatisations / Triggers *(spécifié — à réaliser)*

### 11.1 Objectif

Permettre la configuration et l'exécution planifiée d'actions backend récurrentes, sans intervention manuelle. Les triggers sont configurables depuis une interface dédiée et s'exécutent via **APScheduler** intégré dans FastAPI.

**Prérequis infrastructure** : Azure App Service avec **Always-On activé** (plan Basic B1 ou supérieur) pour garantir la continuité d'exécution.

### 11.2 Actions disponibles (catalogue V4)

| Code | Description | Paramètres | Complexité |
|------|-------------|------------|------------|
| `azdo_sync_incremental` | Sync AZDO depuis la dernière date connue (J-N) | `lookback_days` (défaut : 1) | Faible |
| `bug_triage_assignment` | Triage IA des bugs/maintenance "à prioriser" + affectation automatique | `pi_id`, `mode` (suggestion/auto) | Élevée |
| `appinsights_bug_creation` | Récupère les erreurs App Insights et crée des bugs AZDO | `lookback_hours`, `min_occurrences`, `severity_filter` | Moyenne |

#### Action 1 — Sync AZDO incrémentale

- Filtre WIQL : `System.ChangedDate >= @today - {lookback_days}`
- Stocke la date du dernier sync réussi dans `AppSettings` (clé `azdo_last_incremental_sync`)
- Reprend depuis ce point à chaque exécution (résistant aux pannes)

#### Action 2 — Triage automatique des bugs/maintenance

Architecture en batterie d'agents IA :
```
Bugs/Maintenance état "À prioriser" (AZDO)
        ↓
Agent 1 : Analyse du bug (description, sévérité, composant impacté)
        ↓
Agent 2 : Matching compétences (profil Dev/QA, domaine fonctionnel)
        ↓
Agent 3 : Disponibilité (congés + charge PI Planning actuel)
        ↓
Agent 4 : Décision (score de confiance + recommandation d'affectation)
        ↓
Mode "suggestion" → log uniquement
Mode "auto"       → update_work_item (System.AssignedTo)
```

Points à préciser avant réalisation :
- Source des compétences par membre (table dédiée dans l'app ou tags AZDO ?)
- Seuil de confiance minimum pour affectation automatique
- Gestion des conflits (même personne demandée par plusieurs bugs)

#### Action 3 — App Insights → bugs AZDO

```
Azure Monitor / App Insights API
        ↓
Requête : exceptions + failed requests (dernières N heures)
        ↓
Dédoublonnage (hash sur stack trace ou titre normalisé)
        ↓
LLM : synthèse, titre structuré, description reproductible
        ↓
create_work_item (type "Bug") dans AZDO
```

Paramètres requis :
- `appinsights_app_id` + `appinsights_api_key` (à ajouter dans `app_settings`)
- Projet/équipe AZDO cible pour les bugs créés
- Stratégie de dédoublonnage (tag AZDO `[AutoBug]` + hash)

### 11.3 Modèle de données Triggers

```
triggers     (id, name, action_type, action_params JSON,
              schedule_type [interval|cron|daily],
              schedule_value,
              enabled BOOL,
              last_run_at, last_run_status [success|error|running],
              last_run_summary, next_run_at, created_at)

trigger_logs (id, trigger_id FK, ran_at, status, duration_ms,
              result_summary, result_detail JSON)
```

### 11.4 API Triggers

```
GET    /api/triggers/              → liste tous les triggers
POST   /api/triggers/              → créer
PUT    /api/triggers/{id}          → modifier
DELETE /api/triggers/{id}          → supprimer
PATCH  /api/triggers/{id}/toggle   → activer/désactiver
POST   /api/triggers/{id}/run      → déclencher manuellement
GET    /api/triggers/{id}/logs     → historique d'exécutions
```

### 11.5 Interface utilisateur Triggers

**Liste** : tableau avec nom, action, schedule, statut, dernière exécution, prochain run, boutons Activer/Désactiver/Exécuter/Modifier/Supprimer

**Formulaire** : nom, sélecteur d'action (avec paramètres dynamiques selon l'action), fréquence (interval / daily / cron), toggle actif

**Panneau logs** : tableau date/durée/statut/résumé, détail extensible

---

## 12. Module 6 — Historique inter-PI *(à réaliser)*

### 12.1 Données conservées
- Tous les PI passés (calendriers, engagements, réalisé)
- Notes et analyses PBR

### 12.2 Indicateurs inter-PI
- Vélocité globale inter-PI (tendance)
- Comparaison engagements vs réalisé par PI
- Évolution de la qualité DoR dans le temps

### 12.3 Export
- Export **PDF** d'un rapport de PI (calendrier + KPIs + analyses IA)

---

## 13. Paramètres de l'application

| Paramètre | Description |
|-----------|-------------|
| `azdo_organization` | URL ou nom de l'organisation Azure DevOps |
| `azdo_project` | Nom du projet AZDO |
| `azdo_team` | Nom de l'équipe AZDO |
| `azdo_pat` | Personal Access Token (Work Items Read+Write, Iterations Read+Write) |
| `llm_provider` | `openai` / `anthropic` / `azure` |
| `llm_model` | Nom du modèle (ex: `gpt-4o`, `claude-sonnet-4-6`) |
| `llm_api_key` | Clé secrète du fournisseur IA |
| `llm_endpoint` | URL Azure AI Foundry (uniquement pour `azure`) |
| `capacity_matrix_dev` | Matrice JSON de capacité Dev (clés flottants, demi-journées supportées) |
| `capacity_matrix_qa` | Matrice JSON de capacité QA |
| `capacity_matrix_psm` | Matrice JSON de capacité PSM |
| `block_colors` | Couleurs des catégories de briques (JSON) |
| `appinsights_app_id` | *(à venir)* Application ID Azure App Insights |
| `appinsights_api_key` | *(à venir)* Clé API App Insights |
| `azdo_last_incremental_sync` | *(à venir)* Date du dernier sync incrémental |

Membres de l'équipe : profil (Dev / QA / PSM / Squad Lead / Automate) et statut actif/inactif gérés dans l'interface.

---

## 14. Contraintes & Non-fonctionnel

- BDD SQLite : fichier unique `geotrouvetou.db`, sauvegardable simplement par copie
- Pas d'authentification en v4
- Interface en **français**
- Compatibilité navigateur : Chrome / Edge (dernières versions)
- Migrations de schéma : `ALTER TABLE ... ADD COLUMN` dans `_run_migrations()`, idempotentes (try/except)
- **Always-On Azure** : requis pour les triggers — plan App Service Basic B1 minimum
- **PAT AZDO** : requiert désormais les permissions Write (Work Items, Iterations) pour le Panel Admin

---

## 15. Structure du projet

```
GeoTrouvetouPilotage/
├── docs/
│   ├── cahier-des-charges.md        (v1 — référence initiale)
│   ├── cahier-des-charges-V2.md     (v2 — PI Planning + PBR + Logs)
│   ├── cahier-des-charges-V3.md     (v3 — Suivi & KPIs)
│   └── cahier-des-charges-V4.md     (v4 — Admin PI + Suivi enrichi + Triggers spécifiés)
├── frontend/                         Angular 19
│   └── src/app/
│       ├── modules/
│       │   ├── pi-planning/          ✅ Réalisé (+ admin-panel/)
│       │   ├── pbr/                  ✅ Réalisé
│       │   ├── logs/                 ✅ Réalisé
│       │   ├── suivi/                ✅ Réalisé
│       │   ├── historique/           🔲 À réaliser
│       │   ├── automatisations/      📋 À réaliser
│       │   └── parametres/           ✅ Réalisé
│       └── core/
│           ├── models/index.ts
│           └── services/api.service.ts
├── backend/                          FastAPI
│   ├── app/
│   │   ├── api/endpoints/            pi.py, pi_planning.py, pbr.py,
│   │   │                             azdo.py, settings.py, team_members.py,
│   │   │                             leaves.py, logs.py, suivi.py, admin.py
│   │   │                             triggers.py (à créer)
│   │   ├── models/                   SQLAlchemy ORM
│   │   └── services/
│   │       ├── azdo/                 client.py, sync.py, errors.py
│   │       ├── llm/client.py
│   │       ├── capacity.py
│   │       └── scheduler.py          (à créer — APScheduler)
│   ├── main.py
│   └── requirements.txt
├── deploy.ps1                        Script de déploiement Azure
├── README.md
└── CLAUDE.md
```

---

## 16. Historique des versions

| Version | Date | Périmètre |
|---------|------|-----------|
| V1 | Janv. 2026 | Cahier des charges initial |
| V2 | Mars 2026 | PI Planning + PBR/Refinement + Logs + Sync AZDO |
| V3 | Mars 2026 | Suivi & KPIs complet (Général, SP1/SP2/SP3, PI ALL, Capacités, Analyse IA productivité) |
| V4 | Mars 2026 | Panel Admin PI (6 onglets, écriture AZDO), Suivi enrichi (stories planifiées, DoR direct, CR Scrum of Scrums), matrices demi-journées, module Triggers spécifié |
