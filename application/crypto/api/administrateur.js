// Accorde ou retire le droit d'administration a un compte, depuis le terminal.
// Cree le compte s'il n'existe pas encore : c'est le seul moyen d'amorcer une
// base neuve, puisqu'il n'y a plus d'inscription publique.
//
//   node application/crypto/api/administrateur.js <courriel>
//   node application/crypto/api/administrateur.js <courriel> --prenom Julien --nom Boesel
//   node application/crypto/api/administrateur.js <courriel> --retirer
const crypto = require('crypto');
const db = require('../../_commun/api/db');

const DUREE_LIEN = 60 * 60 * 1000;

function argument(nom, defaut) {
    const rang = process.argv.indexOf('--' + nom);
    if (rang < 0 || rang + 1 >= process.argv.length) return defaut;
    return process.argv[rang + 1];
}

function adresseDuSite() {
    if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, '');
    const hote = process.env.CRYPTO_API_HOST || '127.0.0.1';
    const port = process.env.CRYPTO_API_PORT || 9998;
    return `http://${hote}:${port}`;
}

// Le compte est cree sans mot de passe : la personne pose le sien
// via le lien a usage unique affiche ici.
async function creerCompte(courriel) {
    const prenom = argument('prenom', 'Administrateur');
    const nom = argument('nom', courriel.split('@')[0]);

    const { rows } = await db.requete(
        `INSERT INTO utilisateur (courriel, nom, prenom, mot_de_passe_a_definir, est_admin)
         VALUES ($1, $2, $3, TRUE, TRUE)
         RETURNING id, courriel, prenom, nom, est_admin, est_actif`,
        [courriel, nom, prenom]
    );

    const jeton = crypto.randomBytes(32).toString('base64url');
    const empreinte = crypto.createHash('sha256').update(jeton).digest('base64');
    const expireLe = new Date(Date.now() + DUREE_LIEN).toISOString();

    await db.requete(
        'INSERT INTO reinitialisation (jeton_hash, utilisateur_id, expire_le) VALUES ($1, $2, $3)',
        [empreinte, rows[0].id, expireLe]
    );

    console.log('Compte cree : %s (%s %s), administrateur', courriel, prenom, nom);
    console.log('');
    console.log('Ouvrez ce lien pour choisir le mot de passe (valable une heure) :');
    console.log('  %s/reinitialisation.html?jeton=%s', adresseDuSite(), encodeURIComponent(jeton));

    return rows[0];
}

async function executer() {
    const courriel = (process.argv[2] || '').trim().toLowerCase();
    const retirer = process.argv.includes('--retirer');

    if (!courriel) {
        throw new Error(
            'Usage : node application/crypto/api/administrateur.js <courriel> [--prenom X] [--nom Y] [--retirer]'
        );
    }

    const { rows: existant } = await db.requete(
        'SELECT id FROM utilisateur WHERE courriel = $1',
        [courriel]
    );

    if (!existant.length) {
        if (retirer) throw new Error(`Aucun compte avec l'adresse ${courriel}`);
        await creerCompte(courriel);
        return;
    }

    if (retirer) {
        const { rows: restants } = await db.requete(
            'SELECT count(*)::int AS n FROM utilisateur WHERE est_admin AND est_actif AND courriel <> $1',
            [courriel]
        );
        if (restants[0].n === 0) {
            throw new Error('Refus : il doit rester au moins un administrateur actif');
        }
    }

    const { rows } = await db.requete(
        `UPDATE utilisateur SET est_admin = $2 WHERE courriel = $1
         RETURNING courriel, prenom, nom, est_admin, est_actif`,
        [courriel, !retirer]
    );

    const compte = rows[0];
    console.log(
        '%s %s (%s) : administrateur = %s%s',
        compte.prenom,
        compte.nom,
        compte.courriel,
        compte.est_admin ? 'oui' : 'non',
        compte.est_actif ? '' : ' [compte desactive]'
    );
}

executer()
    .catch((err) => {
        console.error(err.message);
        process.exitCode = 1;
    })
    .finally(() => db.fermer());
