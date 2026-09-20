---
name: deploy
description: Deploie la version courante du site crypto sur le NAS - pousse le depot, met a jour le clone du NAS, reconstruit le conteneur et controle la sante du site
disable-model-invocation: true
shell: powershell
allowed-tools: Bash, PowerShell, Read
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

## Instructions

Deploie la version courante sur le NAS. Les parametres de connexion sont dans le `.env`
de la racine : `NAS_HOTE`, `NAS_UTILISATEUR`, `NAS_PORT_SSH`, `NAS_CHEMIN`.
Ne les affiche pas dans tes reponses et ne lis aucune autre variable du `.env`.

1. **Refuse de deployer** si `git status --short` n'est pas vide : signale les fichiers
   concernes et arrete-toi. Ne commit jamais de ta propre initiative.

2. Si la branche est en avance sur `origin`, pousse-la (`git push`). Le NAS deploie
   depuis GitHub : sans push, il redeploierait l'ancienne version.

3. Mets a jour et reconstruis sur le NAS, en une seule connexion :

   ```
   ssh -p <NAS_PORT_SSH> <NAS_UTILISATEUR>@<NAS_HOTE> "cd <NAS_CHEMIN> && git pull --ff-only && cd application/crypto && sudo docker compose up -d --build && sudo docker compose ps"
   ```

   `git pull` ne touche pas au `.env` de production : il n'est pas versionne.

4. Controle la sante du site, toujours par SSH :

   ```
   ssh -p <NAS_PORT_SSH> <NAS_UTILISATEUR>@<NAS_HOTE> "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9998/api/crypto/sante"
   ```

   Un code autre que 200 signifie que l'API ne repond pas ou que PostgreSQL est injoignable.

5. En cas d'echec a l'etape 3 ou 4, recupere les journaux et arrete-toi :

   ```
   ssh -p <NAS_PORT_SSH> <NAS_UTILISATEUR>@<NAS_HOTE> "cd <NAS_CHEMIN>/application/crypto && sudo docker compose logs --tail 50 crypto"
   ```

6. Resume en quelques lignes : le commit deploye, l'etat du conteneur et le code de sante.
   Signale toute anomalie sans la corriger tant que je ne l'ai pas demande.

Si le schema de la base a change depuis le dernier deploiement, previens-moi :
la migration se lance a part, `sudo docker compose run --rm crypto node application/crypto/api/migrer.js`,
et elle n'est jamais declenchee automatiquement par ce deploiement.
