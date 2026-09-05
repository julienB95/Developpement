# Instructions pour l'Agent IA - Application Crypto

Complète les règles générales de `CLAUDE.md` à la racine. En cas de conflit, ce fichier prévaut
pour tout ce qui se trouve dans `application/crypto/`.

## Périmètre

- Ne modifie aucun fichier hors de `application/crypto/`, sauf `application/_commun/`
  si la ressource est réellement partagée avec une autre application
- Les ressources propres à l'application (images, styles, libellés) vont dans
  `application/crypto/_commun/`, jamais dupliquées entre `web/` et `mobile/`

## Structure

- `api/` : API unique du projet, consommée par `web/` et `mobile/` ; accès aux données et appels aux services externes
- `web/` : interface web
- `mobile/` : interface mobile
- `_commun/` : ressources partagées entre `web/` et `mobile/` (images, styles, libellés), pas de code serveur

## Règles métier

- Les appels aux plateformes d'échange et aux fournisseurs de cours passent uniquement par `api/`,
  jamais directement depuis `web/` ni `mobile/`
- Les clés d'API des plateformes d'échange restent côté `api/`, chargées depuis `.env`,
  et ne sont jamais renvoyées au client
- Les montants et quantités de crypto-actifs ne sont jamais stockés ni calculés en nombre flottant :
  utiliser des entiers en plus petite unité ou des chaînes décimales
- Aucun arrondi lors des calculs intermédiaires ; l'arrondi n'a lieu qu'à l'affichage
- Toute valeur monétaire est affichée avec sa devise ou son symbole d'actif (BTC, ETH, EUR...)
- Les dates et heures sont stockées en UTC (ISO 8601) et converties uniquement à l'affichage
- Les cours étant volatils, toute donnée de marché affichée indique son horodatage
- Aucune fonctionnalité d'exécution d'ordre réel sans demande explicite : par défaut, lecture seule

## Base de données

- PostgreSQL hébergé sur le NAS Synology ; aucune donnée crypto en SQLite
- La connexion passe uniquement par `application/_commun/api/db.js` (pool `pg`) ; aucun autre fichier n'ouvre de connexion
- Les paramètres de connexion viennent de `.env` (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`)
- Toute évolution du schéma se fait dans `api/schema.sql`, appliqué par `npm run crypto:migrer`
- `schema.sql` doit rester idempotent (`CREATE ... IF NOT EXISTS`, `CREATE OR REPLACE VIEW`)
- Les montants et quantités sont en `NUMERIC(38, 18)`, jamais en `REAL` ni `DOUBLE PRECISION`
- Les horodatages sont en `TIMESTAMPTZ`
- Les positions sont calculées depuis la vue `position` : aucun solde dénormalisé en table

## Comptes utilisateurs

- Aucun mot de passe en clair, ni en base, ni dans les journaux, ni dans une réponse d'API
- Le hachage passe exclusivement par `application/_commun/api/motdepasse.js` (scrypt, module natif de Node)
- Les colonnes `mot_de_passe_hash` et `google_sub` ne sont jamais renvoyées par une route
- Les courriels sont normalisés en minuscules avant toute écriture ou recherche
- Un compte désactivé (`est_actif = false`) est refusé à la connexion, jamais supprimé
- La connexion Google s'appuie sur le claim `sub` du jeton, jamais sur l'adresse de courriel

## Interface web

- HTML, CSS et JavaScript natifs : aucun framework, aucun outil de compilation
- Les fichiers de `web/` sont servis par `api/serveur.js`, donc sur la même origine que l'API :
  aucune configuration CORS n'est nécessaire
- Le jeton de session est conservé dans `localStorage`, chaque accès protégé par `try/catch`
- Aucun texte inséré avec `innerHTML` : uniquement `textContent` et `createElement`
- Le seul script externe autorisé est celui de Google Identity Services

## Administration

- Le droit d'administration est porté par la colonne `est_admin` de la table `utilisateur`
- Toute route sous `/api/crypto/administration/` vérifie `est_admin` côté serveur ;
  masquer un bouton dans l'interface ne protège rien
- Un administrateur ne peut ni se retirer son propre droit, ni se désactiver lui-même :
  cela éviterait un verrouillage complet de l'application
- Le dernier administrateur actif ne peut pas être rétrogradé
- La désactivation d'un compte ferme immédiatement toutes ses sessions
- Le premier administrateur est désigné en ligne de commande : `npm run crypto:admin -- <courriel>`

## Sources externes

- Cours : CoinGecko, offre gratuite, sans clé d'API — module `api/marche.js`
- Actualités : flux RSS publics (Journal du Coin, CoinDesk, Cointelegraph) — module `api/actualites.js`
- Chaque source est mise en cache en mémoire (2 min pour les cours, 10 min pour les actualités) :
  jamais d'appel externe déclenché par chaque visiteur
- Tout appel sortant a un délai d'attente maximal ; en cas d'échec, la dernière valeur connue
  est servie plutôt qu'une erreur, avec `provenance` à `cache_perime`
- Une source d'actualités en échec ne prive pas le site des autres
- Les routes `/api/crypto/marche/cours` et `/api/crypto/actualites` sont publiques,
  et servent aussi bien le site web que l'application mobile
- Les cours de marché servent à la valorisation et à l'affichage, jamais au calcul
  des plus-values : seuls les prix réels des opérations comptent pour la déclaration
