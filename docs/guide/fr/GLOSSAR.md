# Glossaire

Près de cent termes, par ordre alphabétique, chacun en trois lignes : ce que c'est, où on le trouve dans QKERN, et comment il s'appelle chez Supabase. Les termes techniques utilisés dans les explications ont leur propre entrée.

## AI Bridge

- **Ce que c'est :** Un chemin par lequel un agent IA comme Claude Code ou Codex prépare des modifications de votre projet, sans les exécuter lui-même.
- **Dans QKERN :** Vue AI Bridge dans la Console. L'agent lit le schéma et crée des aperçus ; l'approbation suit la règle du projet.
- **Chez Supabase :** Pas d'équivalent direct ; le plus proche est le serveur MCP de Supabase.

## Anon Key

- **Ce que c'est :** Le nom Supabase de la clé qui peut se trouver dans un frontend et ne voit que ce que les règles permettent à un anonyme.
- **Dans QKERN :** S'appelle clé publique chez QKERN ; voir cette entrée.
- **Chez Supabase :** Anon Key.

## Apache 2.0

- **Ce que c'est :** Une licence open source : utiliser, modifier et redistribuer librement, y compris à des fins commerciales, sans devoir publier son propre code.
- **Dans QKERN :** La licence de QKERN, du SDK et de la CLI ; le fichier LICENSE dans le dépôt.
- **Chez Supabase :** Supabase est sous Apache 2.0 et en partie sous d'autres licences.

## API

- **Ce que c'est :** Une langue fixe faite de demandes et de réponses, par laquelle deux programmes communiquent, par exemple votre frontend et le backend.
- **Dans QKERN :** Tout ce que QKERN offre vers l'extérieur est une API ; la vue API montre la Data API et les clés.
- **Chez Supabase :** API.

## Auth

- **Ce que c'est :** Tout ce qui touche à la connexion : comptes, mots de passe, connexion via d'autres fournisseurs, multifacteur, sessions.
- **Dans QKERN :** Project Auth pour les utilisateurs de votre app, vue Auth. Séparé du login de la Console elle-même.
- **Chez Supabase :** Auth, techniquement GoTrue.

## Backend

- **Ce que c'est :** La partie invisible d'une app : base de données, connexion, fichiers, règles. Le frontend montre, le backend sait.
- **Dans QKERN :** QKERN est un backend qu'on n'a pas besoin de construire soi-même.
- **Chez Supabase :** Supabase en est un aussi.

## Base de données

- **Ce que c'est :** Un programme qui range les données dans des tables, les retrouve vite et fait respecter des règles.
- **Dans QKERN :** PostgreSQL 17, une par projet et par environnement.
- **Chez Supabase :** PostgreSQL.

## Bucket

- **Ce que c'est :** Un conteneur pour fichiers dans le stockage d'objets, avec ses propres règles sur qui peut y déposer et en retirer.
- **Dans QKERN :** Vue Stockage, Buckets. Les buckets sont privés, les fichiers envoyés sont contrôlés contre les virus.
- **Chez Supabase :** Bucket.

## Centre d'approbation

- **Ce que c'est :** L'endroit où les modifications attendent qu'une personne ou une règle les approuve.
- **Dans QKERN :** Vue Centre de validation dans la Console. Règles : manuelle, sécurisée, autonome ; production demande en plus une signature externe.
- **Chez Supabase :** Pas d'équivalent.

## Certificat

- **Ce que c'est :** La pièce d'identité d'un serveur pour TLS, délivrée par un organisme auquel on fait confiance.
- **Dans QKERN :** Le drill de sauvegarde génère le sien et vérifie la connexion avec verify-full.
- **Chez Supabase :** Identique.

## Certification

- **Ce que c'est :** Chez QKERN : un test contre de vrais services, dont le rapport se trouve dans le dépôt. Pas un contrôle par des tiers.
- **Dans QKERN :** Les chiffres de la page d'accueil viennent de ces rapports ; un test interdit les chiffres saisis à la main.
- **Chez Supabase :** Pas d'équivalent.

## Change Set

- **Ce que c'est :** Une proposition de modification de la structure de la base, vérifiée et approuvée avant de s'exécuter.
- **Dans QKERN :** Naît d'un SQL qui écrit dans le SQL Editor ou via l'AI Bridge ; attend dans le centre d'approbation.
- **Chez Supabase :** Migrations, mais sans approbation intégrée.

