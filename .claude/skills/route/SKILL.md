---
name: route
description: Ajoute une route a l'API crypto en respectant les regles du projet
argument-hint: [methode] [chemin] [ce que fait la route]
arguments: [methode, chemin, objectif]
disable-model-invocation: true
---

Ajoute une route `$methode $chemin` a l'API crypto.

Objectif de la route : $objectif

Respecte les regles de @CLAUDE.md et de @application/crypto/CLAUDE.md, en particulier :

- Reponse JSON avec le bon code HTTP
- Requetes SQL a parametres lies, jamais de concatenation
- Aucune erreur silencieuse
- Montants en chaine decimale, jamais en flottant
- Ni empreinte de mot de passe ni identifiant Google dans une reponse
- Si la route touche a l'administration, verification de `est_admin` cote serveur

Ensuite :

1. Ajoute la route dans @application/crypto/api/serveur.js, dans la section qui lui correspond
2. Si le schema evolue, modifie @application/crypto/api/schema.sql en gardant le fichier
   rejouable, puis applique la migration
3. Ecris un court test et execute-le
4. Ne commit pas
