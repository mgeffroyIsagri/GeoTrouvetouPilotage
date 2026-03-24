# Cahier des charges — GeoTrouvetouPilotage
> Application de pilotage de la production de l'équipe GeoTrouvetou
> Stack : Angular (front) · FastAPI (back) · SQLite (BDD)

---

## 1. Contexte & Objectifs

Remplacer les outils actuels (Klaxoon, scripts Python ad hoc) par une application centralisée permettant de :
- Préparer et animer les sessions de **Product Backlog Refinement (PBR)**
- Construire et visualiser le **PI Planning** (calendrier capacitaire + engagement)
- **Suivre l'avancement** d'un PI en cours avec des KPIs enrichis par IA
- Consulter l'**historique** des PI passés
- **Synchroniser** les données depuis Azure DevOps (AZDO)

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
Frontend        Angular (SPA)
Backend         FastAPI (Python)
Base de données SQLite (locale, fichier unique)
IA              Appel LLM configurable (OpenAI, Anthropic Claude, etc.)
AZDO            API REST Azure DevOps via PAT (Personal Access Token)
```

Le PAT AZDO est configuré une fois dans les paramètres de l'application.
Le LLM utilisé (provider + clé API + modèle) est également configurable dans les paramètres.

---

## 4. Modules — Priorisation

| Priorité | Module |
|----------|--------|
| 1 | **PI Planning** (calendrier + capacité) |
| 2 | **Synchronisation AZDO** (socle technique) |
| 3 | **PBR / Refinement** |
| 4 | **Suivi & KPIs** |
| 5 | **Historique inter-PI** |

---

## 5. Module 1 — PI Planning (Calendrier capacitaire)

### 5.1 Structure d'un PI
- **Fixe** : 4 sprints par PI
  - Sprint 1 : 3 semaines
  - Sprint 2 : 3 semaines
  - Sprint 3 : 4 semaines
  - Sprint 4 : IP Sprint — 3 semaines (Innovation & Planning)
- **Bornes d'un sprint** : commence le **vendredi matin**, se termine le **jeudi soir**
- **IP Sprint** : pas de règle restrictive sur les catégories, on peut y planifier n'importe quelle activité
- Un PI est lié à une `IterationPath` AZDO

### 5.2 Vue calendrier
- Affichage **par sprint**, avec une colonne par **jour ouvré** (vendredi → jeudi)
- Une **ligne par collaborateur** avec :
  - Nom + profil (Dev / QA / PSM)
  - **St = X** : nombre de jours de capacité disponibles pour les stories sur le sprint (calculé automatiquement depuis la matrice et les congés)
- **Filtre de vue** : affichage de tous les collaborateurs (vue équipe, 7 personnes) ou d'un seul collaborateur à la fois (vue individuelle)
- Les **congés** sont saisis manuellement dans l'appli et bloquent les jours correspondants
- Chaque collaborateur a un **profil fixe** : Dev, QA ou PSM

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

### 5.4 Matrices de capacité
- **Configurables** par le PO/PSM dans l'appli (interface dédiée)
- 3 matrices distinctes selon le profil : **Dev/DevOps**, **QA**, **PSM**
- Chaque matrice définit, pour un nombre de jours travaillés dans la semaine, la répartition en points/jours par catégorie d'activité
- Correspondance avec les matrices fournies (cf. captures d'écran)

### 5.5 Génération automatique
- Au démarrage d'un PI Planning, **toutes les catégories hors Stories sont pré-positionnées automatiquement** en fonction :
  - Du profil du collaborateur
  - Du nombre de jours travaillés sur chaque semaine (déduit des congés saisis)
  - De la matrice de capacité applicable
- La catégorie **Stories (Dev et QA)** est laissée vide : elle est remplie **le jour du PI Planning** lors de l'engagement sur les sujets

### 5.6 Règles des briques

| Catégorie | Taille min | Redimensionnable | Déplaçable | Superposable |
|-----------|-----------|-----------------|-----------|--------------|
| Congés / Absences | 1 jour | Non (fixe 1j) | Oui | Non |
| Stories / Dev | ½ jour | Oui (largeur libre) | Oui (libre dans le sprint) | Oui (2ème couche) |
| Stories / Test (QA) | ½ jour | Oui (largeur libre) | Oui (libre dans le sprint) | Oui (2ème couche) |
| Toutes les autres | Imposé par matrice | Non | Non | Non |

**Règles de superposition des briques Stories :**
- Une brique Story se positionne en **2ème couche visuelle** (par-dessus les briques fixes)
- Elle peut s'étaler **librement**, y compris sur **plusieurs semaines** au sein du sprint
- Sa largeur = **durée de réalisation prévue** (en jours ouvrés) + les durées des briques fixes recouvertes
- Les briques recouvertes restent **visibles en dessous** (transparence ou décalage visuel) et sont **conservées en base de données**
- Le placement est **libre** : l'utilisateur pose la brique où il le souhaite sur la ligne du collaborateur

### 5.7 Contenu et interaction des briques
- Les briques n'affichent **pas de texte** en v1 (la couleur seule identifie la catégorie)
- **Clic sur une brique Stories (Dev ou QA)** : ouvre un panneau latéral ou une modale avec le détail du work item AZDO associé (titre, description, critères d'acceptation, état)
- Les autres catégories ne sont pas cliquables en v1

### 5.8 Ajustement manuel
- Drag & drop, redimensionnement et suppression selon les règles du tableau ci-dessus
- Lors de la pose d'une brique Story : sélection du work item AZDO associé (feature/story) via une recherche dans les items synchronisés

### 5.9 Vue synthèse capacité
- Pour chaque collaborateur et chaque sprint : total de jours disponibles vs répartis par catégorie
- Alerte visuelle si surcharge ou sous-charge

---

## 6. Module 2 — Synchronisation AZDO

### 6.1 Déclenchement
- **Manuelle** uniquement : bouton "Synchroniser" accessible dans l'interface
- Le PAT AZDO est stocké en configuration (non exposé côté front)

### 6.2 Données synchronisées

| Donnée | Endpoint AZDO |
|--------|--------------|
| Work items (User Story, Enabler Story, Task, Bug) | `_apis/wit/wiql` + `_apis/wit/workitems` |
| Iterations / sprints | `_apis/work/teamsettings/iterations` |
| Membres de l'équipe | `_apis/projects/{project}/teams/{team}/members` |
| Completed Work (temps saisis sur tâches) | Champ `Microsoft.VSTS.Scheduling.CompletedWork` |
| État des work items | Champ `System.State` |

### 6.3 Modèle de données local (SQLite)

Tables principales :

- `work_items` (id, type, title, state, iteration_path, assigned_to, description, story_points, completed_work, ...)
- `iterations` (id, name, start_date, end_date, path)
- `team_members` (id, display_name, unique_name, profile)
- `pi` (id, name, start_date, end_date)
- `sync_log` (date, status, details)

---

## 7. Module 3 — PBR / Refinement

### 7.1 Gestion des sessions
- Chaque session PBR est **liée à un PI** (relation obligatoire avec la table `pi`)
- Le **PO/PSM** crée une session en sélectionnant le PI cible et en lui donnant un nom (ex : "PBR Sprint 2 — Mai 2025")
- **Une seule session PBR active à la fois** (toutes sessions confondues)
- La liste des sessions est filtrable par PI

### 7.2 Gestion des sujets
- Le **PO/PSM** saisit manuellement les **IDs AZDO** des sujets à raffiner (Enablers / Features)
- L'appli récupère depuis AZDO (ou la BDD locale synchronisée) : titre, description, critères d'acceptation, stories enfants, hypothèses de bénéfices, risques

### 7.3 Déroulement d'une session PBR
Pour chaque sujet, chaque participant peut saisir :

| Information | Détail |
|-------------|--------|
| Note DOR | 1 à 5 |
| Commentaire libre | Texte |
| Vote Story Points | Numérique |
| Charge Dev | En jours |
| Charge QA | En jours |

En fin de session, pour chaque sujet **non DOR** :
- Saisie d'un **plan d'action** pour la prochaine séance

### 7.4 Analyse IA
- Déclenchée par le PO/PSM sur un sujet donné
- Analyse le contenu du work item (description, critères d'acceptation, stories, notes PBR) et produit :
  - Une **note DOR automatique** (1 à 5)
  - Un **commentaire détaillé** justifiant la note
- Le LLM utilisé est **configurable** (provider, modèle, clé API) dans les paramètres de l'application

### 7.5 Historique PBR
- Toutes les sessions PBR sont archivées par sujet
- Consultables dans une vue dédiée : évolution de la note DOR au fil des séances

---

## 8. Module 4 — Suivi & KPIs

### 8.1 Source de données
- Données AZDO synchronisées dans la BDD locale

### 8.2 KPIs disponibles

**Par sprint / par collaborateur :**
- Vélocité (story points livrés)
- Taux de complétion des stories
- Temps passé par catégorie d'activité (via Completed Work des tâches)
- Comparaison estimé vs réalisé (Original Estimate vs Completed Work)

**Bugs & Maintenances :**
- Nombre de bugs traités, temps passé, taux de résolution

**Analyses IA :**
- Analyse de productivité **individuelle** par collaborateur (synthèse narrative + points forts/axes d'amélioration)
- Analyse de productivité **collective** de l'équipe
- LLM configurable (même paramètre que le module PBR)

### 8.3 Visualisations
- Graphiques par sprint et par PI (barres, courbes, jauges)
- Tableau de bord synthétique

---

## 9. Module 5 — Historique inter-PI

### 9.1 Données conservées
- Tous les PI passés (calendriers, engagements, réalisé)
- Notes et analyses PBR

### 9.2 Indicateurs inter-PI
- Vélocité globale inter-PI (tendance)
- Comparaison engagements vs réalisé par PI
- Évolution de la qualité DOR dans le temps
- Tendances de productivité par collaborateur

### 9.3 Export
- Export **PDF** d'un rapport de PI (calendrier + KPIs + analyses IA)

---

## 10. Paramètres de l'application

| Paramètre | Description |
|-----------|-------------|
| PAT AZDO | Jeton d'accès Azure DevOps |
| Organisation / Projet AZDO | URL org + nom projet |
| LLM Provider | OpenAI / Anthropic / autre |
| LLM Modèle | ex: gpt-4o, claude-sonnet-4-6 |
| LLM Clé API | Clé secrète |
| Matrices de capacité | Par profil (Dev, QA, PSM) |
| Membres de l'équipe | Profil assigné à chaque membre |
| Couleurs des briques | Par catégorie d'activité |

---

## 11. Contraintes & Non-fonctionnel

- **v1** : déploiement 100% local, aucune dépendance externe hormis AZDO et LLM
- BDD SQLite : fichier unique, sauvegardable simplement
- Pas d'authentification en v1
- Interface en **français**
- Compatibilité navigateur : Chrome / Edge (dernières versions)

---

## 12. Livrables attendus

1. Dépôt GitHub `GeoTrouvetouPilotage` avec structure monorepo :
   ```
   /frontend   → Angular
   /backend    → FastAPI + SQLite
   /docs       → Cahier des charges, ADR, guides
   ```
2. README avec instructions d'installation locale
3. Fichier `docker-compose.yml` (optionnel, pour faciliter le déploiement futur)