## Clé API

- **Ce que c'est :** Un long secret qu'un programme envoie avec chaque requête, pour que le backend sache à quel projet elle appartient.
- **Dans QKERN :** Clé publique et clé de service, créées dans la vue API. Le secret s'affiche une fois ; QKERN n'en garde qu'une somme de contrôle.
- **Chez Supabase :** Anon Key et Service Role Key.

## Clé de projet

- **Ce que c'est :** Terme qui regroupe la clé publique et la clé de service d'un projet.
- **Dans QKERN :** Vue API.
- **Chez Supabase :** API Keys.

## Clé de service

- **Ce que c'est :** La clé pour les serveurs, jamais pour un frontend.
- **Dans QKERN :** Vue API, Clé de service pour le serveur. Pose le claim service_role ; la Row Level Security s'applique quand même.
- **Chez Supabase :** Service Role Key, qui chez Supabase contourne les règles.

## Clé étrangère

- **Ce que c'est :** Une colonne qui pointe vers la ligne d'une autre table, par exemple le numéro client dans une commande.
- **Dans QKERN :** Des clés étrangères PostgreSQL ordinaires ; le visualiseur de schéma qui les dessine n'est encore qu'un espace réservé.
- **Chez Supabase :** Foreign Key.

## Clé primaire

- **Ce que c'est :** La colonne qui rend chaque ligne unique, le plus souvent un numéro ou un UUID.
- **Dans QKERN :** Obligatoire pour chaque table que la Data API publie.
- **Chez Supabase :** Primary Key.

## Clé publique

- **Ce que c'est :** La clé qui peut se trouver dans un frontend. Elle ne peut faire que ce que les règles permettent à un anonyme.
- **Dans QKERN :** Vue API, Clé publique pour le navigateur. Pose le claim anon ; la Row Level Security s'applique.
- **Chez Supabase :** Anon Key.

## CLI

- **Ce que c'est :** Un programme pour la ligne de commande, qui fait des tâches sans interface graphique.
- **Dans QKERN :** Le paquet @qkern/cli : configurer un projet, récupérer le schéma, vérifier les migrations.
- **Chez Supabase :** Supabase CLI.

## Colonne

- **Ce que c'est :** Un champ d'une table, par exemple title ou done, avec un type fixe.
- **Dans QKERN :** Le Table Editor affiche les colonnes ; la Data API masque les colonnes sensibles comme les mots de passe.
- **Chez Supabase :** Column.

## Compose

- **Ce que c'est :** Un outil de Docker qui démarre ensemble plusieurs conteneurs décrits dans un fichier.
- **Dans QKERN :** docker-compose.yml démarre PostgreSQL, Redis, le stockage d'objets et l'antivirus ; les piles de certification ont leurs propres fichiers Compose.
- **Chez Supabase :** L'environnement Supabase local utilise aussi Compose.

## Console

- **Ce que c'est :** L'interface web de QKERN, où vous voyez et pilotez projets, données, utilisateurs et règles.
- **Dans QKERN :** Sous /console après la connexion. Beaucoup de vues sont réelles, certaines disent franchement qu'elles sont des espaces réservés.
- **Chez Supabase :** Studio.

## Conteneur

- **Ce que c'est :** Un programme dans une boîte fermée avec tout ce dont il a besoin, lancé par Docker.
- **Dans QKERN :** Les services du Compose de développement et les Functions tournent dans des conteneurs.
- **Chez Supabase :** Identique.

## Control Plane

- **Ce que c'est :** La partie de QKERN qui gère les organisations, les projets, les utilisateurs de la Console et les approbations.
- **Dans QKERN :** Une base PostgreSQL à part, qkern_control ; la Console parle avec elle.
- **Chez Supabase :** Le tableau de bord Supabase et son API d'administration.

## Cron

- **Ce que c'est :** Des tâches planifiées, par exemple chaque nuit à trois heures.
- **Dans QKERN :** Vue Intégrations, Cron. Chaque échéance arrive comme message dans une file d'attente, pour que deux planificateurs produisent un seul message.
- **Chez Supabase :** pg_cron.

## Data API

- **Ce que c'est :** L'interface par laquelle votre frontend lit et écrit des lignes, avec les droits de l'appelant.
- **Dans QKERN :** Construite automatiquement à partir de vos tables ; adresse tables, nom de la table, rows sous projet et environnement. Ne publie que les tables avec Row Level Security.
- **Chez Supabase :** PostgREST.

