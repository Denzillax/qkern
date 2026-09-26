# Démarrage rapide

> Pour les développeurs qui connaissent Supabase. Objectif : QKERN en local dans [Docker](GLOSSAR.md#docker), un [projet](GLOSSAR.md#projet), une [table](GLOSSAR.md#table), et une ligne lue via [REST](GLOSSAR.md#rest) et avec le [SDK](GLOSSAR.md#sdk). Les commandes prennent environ sept minutes, un quart d'heure avec la lecture et les clics. La section « En toute franchise » indique la durée du dernier passage mesuré.

## Ce qu'il vous faut

- [Node.js](GLOSSAR.md#node-js) {{node}} ou plus récent, avec [npm](GLOSSAR.md#npm)
- Docker Desktop, démarré
- Git, pour récupérer le code source
- PowerShell ou un Bash ; les exemples ici sont en PowerShell

Récupérez d'abord le code source. Toutes les commandes suivantes s'exécutent dans ce dossier, là où se trouve `package.json` :

```powershell
git clone https://github.com/Denzillax/qkern.git
cd qkern
```

## 1. Démarrer les services

```powershell
node --version
docker compose up -d
```

Résultat attendu : `v{{node}}` ou plus. Docker indique `postgres`, `redis`, `minio` et `clamav` comme démarrés, plus quatre courts conteneurs de contrôle qui s'arrêtent aussitôt. Au premier démarrage, PostgreSQL crée la base du [Control Plane](GLOSSAR.md#control-plane) et la base de projet `project_database` ; cela prend une demi-minute.

> La base de projet n'est créée que sur un volume neuf. Si vous avez déjà démarré QKERN, `docker compose down -v` efface toutes les données locales et vous repartez de zéro.

## 2. Configuration

```powershell
Copy-Item .env.example .env.local
```

Ouvrez `.env.local` et changez six choses :

- `QKERN_RUNTIME_MODE=postgres` est déjà réglé ainsi ; laissez-le.
- `QKERN_PASSWORD_PEPPER`, `QKERN_PROJECT_AUTH_PASSWORD_PEPPER` et `QKERN_STATEMENT_ENCRYPTION_KEY` : inscrivez une valeur aléatoire différente dans chacun. Générez-les avec la commande ci-dessous, lancée trois fois.
- Dans le bloc « Lokaler Schnellstart », activez les deux lignes JSON commentées (retirez le `# ` au début).
- Plus bas, passez les quatre interrupteurs à `true` : `QKERN_DATA_PLANE_ENABLED`, `QKERN_ALLOW_LOCAL_PROJECT_DATABASE_CATALOG`, `QKERN_GENERATED_DATA_API_ENABLED`, `QKERN_ALLOW_LOCAL_PROJECT_DATA_API_CATALOG`.

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Le fichier `.env.local` reste chez vous ; il figure dans `.gitignore` et ne va jamais dans un dépôt.

## 3. Démarrer QKERN

```powershell
npm ci
npm run dev
```

Résultat attendu : une ligne avec `Ready` et `http://localhost:3000`. Ouvrez la page dans le navigateur : c'est la page d'accueil de QKERN.

## 4. S'inscrire

Cliquez sur « Créer un projet » ou ouvrez `http://localhost:3000/register`. Saisissez une adresse e-mail et un mot de passe d'au moins douze caractères. L'adresse n'a pas besoin d'être réelle ; en local, QKERN n'envoie aucun mail.

Après l'inscription, vous arrivez dans la [Console](GLOSSAR.md#console). QKERN a créé pour vous une [organisation](GLOSSAR.md#organisation) et un projet nommé « First Project ». Ouvrez « Paramètres » en bas à gauche, puis « Général » : vous y trouvez l'ID du projet et l'ID de l'organisation. Vous en aurez besoin tout de suite ; copiez-les quelque part.

## 5. Lier l'environnement à la base de données

En production, un [provisionneur](GLOSSAR.md#provisionneur) relie chaque [environnement](GLOSSAR.md#environnement) à sa base de données. En local, il n'y en a pas. Un script fait exactement cette seule étape, dans un deuxième terminal ouvert dans le dossier source :

```powershell
npm run dev:bind-project-database -- <projekt-id> development <organisations-id>
```

Résultat attendu : `Gebunden: development von <projekt-id> an managed:database-1`. Le script se connecte avec le login du provisionneur et ne modifie qu'une ligne, et seulement tant que l'environnement est en attente. Un deuxième appel se termine par « Keine wartende Umgebung gefunden » (aucun environnement en attente), et c'est normal.

L'ID de l'organisation est nécessaire parce que, sans elle, la [Row Level Security](GLOSSAR.md#row-level-security) ne montre aucune ligne au provisionneur, exactement comme en production.

## 6. Créer une table

Ouvrez une session SQL dans la base de projet :

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

`SET ROLE` est nécessaire parce que le propriétaire de toutes les tables, le [propriétaire du registre](GLOSSAR.md#proprietaire-du-registre), ne peut pas se connecter lui-même, comme en production. La Data API travaille ensuite avec les droits de l'appelant, et sans Row Level Security, elle ne publie même pas la table. Avec `\q`, vous quittez psql.

## 7. Obtenir une clé de projet

Dans la Console, ouvrez « API » et, sous « Clés API du projet », cliquez sur « Clé publique ». Le navigateur demande un nom ; `demo` suffit. La clé s'affiche une seule fois avec la mention « Copiez maintenant, affichée une seule fois » ; QKERN n'en garde qu'une somme de contrôle. Copiez-la dans une variable d'environnement du deuxième terminal :

```powershell
$env:QKERN_PUBLIC_KEY = "<hier den Key einsetzen>"
```

Une [clé publique](GLOSSAR.md#cle-publique) ne peut faire que ce que la Row Level Security permet à un anonyme. Nos deux règles ci-dessus autorisent la lecture et l'insertion.

## 8. Lire via REST

```powershell
$headers = @{ Authorization = "Bearer $env:QKERN_PUBLIC_KEY" }
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/projects/<projekt-id>/environments/development/tables/notes/rows?limit=10" -Headers $headers | ConvertTo-Json -Depth 5
```

Résultat attendu : une réponse avec `data`, qui contient `rows` avec exactement une ligne, et `title` vaut `Erste Notiz`. La même adresse avec `select=id,title` ne renvoie que ces deux colonnes ; `filter=done:eq:false` filtre. Les règles de cette syntaxe sont décrites sous [Data API](GLOSSAR.md#data-api).

## 9. Lire avec le SDK

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

Résultat attendu : un tableau avec un objet, `title: 'Erste Notiz'`. Le SDK envoie la clé dans l'en-tête `x-qkern-key` ; elle n'apparaît jamais dans une URL.

## 10. Voir dans le Table Editor

De retour dans la Console, ouvrez « Table Editor » et choisissez `public.notes`. La ligne est là, et « Insérer une ligne » en ajoute une deuxième. Le Table Editor parle à la même Data API que votre script, avec les mêmes règles.

Vous avez maintenant QKERN en local, un projet avec une base liée, une table avec Row Level Security, une clé, et la ligne lue par trois chemins.

## Supabase et QKERN

| Chez Supabase | Chez QKERN |
| --- | --- |
| Studio | Console |
| Anon Key | Clé publique ; la Row Level Security s'applique |
| Service Role Key | Clé de service ; la Row Level Security s'applique aussi |
| PostgREST | Data API |
| GoTrue | Project Auth |
| Storage | Project Storage, privé, avec contrôle antivirus |
| Realtime | Realtime |
| Edge Functions | Functions dans des conteneurs |
| supabase-js | @qkern/sdk |
| Supabase CLI | @qkern/cli |
| Migrations | Change Sets avec centre d'approbation |
| SQL du tableau de bord | SQL Editor, en lecture ; ce qui écrit devient un Change Set |

La plus grande différence au quotidien : chez QKERN, même la clé de service ne contourne pas la Row Level Security. Si quelqu'un doit tout voir, il reçoit une règle qui le dit.

## En toute franchise

- Dernier passage mesuré : 26 septembre 2026, dossier neuf, 31 minutes d'affilée. Environ 24 minutes sont parties dans deux erreurs de texte, trouvées et corrigées en route, et dans un détour par un deuxième compte ; les commandes elles-mêmes ont tourné en sept minutes environ. Journal et manifeste sous `docs/evidence/2026-09-26/`.
- La liaison de l'étape 5 est faite par un script et non par un provisionneur. Il n'exécute que cet UPDATE et ne crée aucune tâche.
- La table est créée en SQL, pas avec un assistant. Le chemin par Change Set et centre d'approbation demande le worker de migration avec son catalogue de connexions, et celui-ci n'est pas configuré dans le démarrage rapide local.
- La clé de service ne contourne pas la Row Level Security, même si son nom le laisse penser.
