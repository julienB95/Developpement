# Instructions pour l'Agent IA - Règles générales

Ces règles s'appliquent à **toutes** les applications du dépôt.
Chaque application possède son propre `CLAUDE.md` (ex. `application/crypto/CLAUDE.md`)
qui complète ce fichier avec ses règles spécifiques.

## Communication

- Ne génère jamais de phrases d'explication avant ou après le code, fournis uniquement les blocs modifiés
- Toute la communication, les commentaires et les libellés d'interface sont en français
- Ne crée pas de fichier de documentation (README, notes, résumés) sans demande explicite

## Organisation du dépôt

```
application/
├── commun/          ressources partagées par TOUTES les applications
│   └── image/
└── <application>/   une application par dossier (ex. crypto)
    ├── api/         backend et services
    ├── commun/      ressources partagées par CETTE application uniquement
    │   └── image/
    ├── web/         interface web
    ├── mobile/      interface mobile
    └── CLAUDE.md    règles propres à l'application
```

- Une ressource utilisée par plusieurs applications va dans `application/commun/`
- Une ressource utilisée par une seule application reste dans le `commun/` de cette application
- Ne crée jamais de dossier ou de fichier en dehors de cette arborescence sans demande explicite
- Les noms de dossiers et de fichiers sont en minuscules, sans accents ni espaces

## Technique

- Node.js en CommonJS (`require` / `module.exports`), pas d'ESM
- N'ajoute aucune dépendance npm sans demande explicite ; privilégie les modules natifs de Node
- Toutes les réponses d'API sont en JSON avec le bon code HTTP (200, 201, 400, 404, 500)
- Les requêtes SQL utilisent toujours des paramètres liés (`?` en SQLite, `$1` en PostgreSQL), jamais de concaténation de chaînes
- Les erreurs sont toujours traitées : aucun `catch` vide, aucune erreur silencieuse

## Sécurité

- Aucun secret, mot de passe, clé d'API ou jeton en dur dans le code : uniquement via `.env`
- `.env`, `node_modules/` et les bases de données locales ne sont jamais versionnés
- Aucune donnée personnelle réelle dans les jeux de données de test

## Git

- Ne commit et ne push jamais sans demande explicite
- Messages de commit en français, à l'impératif, décrivant le changement réel