## Data Plane

- **Ce que c'est :** La base de données d'un projet pour chaque environnement, où se trouvent les données de votre app.
- **Dans QKERN :** Séparé du Control Plane ; en local, la base project_database.
- **Chez Supabase :** La base de données du projet.

## Docker

- **Ce que c'est :** Un outil qui lance des programmes dans des conteneurs, sans qu'on ait à les installer.
- **Dans QKERN :** Le Compose de développement et toutes les piles de certification tournent dans Docker.
- **Chez Supabase :** Identique.

## Edge Functions

- **Ce que c'est :** Le nom Supabase pour du code personnel qui tourne à la demande dans le backend.
- **Dans QKERN :** S'appellent Functions chez QKERN ; elles tournent dans des conteneurs avec contrôle des sorties réseau.
- **Chez Supabase :** Edge Functions.

## Environnement

- **Ce que c'est :** Une version séparée d'un projet : development pour construire, staging pour vérifier, production pour les clients.
- **Dans QKERN :** Choix en haut à droite dans la Console ; chacun a sa propre base de données, et production a des règles plus strictes.
- **Chez Supabase :** Les branches, à peu près.

## Extension

- **Ce que c'est :** Un module additionnel pour PostgreSQL, par exemple pour le chiffrement ou les tâches planifiées.
- **Dans QKERN :** La vue Base de données, Extensions montre celles qui sont actives dans la base de projet.
- **Chez Supabase :** Extensions.

## File d'attente

- **Ce que c'est :** Une file pour des tâches qui n'ont pas besoin d'être faites tout de suite ; un worker les prend l'une après l'autre.
- **Dans QKERN :** Project Queues dans PostgreSQL, vue Intégrations, Files ; avec déduplication, baux et lettres mortes.
- **Chez Supabase :** pgmq.

## Fonction (base de données)

- **Ce que c'est :** Un morceau de logique qui tourne dans la base de données elle-même et qu'on appelle en SQL ou via l'API.
- **Dans QKERN :** Vue Base de données, Fonctions ; appel via la Data API sous rpc et le nom de la fonction.
- **Chez Supabase :** Database Functions, appel via rpc.

## Fournisseur

- **Ce que c'est :** Un service par lequel les utilisateurs se connectent, par exemple Google ou le login d'une entreprise.
- **Dans QKERN :** Vue Auth, Méthodes de connexion ; certifié contre Dex et Mailpit.
- **Chez Supabase :** Auth Providers.

## Frontend

- **Ce que c'est :** La partie visible d'une app : la page dans le navigateur, l'app sur le téléphone.
- **Dans QKERN :** QKERN ne fournit pas de frontend ; il fournit ce à quoi un frontend parle.
- **Chez Supabase :** Identique.

## GoTrue

- **Ce que c'est :** Le service qui gère la connexion chez Supabase.
- **Dans QKERN :** S'appelle Project Auth chez QKERN ; voir Auth.
- **Chez Supabase :** GoTrue.

## Hachage du mot de passe

- **Ce que c'est :** Un mot de passe devient une empreinte dont on ne peut pas retrouver l'original ; seule cette empreinte est enregistrée.
- **Dans QKERN :** Argon2id avec un pepper tiré de la configuration, séparé pour la Console et pour Project Auth.
- **Chez Supabase :** bcrypt dans GoTrue.

## Image

- **Ce que c'est :** Le modèle à partir duquel Docker lance un conteneur, par exemple postgres:17-alpine.
- **Dans QKERN :** Les manifestes sous docs/evidence indiquent les images de chaque passage.
- **Chez Supabase :** Identique.

## Index

- **Ce que c'est :** Un répertoire dans la base de données qui accélère les recherches dans les grandes tables.
- **Dans QKERN :** Vue Base de données, Index.
- **Chez Supabase :** Indexes.

## Jeton

- **Ce que c'est :** Une pièce d'identité sous forme de texte, qu'un programme envoie pour s'identifier ; le JWT et le Refresh Token sont des jetons.
- **Dans QKERN :** Project Auth les délivre ; les clés API sont un autre type de pièce d'identité.
- **Chez Supabase :** Identique.

## Job

- **Ce que c'est :** Une tâche isolée dans une file d'attente, qu'un worker vient chercher.
- **Dans QKERN :** Messages dans Project Queues ; vue Intégrations, Files.
- **Chez Supabase :** Message dans pgmq.

