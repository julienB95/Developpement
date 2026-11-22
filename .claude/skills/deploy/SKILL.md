---
name: deploy
description: Deploie l'application crypto - "web" met a jour l'API et le site sur le NAS, "mobile" compile, signe et installe l'APK Android, "*" fait le web puis le mobile
argument-hint: web | mobile | *
arguments: [cible]
disable-model-invocation: true
shell: powershell
allowed-tools: Bash, PowerShell, Read, AskUserQuestion
---

## Etat local

```!
git status --short
```

```!
git log --oneline -3
```

```!
git status --branch --porcelain=v2 | Select-String "^# branch.ab"
```

## Cible demandee : $cible

Selon la cible, lis puis suis exactement l'une de ces procedures :

- `web` : [web.md](web.md) - API et site web, deployes ensemble sur le NAS (Docker)
- `mobile` : [mobile.md](mobile.md) - application Android, compilee en APK signe

Les deux sont independantes : un deploiement web ne republie jamais l'application,
et une publication mobile ne touche jamais au NAS.

- `*` : les deux a la suite, toujours dans cet ordre, car l'application depend de l'API :
  1. suis entierement [web.md](web.md) ;
  2. si le web s'est arrete (refus, echec de la mise a jour, sante differente de 200),
     ne lance pas le mobile : resume l'echec et arrete-toi ;
  3. sinon, suis entierement [mobile.md](mobile.md). Son controle de l'API compare alors
     le NAS a `HEAD`, qui vient d'etre deploye ;
  4. termine par un seul resume reprenant le web puis le mobile.

Si la cible est vide ou differente de `web`, `mobile` et `*`, ne deploie rien : demande
laquelle est voulue.

Regles communes :

- Ne commit jamais de ta propre initiative, meme pour un simple changement de version
- Les valeurs du `.env` ne sont jamais affichees dans tes reponses
- Resume a la fin en quelques lignes et signale toute anomalie sans la corriger
  tant que je ne l'ai pas demande
