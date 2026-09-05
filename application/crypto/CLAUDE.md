# Instructions pour l'Agent IA - Application Crypto

Complète les règles générales de `CLAUDE.md` à la racine. En cas de conflit, ce fichier prévaut
pour tout ce qui se trouve dans `application/crypto/`.

## Périmètre

- Ne modifie aucun fichier hors de `application/crypto/`, sauf `application/commun/`
  si la ressource est réellement partagée avec une autre application
- Les ressources propres à l'application (images, styles, libellés) vont dans
  `application/crypto/commun/`, jamais dupliquées entre `web/` et `mobile/`

## Structure

- `api/` : backend, accès aux données et appels aux services externes
- `web/` : interface web
- `mobile/` : interface mobile
- `commun/` : ressources partagées entre `web/` et `mobile/`

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
- La connexion passe uniquement par `api/db.js` (pool `pg`) ; aucun autre fichier n'ouvre de connexion
- Les paramètres de connexion viennent de `.env` (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`)
- Toute évolution du schéma se fait dans `api/schema.sql`, appliqué par `npm run crypto:migrer`
- `schema.sql` doit rester idempotent (`CREATE ... IF NOT EXISTS`, `CREATE OR REPLACE VIEW`)
- Les montants et quantités sont en `NUMERIC(38, 18)`, jamais en `REAL` ni `DOUBLE PRECISION`
- Les horodatages sont en `TIMESTAMPTZ`
- Les positions sont calculées depuis la vue `position` : aucun solde dénormalisé en table