## Journal d'audit

- **Ce que c'est :** Un registre qui dit qui a modifié quoi et quand, et qu'on ne peut pas changer après coup sans que cela se voie.
- **Dans QKERN :** Vue Journaux, Audit. Les entrées sont chaînées par hachage ; un exercice de restauration recalcule la chaîne.
- **Chez Supabase :** Audit Logs sous Authentication, avec une portée plus étroite.

## JSON

- **Ce que c'est :** Un format de texte pour les données, facile à lire pour les programmes : accolades, noms, valeurs.
- **Dans QKERN :** Toutes les réponses de l'API sont en JSON ; la configuration du bloc Lokaler Schnellstart aussi.
- **Chez Supabase :** Identique.

## JWT

- **Ce que c'est :** Une pièce d'identité signée qu'un utilisateur connecté envoie avec chaque requête ; le backend vérifie la signature au lieu d'interroger la base de données.
- **Dans QKERN :** Project Auth délivre des JWT ; les clés correspondantes se trouvent dans la vue Paramètres, Clés JWT.
- **Chez Supabase :** JWT.

## Ligne

- **Ce que c'est :** Une entrée dans une table, par exemple une note.
- **Dans QKERN :** Le Table Editor affiche, insère, modifie et supprime des lignes, toujours avec Row Level Security.
- **Chez Supabase :** Row.

## Limite de débit

- **Ce que c'est :** Un plafond sur le nombre de fois qu'une chose peut se produire dans un laps de temps, par exemple les tentatives de connexion par minute.
- **Dans QKERN :** Intégrée en dur à l'inscription et à la connexion ; le réglage par projet n'est encore qu'un espace réservé.
- **Chez Supabase :** Rate Limits sous Authentication.

## Locataire

- **Ce que c'est :** Une cliente ou une organisation dont les données sont séparées de toutes les autres, alors qu'elles utilisent le même logiciel.
- **Dans QKERN :** Chaque organisation est un locataire ; la Row Level Security du Control Plane les sépare, y compris pour QKERN lui-même.
- **Chez Supabase :** Chaque projet Supabase est une instance à part.

## MCP

- **Ce que c'est :** Un protocole par lequel les agents IA appellent des outils, par exemple pour lire le schéma.
- **Dans QKERN :** QKERN propose un serveur MCP pour les agents ; manuel, section 10.
- **Chez Supabase :** Supabase MCP.

## Memory Mode

- **Ce que c'est :** Un mode de fonctionnement où QKERN garde tout en mémoire vive ; au redémarrage, tout est perdu.
- **Dans QKERN :** QKERN_RUNTIME_MODE=memory, seulement pour essayer l'interface. Le démarrage rapide utilise postgres.
- **Chez Supabase :** Pas d'équivalent.

## Méthode HTTP

- **Ce que c'est :** Le verbe d'une requête : GET lit, POST crée, PATCH modifie, DELETE supprime.
- **Dans QKERN :** La Data API utilise exactement ces quatre-là pour les lignes.
- **Chez Supabase :** Identique.

## Migration

- **Ce que c'est :** Une modification de la structure de la base, écrite en SQL et numérotée, pour qu'elle s'exécute partout dans le même ordre.
- **Dans QKERN :** Le Control Plane a des migrations numérotées sous db/migrations ; les modifications de projet passent par des Change Sets.
- **Chez Supabase :** Migrations.

## Module

- **Ce que c'est :** Une partie délimitée de QKERN, avec sa propre tâche et sa propre frontière, par exemple Storage ou Queues.
- **Dans QKERN :** Les frontières sont décrites dans docs/MODULES.md.
- **Chez Supabase :** Pas d'équivalent.

## Node.js

- **Ce que c'est :** L'environnement d'exécution qui fait tourner du JavaScript en dehors du navigateur.
- **Dans QKERN :** QKERN demande Node.js 24.7 ou plus récent.
- **Chez Supabase :** Identique, pour supabase-js.

## npm

- **Ce que c'est :** Le gestionnaire de paquets de Node.js : il récupère des bibliothèques et exécute des scripts.
- **Dans QKERN :** npm ci installe, npm run dev démarre, npm install @qkern/sdk récupère le SDK.
- **Chez Supabase :** Identique.

## OAuth

