# Publication mobile : APK Android signe

Compile l'application de `application/crypto/mobile/` en version release, signee avec la
cle de publication, pointee sur l'API de production, puis l'installe sur le telephone branche.

Outils :

- `flutter` est dans le PATH
- adb : `$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe`
- apksigner : `apksigner.bat` du dossier le plus recent de `$env:LOCALAPPDATA\Android\Sdk\build-tools\`

Dans le `.env` de la racine, lis uniquement `CRYPTO_MOBILE_API_URL` (adresse publique de l'API,
sans `/api/crypto`). Ne lis jamais `android/key.properties` : il contient le mot de passe de la cle.

1. **Refuse de publier** si :
   - `git status --short` n'est pas vide : signale les fichiers concernes et arrete-toi ;
   - `application/crypto/mobile/android/key.properties` n'existe pas (teste seulement sa presence) :
     sans lui, l'APK serait signe avec la cle de debug et ne pourrait pas mettre a jour
     l'application installee ;
   - `CRYPTO_MOBILE_API_URL` est vide ou ne commence pas par `https://`.

2. Verifie que l'API de production est prete pour cette version :
   - `<CRYPTO_MOBILE_API_URL>/api/crypto/sante` doit repondre 200 ;
   - recupere le commit deploye sur le NAS (parametres `NAS_*` du `.env`, sans les afficher) :

     ```
     ssh -p <NAS_PORT_SSH> <NAS_UTILISATEUR>@<NAS_HOTE> "git -C <NAS_CHEMIN> rev-parse HEAD"
     ```

   - puis compare le code de l'API entre ce commit et `HEAD` :

     ```
     git diff --stat <commit_nas> HEAD -- application/crypto/api application/_commun/api
     ```

   Si l'API locale differe de celle du NAS, l'application risque d'appeler des routes
   qui n'existent pas encore en production : signale les fichiers et demande s'il faut
   d'abord lancer `/deploy web`. Ne continue qu'avec mon accord.

3. Dans `application/crypto/mobile/`, lance `flutter analyze` puis `flutter test`.
   Au moindre probleme ou echec, montre la sortie et arrete-toi.

4. Lis la ligne `version: x.y.z+n` de `pubspec.yaml` et demande avec AskUserQuestion
   le type de publication :
   - correctif : `z` + 1
   - evolution : `y` + 1, `z` a 0
   - version majeure : `x` + 1, `y` et `z` a 0

   Dans tous les cas, `n` (versionCode Android) augmente de 1 : Android refuse d'installer
   une mise a jour dont le numero n'augmente pas. Modifie seulement cette ligne.

5. Compile :

   ```
   flutter build apk --release --dart-define=API_URL=<CRYPTO_MOBILE_API_URL>
   ```

6. Verifie la signature de `build/app/outputs/flutter-apk/app-release.apk` :

   ```
   apksigner.bat verify --print-certs <apk>
   ```

   Le certificat attendu est `CN=Julien Boesel, O=Suivi crypto, C=FR`, empreinte SHA-1
   `c481aeca313929f5e27d536924ee3e7654cd2468`. Si c'est un autre certificat (notamment
   `CN=Android Debug`), arrete-toi : cet APK ne doit pas etre distribue.

7. Copie l'APK en `build/app/outputs/flutter-apk/suivi-crypto-<x.y.z>.apk`
   (le dossier `build/` n'est pas versionne).

8. Si `adb devices` liste un telephone a l'etat `device` :
   - installe avec `adb install -r <apk>`, puis ouvre l'application :
     `adb shell monkey -p fr.boesel.crypto -c android.intent.category.LAUNCHER 1` ;
   - si l'installation echoue avec `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, une version signee
     avec une autre cle est installee (version de developpement) : ne desinstalle pas
     de toi-meme, demande d'abord, car la desinstallation ferme la session sur le telephone.

   Sans telephone branche, n'installe rien : l'APK reste disponible a l'etape 7.

9. Resume en quelques lignes : la version publiee (`x.y.z+n`), l'adresse d'API compilee,
   la taille et l'emplacement de l'APK, l'installation ou non sur le telephone.
   Rappelle que `pubspec.yaml` a change et propose le commit
   `Publier la version mobile x.y.z`, sans le faire tant que je ne l'ai pas demande.
