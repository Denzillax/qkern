# Premier backend

> Pour les développeurs qui mettent en place un [backend](GLOSSAR.md#backend) pour la première fois. Vous suivez le même chemin que le [démarrage rapide](SCHNELLSTART.md), mais ici chaque étape dit d'abord pourquoi elle est nécessaire, puis ce qui vient de se passer. Comptez une demi-heure si vous lisez tout.

## Ce qu'est un backend

Une app a deux moitiés. Le [frontend](GLOSSAR.md#frontend) est ce que l'utilisateur voit : la page dans le navigateur, l'app sur le téléphone. Le backend est tout ce qu'il y a derrière : la [base de données](GLOSSAR.md#base-de-donnees) où se trouvent les données, la connexion, les fichiers, les règles sur qui a le droit de faire quoi.

Le frontend et le backend communiquent par une [API](GLOSSAR.md#api), une langue fixe faite de demandes et de réponses. Chez QKERN, c'est [REST](GLOSSAR.md#rest) sur HTTP : le frontend demande « donne-moi les lignes de la table notes », le backend répond en [JSON](GLOSSAR.md#json).

QKERN est un backend de ce type, déjà construit. Votre travail consiste à le démarrer, à lui dire quelles tables existent et qui peut les voir, puis à lui parler depuis le frontend.

## Ce qu'il vous faut

- [Node.js](GLOSSAR.md#node-js) {{node}} ou plus récent, avec [npm](GLOSSAR.md#npm). Node exécute du JavaScript en dehors du navigateur ; QKERN lui-même est écrit en TypeScript et tourne sur Node.
- Docker Desktop. [Docker](GLOSSAR.md#docker) lance des programmes dans des boîtes fermées, les [conteneurs](GLOSSAR.md#conteneur), sans que vous ayez à les installer. Vous obtenez ainsi PostgreSQL, Redis, le stockage d'objets et l'antivirus avec une seule commande.
- Git, pour récupérer le code source.
- PowerShell ou un Bash ; les exemples ici sont en PowerShell.

Récupérez d'abord le code source. Toutes les commandes suivantes s'exécutent dans ce dossier, là où se trouve `package.json`. `git clone` télécharge le dépôt, c'est-à-dire le code source avec son historique, sur votre ordinateur :

```powershell
git clone https://github.com/Denzillax/qkern.git
cd qkern
```

## 1. Démarrer les services

Pourquoi : QKERN se compose du programme lui-même et de quatre services dont il a besoin. Les services viennent de Docker ; le programme, vous le démarrez à l'étape 3.

```powershell
node --version
docker compose up -d
```

Ce qui s'est passé : `node --version` affiche `v{{node}}` ou plus ; sinon, mettez Node à jour. [Compose](GLOSSAR.md#compose) lit le fichier `docker-compose.yml` et démarre `postgres`, `redis`, `minio` et `clamav` en arrière-plan, plus quatre courts conteneurs de contrôle qui s'arrêtent aussitôt. Au premier démarrage, PostgreSQL crée deux bases : celle du [Control Plane](GLOSSAR.md#control-plane), où QKERN garde ses propres données, et `project_database`, où se trouveront les données de votre app. Cela prend une demi-minute.

> La base de projet n'est créée que sur un volume neuf. Un [volume](GLOSSAR.md#volume) est la mémoire d'un conteneur qui survit aux redémarrages. Si vous avez déjà démarré QKERN, `docker compose down -v` efface toutes les données locales et vous repartez de zéro.

## 2. Configuration

Pourquoi : QKERN lit ses réglages dans des [variables d'environnement](GLOSSAR.md#variable-d-environnement). Le fichier `.env.example` les liste toutes avec une explication ; votre propre copie s'appelle `.env.local` et contient des valeurs qui ne regardent que vous.

```powershell
Copy-Item .env.example .env.local
```

Ouvrez `.env.local` et changez six choses :

- `QKERN_RUNTIME_MODE=postgres` est déjà réglé ainsi ; laissez-le. Cela dit à QKERN d'utiliser la vraie base de données plutôt qu'une mémoire qui se vide au redémarrage.
- `QKERN_PASSWORD_PEPPER`, `QKERN_PROJECT_AUTH_PASSWORD_PEPPER` et `QKERN_STATEMENT_ENCRYPTION_KEY` : inscrivez une valeur aléatoire différente dans chacun. Un pepper est un secret que QKERN mélange à chaque [hachage du mot de passe](GLOSSAR.md#hachage-du-mot-de-passe) ; sans lui, une base volée serait plus facile à casser. La troisième valeur chiffre les instructions SQL enregistrées dans le Control Plane. Générez-les avec la commande ci-dessous, lancée trois fois.
- Dans le bloc « Lokaler Schnellstart », activez les deux lignes JSON commentées (retirez le `# ` au début). Elles indiquent à QKERN où se trouve `project_database` et avec quels logins l'atteindre.
- Plus bas, passez les quatre interrupteurs à `true` : `QKERN_DATA_PLANE_ENABLED`, `QKERN_ALLOW_LOCAL_PROJECT_DATABASE_CATALOG`, `QKERN_GENERATED_DATA_API_ENABLED`, `QKERN_ALLOW_LOCAL_PROJECT_DATA_API_CATALOG`. Ils sont désactivés exprès, pour que personne n'ouvre une base de données par mégarde.

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Ce qui s'est passé : vous avez dit à QKERN où se trouvent ses bases de données et avec quoi il protège les mots de passe. Le fichier `.env.local` reste chez vous ; il figure dans `.gitignore` et ne va jamais dans un dépôt.

## 3. Démarrer QKERN

Pourquoi : `npm ci` récupère les bibliothèques dont QKERN a besoin, exactement dans les versions du fichier de verrouillage. `npm run dev` démarre le programme en mode développement, où les modifications du code sont visibles tout de suite.

```powershell
npm ci
npm run dev
```

Ce qui s'est passé : une ligne avec `Ready` et `http://localhost:3000`. `localhost` est votre propre ordinateur, `3000` le [port](GLOSSAR.md#port) sur lequel QKERN écoute. Ouvrez la page dans le navigateur : c'est la page d'accueil de QKERN. Le terminal reste ouvert tant que QKERN tourne ; les commandes suivantes vont dans un deuxième terminal ouvert dans le même dossier.

## 4. S'inscrire

Pourquoi : la [Console](GLOSSAR.md#console) est l'interface avec laquelle vous pilotez QKERN. Elle demande un compte, pour qu'on sache plus tard qui a modifié quoi.

Cliquez sur « Créer un projet » ou ouvrez `http://localhost:3000/register`. Saisissez une adresse e-mail et un mot de passe d'au moins douze caractères. L'adresse n'a pas besoin d'être réelle ; en local, QKERN n'envoie aucun mail.

Ce qui s'est passé : QKERN a créé votre compte, ainsi qu'une [organisation](GLOSSAR.md#organisation) (votre espace de travail) et un [projet](GLOSSAR.md#projet) nommé « First Project ». Un projet est une app : il a ses propres données, ses propres utilisateurs, ses propres clés. Chaque projet a trois [environnements](GLOSSAR.md#environnement), development, staging et production, pour que vous puissiez essayer des choses sans toucher aux vraies données.

Ouvrez « Paramètres » en bas à gauche, puis « Général » : vous y trouvez l'ID du projet et l'ID de l'organisation. Vous en aurez besoin tout de suite ; copiez-les quelque part.

## 5. Lier l'environnement à la base de données

Pourquoi : un projet tout neuf ne sait pas encore où se trouve sa base de données. En production, un [provisionneur](GLOSSAR.md#provisionneur) crée un serveur de base de données et inscrit la connexion. En local, il n'y en a pas ; un script fait exactement cette seule inscription.

```powershell
npm run dev:bind-project-database -- <projekt-id> development <organisations-id>
```

Ce qui s'est passé : `Gebunden: development von <projekt-id> an managed:database-1`. `managed:database-1` est le nom sous lequel votre `.env.local` connaît la base de projet. Le script se connecte avec le login du provisionneur et ne modifie qu'une ligne, et seulement tant que l'environnement est en attente. Un deuxième appel se termine par « Keine wartende Umgebung gefunden » (aucun environnement en attente), et c'est normal : un environnement lié ne peut pas être redirigé.

L'ID de l'organisation est nécessaire parce que, sans elle, la [Row Level Security](GLOSSAR.md#row-level-security) ne montre aucune ligne au provisionneur. C'est la même protection qui séparera plus tard vos utilisateurs les uns des autres, et elle vaut aussi pour QKERN lui-même.

## 6. Créer une table

Pourquoi : les données se trouvent dans des [tables](GLOSSAR.md#table), avec des [colonnes](GLOSSAR.md#colonne) pour les champs et des [lignes](GLOSSAR.md#ligne) pour les entrées. Nous construisons une table pour des notes. Pour cela, vous parlez directement à PostgreSQL dans sa langue, le [SQL](GLOSSAR.md#sql).

```powershell
docker compose exec postgres psql -U qkern -d project_database
```

Puis créez la table :

```sql
SET ROLE qkern_ledger_owner;
CREATE TABLE public.notes (id serial PRIMARY KEY, title text NOT NULL, done boolean NOT NULL DEFAULT false);
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY notes_read_all ON public.notes FOR SELECT USING (true);
CREATE POLICY notes_write_anon ON public.notes FOR INSERT WITH CHECK (true);
INSERT INTO public.notes (title) VALUES ('Erste Notiz');
```

Ce qui s'est passé, ligne par ligne :

- `SET ROLE qkern_ledger_owner` : à partir de maintenant, vous travaillez en tant que propriétaire de toutes les tables, le [propriétaire du registre](GLOSSAR.md#proprietaire-du-registre). Il ne peut pas se connecter lui-même, comme en production ; d'où le détour par `SET ROLE`.
- `CREATE TABLE` : la table `notes` avec un numéro comme [clé primaire](GLOSSAR.md#cle-primaire), un titre et une case à cocher.
- `ENABLE ROW LEVEL SECURITY` : désormais, la base décide pour chaque ligne qui peut la voir. Sans cette ligne, QKERN ne publie même pas la table dans l'API.
- Les deux `CREATE POLICY` : les [règles](GLOSSAR.md#policy). Tout le monde peut lire, tout le monde peut insérer. Pour une vraie app, vous écririez ici « seulement le propriétaire de la ligne ».
- `INSERT` : la première ligne.

Avec `\q`, vous quittez psql.

## 7. Obtenir une clé de projet

Pourquoi : quiconque parle à la base de données via l'API doit s'identifier. Une [clé API](GLOSSAR.md#cle-api) est un long secret que QKERN associe à un projet.

Dans la Console, ouvrez « API » et, sous « Clés API du projet », cliquez sur « Clé publique ». Le navigateur demande un nom ; `demo` suffit. La clé s'affiche une seule fois avec la mention « Copiez maintenant, affichée une seule fois » ; QKERN n'en garde qu'une somme de contrôle. Copiez-la dans une variable d'environnement du deuxième terminal :

```powershell
$env:QKERN_PUBLIC_KEY = "<hier den Key einsetzen>"
```

Ce qui s'est passé : vous avez une [clé publique](GLOSSAR.md#cle-publique). « Publique » veut dire qu'elle peut se trouver dans un frontend, où tout le monde peut la voir, car elle ne peut faire que ce que la Row Level Security permet à un anonyme. Nos deux règles ci-dessus autorisent la lecture et l'insertion. Une [clé de service](GLOSSAR.md#cle-de-service) est prévue pour les serveurs ; chez QKERN, elle non plus ne contourne pas les règles.

## 8. Lire via REST

Pourquoi : c'est le chemin que prendra plus tard votre frontend. Une requête HTTP vers une adresse, la clé dans l'en-tête, du JSON en retour.

```powershell
$headers = @{ Authorization = "Bearer $env:QKERN_PUBLIC_KEY" }
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/projects/<projekt-id>/environments/development/tables/notes/rows?limit=10" -Headers $headers | ConvertTo-Json -Depth 5
```

Ce qui s'est passé : une réponse avec `data`, qui contient `rows` avec exactement une ligne, et `title` vaut `Erste Notiz`. Lisez l'adresse de gauche à droite : projet, environnement, table, lignes. La même adresse avec `select=id,title` ne renvoie que ces deux colonnes ; `filter=done:eq:false` filtre. QKERN construit cette [Data API](GLOSSAR.md#data-api) à partir du contenu de la base ; vous n'écrivez aucun code pour cela.

## 9. Lire avec le SDK

Pourquoi : dans une vraie app, vous ne voulez pas assembler des adresses à la main. Le [SDK](GLOSSAR.md#sdk) est une bibliothèque qui le fait pour vous et vous donne des types pour vos tables.

Dans un dossier vide, en dehors du dossier source :

```powershell
mkdir qkern-demo; cd qkern-demo; npm init -y; npm install @qkern/sdk@alpha
```

Créez le fichier `demo.mjs` :

```js
import { createQkernClient } from "@qkern/sdk";
const qkern = createQkernClient({ baseUrl: "http://localhost:3000", projectId: "<projekt-id>", environment: "development", projectKey: process.env.QKERN_PUBLIC_KEY });
const result = await qkern.from("notes").select({ limit: 10 });
console.log(result.rows);
```

Puis exécutez-le :

```powershell
node demo.mjs
```

Ce qui s'est passé : un tableau avec un objet, `title: 'Erste Notiz'`. Le SDK a envoyé la même requête que vous à l'étape 8, mais avec la clé dans l'en-tête `x-qkern-key` ; elle n'apparaît jamais dans une URL, où elle pourrait finir dans des journaux.

## 10. Voir dans le Table Editor

Pourquoi : la Console montre les mêmes données par la même API, avec les mêmes règles ; il n'y a pas de porte dérobée.

De retour dans la Console, ouvrez « Table Editor » et choisissez `public.notes`. La ligne est là, et « Insérer une ligne » en ajoute une deuxième.

Vous avez maintenant QKERN en local, un projet avec une base liée, une table avec Row Level Security, une clé, et la ligne lue par trois chemins.

## La suite

- Des utilisateurs pour votre app : [Auth](GLOSSAR.md#auth) dans le manuel, section 6. Un utilisateur connecté reçoit un [JWT](GLOSSAR.md#jwt), et vos règles peuvent dire « seulement le propriétaire de la ligne ».
- Fichiers : [Storage](GLOSSAR.md#storage) dans le manuel, section 7. Les buckets sont privés, les fichiers envoyés sont contrôlés contre les virus.
- Mises à jour en direct : [Realtime](GLOSSAR.md#realtime) dans le manuel, section 8.
- Tâches en arrière-plan : [Queues](GLOSSAR.md#file-d-attente), Cron et webhooks dans le manuel, sections 9 à 9b.

Le manuel se trouve dans le dépôt sous `docs/HANDBUCH.md`.

## En toute franchise

- Dernier passage mesuré du même chemin : 26 septembre 2026, 31 minutes d'affilée, dont environ sept minutes de commandes pures ; détails sous `docs/evidence/2026-09-26/`.
- La liaison de l'étape 5 est faite par un script et non par un provisionneur. Il n'exécute que cet UPDATE et ne crée aucune tâche.
- La table est créée en SQL, pas avec un assistant. Le chemin par Change Set et centre d'approbation demande le worker de migration avec son catalogue de connexions, et celui-ci n'est pas configuré dans le démarrage rapide local.
- Les deux règles de l'étape 6 permettent tout à tout le monde. Pour une vraie app, elles sont trop larges ; le manuel montre des règles par utilisateur.
