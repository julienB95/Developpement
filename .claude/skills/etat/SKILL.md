---
name: etat
description: Fait le point sur l'application crypto - serveur PM2, base PostgreSQL du NAS, et fichiers modifies non commites
disable-model-invocation: true
shell: powershell
allowed-tools: Bash, PowerShell, Read
---

## Etat du serveur

```!
pm2 list
```

## Fichiers modifies

```!
git status --short
```

## Instructions

A partir de ce qui precede :

1. Verifie que la base du NAS repond, avec une requete de controle
2. Resume en quelques lignes : le serveur tourne-t-il, la base est-elle joignable,
   et quels fichiers restent a commiter
3. Signale toute anomalie, sans proposer de correction tant que je ne l'ai pas demandee
