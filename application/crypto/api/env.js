// Chargement du fichier .env à la racine du dépôt (sans dépendance externe)
const fs = require('fs');
const path = require('path');

const cheminEnv = path.resolve(__dirname, '..', '..', '..', '.env');

function charger() {
    if (!fs.existsSync(cheminEnv)) return;

    const contenu = fs.readFileSync(cheminEnv, 'utf-8');
    for (const ligne of contenu.split(/\r?\n/)) {
        const nette = ligne.trim();
        if (!nette || nette.startsWith('#')) continue;

        const separateur = nette.indexOf('=');
        if (separateur === -1) continue;

        const cle = nette.slice(0, separateur).trim();
        let valeur = nette.slice(separateur + 1).trim();

        if ((valeur.startsWith('"') && valeur.endsWith('"')) ||
            (valeur.startsWith("'") && valeur.endsWith("'"))) {
            valeur = valeur.slice(1, -1);
        }

        if (!(cle in process.env)) process.env[cle] = valeur;
    }
}

function requis(cle) {
    const valeur = process.env[cle];
    if (valeur === undefined || valeur === '') {
        throw new Error(`Variable d'environnement manquante : ${cle} (voir .env.exemple)`);
    }
    return valeur;
}

module.exports = { charger, requis, cheminEnv };
