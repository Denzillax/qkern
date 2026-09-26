# Pour les fondateurs

> Pour les personnes qui font construire un produit et veulent savoir quel rôle QKERN y joue. Pas de ligne de commande, pas de code. Quand un terme technique est nécessaire, il renvoie au [glossaire](GLOSSAR.md).

## Ce que QKERN signifie pour votre produit

Chaque app a une partie visible et une partie invisible. La partie visible est l'interface que vos clients utilisent. La partie invisible est le [backend](GLOSSAR.md#backend) : c'est là que se trouvent les données, que les comptes sont créés, que les fichiers sont rangés et que les droits sont vérifiés. D'habitude, les développeurs reconstruisent cette partie invisible pour chaque produit, et elle prend en général la moitié du temps.

QKERN est cette partie invisible, déjà faite. [Base de données](GLOSSAR.md#base-de-donnees), connexion, fichiers, mises à jour en direct, tâches en arrière-plan, avec une interface, la [Console](GLOSSAR.md#console), où l'on voit ce qui se passe. Votre développeur construit l'interface de votre produit et la relie à QKERN, au lieu de couler lui-même les fondations.

La comparaison que les développeurs connaissent : QKERN fait ce que fait Supabase. La différence tient à la façon dont il est testé ; plus de détails ci-dessous.

## Ce que l'on peut faire construire avec

Trois exemples, tous avec les mêmes briques :

- **Une app de réservation.** Les clients créent un compte (connexion), voient les créneaux libres (base de données), réservent (base de données, plus des règles sur qui peut voir quelle réservation), reçoivent une confirmation (tâche en arrière-plan), et un calendrier au bureau affiche aussitôt les nouvelles réservations (mises à jour en direct).
- **Un espace membres.** Les membres payants se connectent, envoient des documents (fichiers avec contrôle antivirus) et ne voient que les leurs ; un administrateur voit tout. La règle « seulement les siens » est inscrite dans la base de données elle-même, et non quelque part dans le code où on pourrait l'oublier.
- **Une gestion interne.** Les employés tiennent à jour clients et commandes dans des tables que la Console affiche directement. Pour commencer, l'éditeur de tables intégré suffit ; l'interface sur mesure vient quand on sait ce qu'il faut.

Ce que QKERN n'est pas : un outil avec lequel vous assemblez vous-même une app en quelques clics, sans développeur. C'est l'outil du développeur.

## Ce que cela coûte

Le logiciel est gratuit. QKERN est [open source](GLOSSAR.md#open-source) sous [licence Apache 2.0](GLOSSAR.md#apache-2-0) : libre d'utilisation, y compris à des fins commerciales, sans frais de licence et sans obligation de publier votre propre code.

Ce qui coûte, ce sont deux choses :

- **L'exploitation.** QKERN doit tourner quelque part, sur un serveur loué ou dans un cloud. Les coûts dépendent de la taille et du fournisseur et commencent à quelques dizaines de francs par mois. Il n'existe aujourd'hui aucune offre pour louer QKERN hébergé. C'est prévu, mais pas encore là.
- **Le temps de développement.** L'interface de votre produit et la liaison avec QKERN. Ce temps est plus court que sans QKERN, mais il n'est pas nul.

## Où se trouvent les données

Là où QKERN tourne. QKERN n'envoie aucune donnée ni à nous ni à des tiers ; aucun service central ne voit passer quoi que ce soit. Si QKERN tourne sur un serveur à Zurich, les données sont à Zurich.

QKERN est développé en Suisse. Il n'existe aujourd'hui aucune attestation vérifiée sur l'emplacement des données ou l'hébergement, parce qu'il n'y a pas d'offre d'hébergement. Si vous avez besoin d'une déclaration sur la protection des données ou l'emplacement, elle vient de l'exploitant du serveur, pas de QKERN.

## Ce que « certifié » veut dire ici

Sur la page d'accueil et dans cette documentation figurent des chiffres comme « {{postgresCases}} cas réussis ». Cela signifie :

- Chaque brique est testée contre de vrais services, jamais contre des imitations. Un vrai [PostgreSQL](GLOSSAR.md#postgresql), un vrai stockage de fichiers, un vrai serveur de mail. Aujourd'hui, cela fait {{stackCount}} bancs d'essai de ce type.
- Les tests tournent automatiquement à chaque modification, et les rapports, avec date et résultat, se trouvent dans le dépôt, l'endroit où le code source est géré.
- Les chiffres de la page d'accueil sont lus dans ces rapports. S'il y est écrit {{postgresCases}}, un fichier dit {{postgresCases}}. Un test empêche qu'on y inscrive un chiffre à la main.
- Il y a aussi un contre-test : on introduit exprès une erreur et on vérifie que les tests la trouvent. Un test qui reste vert face à une erreur introduite ne vaut rien.

Ce que cela ne veut pas dire : aucune certification par une autorité ou un organisme de contrôle, aucun label de qualité, aucune responsabilité. Ici, « certifié » veut dire « prouvé contre de vrais services, et la preuve peut être consultée ».

## Ce qui manque aujourd'hui

QKERN se présente comme un Product MVP : les fondations sont en place, mais beaucoup de vues de la Console sont encore des espaces réservés, qui disent franchement ce qu'ils ne savent pas encore faire. Il n'y a pas d'offre d'hébergement, pas de facturation, pas de gestion d'équipe dans la Console. Qui construit aujourd'hui avec QKERN construit avec un outil qui évolue encore.

## Questions à poser à votre développeur

Sept questions pour mener une discussion sur le backend sans en construire un vous-même :

1. La [Row Level Security](GLOSSAR.md#row-level-security) est-elle activée sur chaque table, et que dit la règle pour un client qui n'est pas connecté ?
2. Quelles clés se trouvent dans l'app que les clients téléchargent, et qu'ont-elles le droit de faire ?
3. Qui peut approuver une modification de la base de données pour production, et où puis-je voir ensuite qui l'a fait ?
4. Où tournent les [sauvegardes](GLOSSAR.md#sauvegarde), jusqu'où peut-on revenir en arrière, et quand la restauration a-t-elle été essayée pour la dernière fois ?
5. De quels services QKERN a-t-il besoin en exploitation, et que se passe-t-il si l'un d'eux tombe en panne ?
6. Comment récupère-t-on les données si nous changeons d'outil ?
7. Parmi ce dont nous avons besoin, qu'est-ce qui n'est encore qu'un espace réservé chez QKERN ?

## En toute franchise

- Cette page décrit QKERN {{version}}, un Product MVP. Beaucoup de choses évoluent encore.
- Il n'y a ni offre d'hébergement ni attestation sur l'emplacement des données. Les deux sont prévues.
- Les coûts d'exploitation indiqués sont des ordres de grandeur, pas un devis.
- « Certifié » désigne des tests documentés, pas un contrôle par des tiers.
