# Deploiement web : API et site sur le NAS

Deploie la version courante sur le NAS. Les parametres de connexion sont dans le `.env`
de la racine : `NAS_HOTE`, `NAS_UTILISATEUR`, `NAS_PORT_SSH`, `NAS_CHEMIN`.
Ne les affiche pas dans tes reponses et ne lis aucune autre variable du `.env`.

1. **Refuse de deployer** si `git status --short` n'est pas vide : signale les fichiers
   concernes et arrete-toi. Ne commit jamais de ta propre initiative.

2. Si la branche est en avance sur `origin`, pousse-la (`git push`). Le NAS deploie
   depuis GitHub : sans push, il redeploierait l'ancienne version.

3. Mets a jour et reconstruis sur le NAS avec le script de deploiement, seule commande
   que le compte peut lancer en root sans mot de passe :

   ```
   ssh -p <NAS_PORT_SSH> <NAS_UTILISATEUR>@<NAS_HOTE> "sudo -n /usr/local/bin/deployer-crypto deployer"
   ```

   Le script fait le `git pull` (avec le compte du depot, pas en root), reconstruit l'image
   avec la version et la date de deploiement affichees dans le menu du compte, relance le
   conteneur et affiche son etat. Il impose lui-meme les chemins de production
   (`/usr/local/etc/deployer-crypto/variables.env`) : le `.env` du depot n'est pas lu.

   S'il refuse parce que `docker-compose.yml` differe de la version approuvee, arrete-toi :
   montre-moi la modification. Une fois relue, je l'approuve moi-meme sur le NAS, avec mon
   mot de passe : `sudo sh -c 'sha256sum <NAS_CHEMIN>/application/crypto/docker-compose.yml > /usr/local/etc/deployer-crypto/docker-compose.sha256'`.
   N'essaie jamais de contourner ce refus.

   Utilise le `ssh` de Windows (PowerShell) : la cle SSH a une phrase de passe tenue par
   ssh-agent, que le `ssh` de Git Bash ne voit pas.

4. Controle la sante du site, toujours par SSH :

   ```
   ssh -p <NAS_PORT_SSH> <NAS_UTILISATEUR>@<NAS_HOTE> "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9998/api/crypto/sante"
   ```

   Un code autre que 200 signifie que l'API ne repond pas ou que PostgreSQL est injoignable.

5. En cas d'echec a l'etape 3 ou 4, recupere les journaux et arrete-toi :

   ```
   ssh -p <NAS_PORT_SSH> <NAS_UTILISATEUR>@<NAS_HOTE> "sudo -n /usr/local/bin/deployer-crypto journaux 50"
   ```

6. Resume en quelques lignes : le commit deploye, l'etat du conteneur et le code de sante.
   Signale toute anomalie sans la corriger tant que je ne l'ai pas demande.

Si le schema de la base a change depuis le dernier deploiement, previens-moi :
la migration se lance a part, `sudo -n /usr/local/bin/deployer-crypto migrer`,
et elle n'est jamais declenchee automatiquement par ce deploiement.

L'API sert aussi l'application mobile, y compris ses versions deja installees :
si le deploiement modifie le format d'une reponse utilisee par `application/crypto/mobile/`
(champ renomme ou supprime), signale-le, car les telephones non mis a jour en dependent.
