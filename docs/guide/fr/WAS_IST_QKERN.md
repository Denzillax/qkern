# Qu'est-ce que QKERN

QKERN est un [backend](GLOSSAR.md#backend) que vous n'avez pas besoin de construire vous-même. Une app a presque toujours besoin des mêmes choses en arrière-plan : une [base de données](GLOSSAR.md#base-de-donnees) pour les données, une connexion pour les utilisateurs, un endroit pour les fichiers, des mises à jour en direct pour ceux qui regardent, et des tâches qui tournent en arrière-plan. QKERN fournit ces parties, déjà reliées entre elles, et vous les pilotez depuis une interface web, la [Console](GLOSSAR.md#console).

Il tourne là où vous l'installez : sur votre ordinateur dans [Docker](GLOSSAR.md#docker), plus tard chez l'hébergeur de votre choix. QKERN est [open source](GLOSSAR.md#open-source) sous licence [Apache 2.0](GLOSSAR.md#apache-2-0). Le logiciel est gratuit ; ce qui coûte, c'est l'hébergement et le travail qu'une app demande.

Ce que QKERN n'est pas : ni un outil pour construire des sites web, ni un produit fini pour les clients finaux, ni une offre d'hébergement. QKERN est la fondation sur laquelle un développeur construit une app.

## Pourquoi QKERN existe

Si vous connaissez Supabase, vous connaissez l'idée : un Postgres avec tout ce qu'il faut autour. QKERN suit le même chemin, avec une différence qui compte pour nous. Chaque brique est testée contre de vrais services, jamais contre des imitations. Un vrai [PostgreSQL](GLOSSAR.md#postgresql) 17, un vrai stockage d'objets, un vrai serveur de mail, un vrai fournisseur d'identité. Les rapports de test se trouvent dans le dépôt, avec date, commit et résultat, et les chiffres de la page d'accueil viennent de ces rapports.

Aujourd'hui, cela fait {{postgresCases}} cas contre PostgreSQL 17 et {{stackCount}} bancs d'essai au total. Quand un chiffre figure dans cette documentation, il vient d'un fichier, pas de la mémoire de quelqu'un.

## Les briques

| Brique | Ce qu'elle fait | Dans la Console |
| --- | --- | --- |
| [Console](GLOSSAR.md#console) | L'interface web où vous voyez et réglez tout | Tout |
| [Organisation](GLOSSAR.md#organisation) | Votre espace de travail ; tout appartient à une organisation | En-tête |
| [Projet](GLOSSAR.md#projet) | Une app avec ses propres données, utilisateurs et clés | Choix du projet en haut à gauche |
| [Environnement](GLOSSAR.md#environnement) | development, staging, production ; chacun a sa propre base de données | Choix de l'environnement en haut à droite |
| [Base de données](GLOSSAR.md#base-de-donnees) | PostgreSQL 17 avec tables, règles et tout ce qui va avec | Base de données, Table Editor, SQL Editor |
| [Data API](GLOSSAR.md#data-api) | Lire et écrire via [REST](GLOSSAR.md#rest), avec les droits de l'appelant | API |
| [Auth](GLOSSAR.md#auth) | La connexion des utilisateurs de votre app, avec mot de passe, fournisseurs et multifacteur | Auth |
| [Storage](GLOSSAR.md#storage) | Des fichiers dans des [buckets](GLOSSAR.md#bucket), privés, avec contrôle antivirus | Stockage |
| [Realtime](GLOSSAR.md#realtime) | Les modifications envoyées en direct à tous ceux qui regardent | Temps réel |
| [Queues](GLOSSAR.md#file-d-attente) | Des tâches qu'un [worker](GLOSSAR.md#worker) traite plus tard | Intégrations, Files |
| [Cron](GLOSSAR.md#cron) et [webhooks](GLOSSAR.md#webhook) | Des tâches planifiées et des messages vers d'autres services | Fonctions & tâches |
| [Centre d'approbation](GLOSSAR.md#centre-d-approbation) | Chaque modification du schéma est vérifiée avant de s'exécuter | Centre de validation |
| [AI Bridge](GLOSSAR.md#ai-bridge) | Un agent IA prépare des modifications, des personnes les approuvent | AI Bridge |

## Comment les parties s'assemblent

La Console parle avec le [Control Plane](GLOSSAR.md#control-plane). C'est la partie de QKERN qui gère les organisations, les projets, les utilisateurs et les approbations. Chaque projet a une base de données propre pour chaque environnement, le [Data Plane](GLOSSAR.md#data-plane). C'est là que se trouvent les données de votre app. La Data API lit et écrit dans cette base avec les droits de celui qui fait la demande : une [clé publique](GLOSSAR.md#cle-publique) ne voit que ce que la [Row Level Security](GLOSSAR.md#row-level-security) permet à un anonyme, un utilisateur connecté voit ses propres lignes.

Une modification de la structure de la base, par exemple une nouvelle table, ne passe pas directement. Elle devient un [Change Set](GLOSSAR.md#change-set), arrive dans le centre d'approbation, et QKERN ne l'exécute qu'après approbation. Pour production, il faut en plus une signature externe. C'est volontairement plus lent qu'un SQL direct, et c'est ce qui permet de retracer chaque modification.

## Trois portes

- Je connais Supabase et je veux voir quelque chose en un quart d'heure : [Démarrage rapide](SCHNELLSTART.md)
- Je construis mon premier backend et je veux comprendre ce que je fais : [Premier backend](ERSTES_BACKEND.md)
- Je ne suis pas développeur et je veux savoir ce que cela signifie pour mon produit : [Pour les fondateurs](FUER_GRUENDER.md)

Les termes que vous croiserez en chemin sont expliqués dans le [glossaire](GLOSSAR.md), chacun en trois lignes.

## En toute franchise

- Cette documentation vaut pour QKERN {{version}}. QKERN est un Product MVP, pas une offre d'hébergement finie.
- Il n'existe aucun fournisseur chez qui obtenir QKERN en un clic. Vous l'exploitez vous-même ou vous le faites exploiter.
- Aujourd'hui, vous créez une nouvelle table en SQL, pas avec un assistant dans la Console.
- En production, c'est un provisionneur qui relie un projet à sa base de données. En local, un petit script s'en charge, et le démarrage rapide le montre.
- Ces pages existent en allemand, en anglais, en français et en italien. La version allemande est l'original ; en cas de divergence, c'est elle qui fait foi.