- **Ce que c'est :** Une procédure par laquelle un utilisateur se connecte via un autre fournisseur, par exemple avec son compte Google.
- **Dans QKERN :** Méthode de connexion de Project Auth, certifiée contre de vrais fournisseurs OIDC.
- **Chez Supabase :** Social Login.

## Objet

- **Ce que c'est :** Un fichier dans le stockage d'objets, avec son nom et ses métadonnées.
- **Dans QKERN :** Ce qui se trouve dans un bucket.
- **Chez Supabase :** Object.

## Open Source

- **Ce que c'est :** Le code source est public et peut être utilisé et modifié selon une licence.
- **Dans QKERN :** QKERN est open source sous Apache 2.0.
- **Chez Supabase :** Identique.

## Organisation

- **Ce que c'est :** L'espace de travail auquel tout appartient : projets, utilisateurs de la Console, factures.
- **Dans QKERN :** Créée à l'inscription ; l'ID se trouve sous Paramètres, Général.
- **Chez Supabase :** Organization.

## Pile de certification

- **Ce que c'est :** Un montage jetable de conteneurs, dans lequel un test tourne contre de vrais services et qui disparaît ensuite.
- **Dans QKERN :** docker-compose.*-certification.yml ; npm run test:postgres:docker et les commandes voisines.
- **Chez Supabase :** Pas d'équivalent.

## Plan par étapes

- **Ce que c'est :** Le plan qui fixe dans quel ordre QKERN grandit, avec des critères d'entrée et de sortie pour chaque étape.
- **Dans QKERN :** docs/STUFENPLAN.md.
- **Chez Supabase :** Pas d'équivalent.

## Point de terminaison

- **Ce que c'est :** Une adresse précise d'une API, par exemple les lignes d'une table.
- **Dans QKERN :** Tous les points de terminaison figurent dans l'OpenAPI sous /api/openapi.json et dans la vue API.
- **Chez Supabase :** Endpoint.

## Point-in-time Recovery

- **Ce que c'est :** La restauration à un moment précis, et pas seulement à la dernière sauvegarde.
- **Dans QKERN :** Prouvée contre un vrai PostgreSQL avec archive WAL ; dans la Console, encore un espace réservé.
- **Chez Supabase :** PITR dans l'offre payante.

## Policy

- **Ce que c'est :** Une règle dans la base de données qui dit qui peut voir ou modifier quelles lignes.
- **Dans QKERN :** Vue Base de données, Policies. Sans policies, la Row Level Security ne laisse rien passer.
- **Chez Supabase :** Policies.

## Port

- **Ce que c'est :** Un numéro sous lequel un programme est joignable sur un ordinateur.
- **Dans QKERN :** QKERN écoute sur 3000, PostgreSQL sur 5432.
- **Chez Supabase :** Identique.

## PostgreSQL

- **Ce que c'est :** Une base de données libre et très répandue, entretenue depuis trente ans.
- **Dans QKERN :** Version 17, pour le Control Plane et pour chaque base de projet.
- **Chez Supabase :** Identique.

## PostgREST

- **Ce que c'est :** Le service qui, chez Supabase, transforme des tables en API REST.
- **Dans QKERN :** S'appelle Data API chez QKERN et fait partie du programme lui-même.
- **Chez Supabase :** PostgREST.

## Preuve

- **Ce que c'est :** Un justificatif qu'on ne peut pas falsifier après coup : signé, daté, vérifiable.
- **Dans QKERN :** Les journaux et manifestes sous docs/evidence, et la preuve de sauvegarde signée que lit le vérificateur.
- **Chez Supabase :** Pas d'équivalent.

## Production Apply

- **Ce que c'est :** L'exécution d'une modification approuvée dans l'environnement production.
- **Dans QKERN :** Demande, en plus de l'approbation, la signature d'un signataire externe ; runbook dans docs.
- **Chez Supabase :** Pas d'équivalent.

## Projet

- **Ce que c'est :** Une app avec ses propres données, utilisateurs, fichiers et clés.
- **Dans QKERN :** L'inscription crée First Project ; l'ID se trouve sous Paramètres, Général.
- **Chez Supabase :** Project.

## Propriétaire du registre

- **Ce que c'est :** Le rôle de base de données à qui appartiennent toutes les tables d'un projet. Il ne peut pas se connecter ; on passe à ce rôle avec SET ROLE.
- **Dans QKERN :** qkern_ledger_owner dans la base de projet ; la comptabilité des migrations exige qu'il n'ait pas de login.
- **Chez Supabase :** Pas d'équivalent direct ; Supabase travaille avec le rôle postgres.

## Provisionneur

- **Ce que c'est :** Le service qui crée une base de données pour un nouveau projet et inscrit la connexion.
- **Dans QKERN :** Un worker à part, qui s'adresse à un broker HTTPS ; en local, npm run dev:bind-project-database le remplace.
- **Chez Supabase :** Invisible, en arrière-plan.

## Publication

- **Ce que c'est :** Une liste de tables dont PostgreSQL signale les modifications vers l'extérieur, par exemple pour les mises à jour en direct.
- **Dans QKERN :** Vue Base de données, Publications ; base de Realtime.
- **Chez Supabase :** Publications.

## Q-Orbit

- **Ce que c'est :** L'animation de la page d'accueil : des briques qui tournent autour du noyau.
- **Dans QKERN :** Pure décoration, sans fonction.
- **Chez Supabase :** Pas d'équivalent.

## Realtime

- **Ce que c'est :** Envoyer les modifications de données tout de suite à tous ceux qui regardent, sans recharger la page.
- **Dans QKERN :** Vue Temps réel, Inspecteur ; via WebSocket, certifié contre un vrai PostgreSQL.
- **Chez Supabase :** Realtime.

## Refresh Token

- **Ce que c'est :** Une deuxième pièce d'identité qui permet de renouveler un JWT expiré sans se reconnecter.
- **Dans QKERN :** Fait partie de Project Auth ; il est remplacé à chaque renouvellement.
- **Chez Supabase :** Refresh Token.

## REST

- **Ce que c'est :** Une façon de construire des API : des adresses pour les choses, des méthodes HTTP pour les actions, du JSON pour les données.
- **Dans QKERN :** Toute l'API de QKERN est REST ; décrite dans l'OpenAPI.
- **Chez Supabase :** Identique.

## Rôle

- **Ce que c'est :** Un compte utilisateur dans PostgreSQL avec certains droits, par exemple la lecture seule.
- **Dans QKERN :** QKERN travaille avec de nombreux rôles aux droits étroits ; la vue Base de données, Rôles montre ceux de la base de projet.
- **Chez Supabase :** Roles.

## Row Level Security

- **Ce que c'est :** Une règle directement dans la base de données, qui décide pour chaque ligne qui peut la voir ou la modifier.
- **Dans QKERN :** Obligatoire pour chaque table que la Data API publie ; les règles se trouvent sous Base de données, Policies. Même la clé de service ne la contourne pas.
- **Chez Supabase :** Row Level Security, même nom.

## Runtime Mode

- **Ce que c'est :** L'interrupteur qui décide si QKERN utilise de vraies bases de données ou garde tout en mémoire vive.
- **Dans QKERN :** QKERN_RUNTIME_MODE=postgres ou memory dans .env.local.
- **Chez Supabase :** Pas d'équivalent.

## Sauvegarde

- **Ce que c'est :** Une copie des données, à partir de laquelle on peut restaurer après une erreur ou une panne.
- **Dans QKERN :** Un drill prouve la sauvegarde et la restauration à un moment précis contre un vrai PostgreSQL ; la Console n'affiche encore qu'un espace réservé sous Sauvegardes.
- **Chez Supabase :** Backups sous Database, avec Point-in-time Recovery dans l'offre payante.

## Schéma

- **Ce que c'est :** Deux sens : la structure d'une base de données (quelles tables, quelles colonnes) et un espace de noms à l'intérieur, par exemple public.
- **Dans QKERN :** La Data API travaille dans le schéma public ; la vue Base de données montre la structure.
- **Chez Supabase :** Identique.

## SDK

- **Ce que c'est :** Une bibliothèque qui rend une API facile à utiliser dans le langage du développeur, avec des types et des fonctions au lieu d'adresses.
- **Dans QKERN :** @qkern/sdk pour TypeScript et JavaScript ; npm install @qkern/sdk@alpha.
- **Chez Supabase :** supabase-js.

## Service Role Key

- **Ce que c'est :** La clé Supabase qui contourne la Row Level Security.
- **Dans QKERN :** S'appelle clé de service chez QKERN et ne contourne pas les règles ; si quelqu'un doit tout voir, il reçoit une règle qui le dit.
- **Chez Supabase :** Service Role Key.

## Session

- **Ce que c'est :** Le temps entre la connexion et la déconnexion, pendant lequel le backend reconnaît un utilisateur.
- **Dans QKERN :** La Console et Project Auth tiennent chacun leurs propres sessions.
- **Chez Supabase :** Session.

## SQL

- **Ce que c'est :** La langue dans laquelle on parle à une base de données : CREATE TABLE, SELECT, INSERT.
- **Dans QKERN :** SQL Editor dans la Console (en lecture) ; ce qui écrit devient un Change Set.
- **Chez Supabase :** Identique.

## Storage

- **Ce que c'est :** Un espace de rangement pour les fichiers : images, documents, envois.
- **Dans QKERN :** Project Storage, vue Stockage ; compatible S3, privé, avec contrôle antivirus par ClamAV.
- **Chez Supabase :** Storage.

## Studio

- **Ce que c'est :** L'interface web de Supabase.
- **Dans QKERN :** S'appelle Console chez QKERN.
- **Chez Supabase :** Studio.

## supabase-js

- **Ce que c'est :** La bibliothèque JavaScript de Supabase.
- **Dans QKERN :** S'appelle @qkern/sdk chez QKERN.
- **Chez Supabase :** supabase-js.

## Table

- **Ce que c'est :** Des données en lignes et en colonnes, comme un tableau dans un tableur, mais avec des types et des règles fixes.
- **Dans QKERN :** Table Editor dans la Console ; créée en SQL, publiée avec Row Level Security et clé primaire.
- **Chez Supabase :** Table.

## Test de mutation

- **Ce que c'est :** On introduit exprès une erreur et on vérifie que les tests la trouvent. S'ils restent verts, ils ne valent rien.
- **Dans QKERN :** Chaque release en a un ; le résultat figure dans docs/evidence sous le nom Mutation.
- **Chez Supabase :** Pas d'équivalent.

## TLS

- **Ce que c'est :** Le chiffrement des connexions ; le cadenas dans le navigateur.
- **Dans QKERN :** Obligatoire en production entre QKERN et ses bases de données ; le drill de sauvegarde l'impose aussi en local.
- **Chez Supabase :** Identique.

## Trigger

- **Ce que c'est :** Un morceau de logique que la base de données exécute elle-même quand quelque chose se passe, par exemple à l'insertion d'une ligne.
- **Dans QKERN :** Vue Base de données, Déclencheurs.
- **Chez Supabase :** Triggers.

## URL signée

- **Ce que c'est :** Un lien vers un fichier, valable pour un temps limité et porteur d'une signature.
- **Dans QKERN :** C'est ainsi que Storage ouvre l'accès à des fichiers privés pour peu de temps.
- **Chez Supabase :** Signed URL.

## Variable d'environnement

- **Ce que c'est :** Un réglage qu'un programme lit dans son environnement au démarrage, par exemple une adresse ou un secret.
- **Dans QKERN :** Tous les réglages de QKERN ; modèle .env.example, votre copie .env.local.
- **Chez Supabase :** Identique.

## Volume

- **Ce que c'est :** La mémoire d'un conteneur qui survit aux redémarrages.
- **Dans QKERN :** qkern-postgres contient les bases du Compose de développement ; docker compose down -v l'efface.
- **Chez Supabase :** Identique.

## WAL

- **Ce que c'est :** Le journal dans lequel PostgreSQL écrit chaque modification avant qu'elle prenne effet ; il permet de restaurer n'importe quel moment.
- **Dans QKERN :** Le drill de sauvegarde archive des segments WAL et restaure à partir d'eux.
- **Chez Supabase :** Identique, mais invisible.

## Webhook

- **Ce que c'est :** Un message que le backend envoie à une adresse externe quand quelque chose se passe.
- **Dans QKERN :** Vue Fonctions & tâches ; la signature des messages est certifiée contre un vrai Vault.
- **Chez Supabase :** Database Webhooks.

## WebSocket

- **Ce que c'est :** Une connexion qui reste ouverte, pour que le backend puisse envoyer des messages de lui-même.
- **Dans QKERN :** Realtime utilise WebSocket ; protocole dans docs/REALTIME_PROTOCOL.md.
- **Chez Supabase :** Identique.

## Worker

- **Ce que c'est :** Un programme en arrière-plan qui traite les tâches d'une file d'attente.
- **Dans QKERN :** Sept processus à part : Queues, Compute, migrations, incidents, Realtime, Apply, provisionneur.
- **Chez Supabase :** Invisible, en arrière-plan.
