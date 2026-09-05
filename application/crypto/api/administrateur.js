// Accorde ou retire le droit d'administration a un compte, depuis le terminal.
// Sert notamment a designer le tout premier administrateur.
//
//   node application/crypto/api/administrateur.js <courriel>
//   node application/crypto/api/administrateur.js <courriel> --retirer
const db = require('../../_commun/api/db');

async function executer() {
    const courriel = (process.argv[2] || '').trim().toLowerCase();
    const retirer = process.argv.includes('--retirer');

    if (!courriel) {
        throw new Error('Usage : node application/crypto/api/administrateur.js <courriel> [--retirer]');
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

    if (!rows.length) throw new Error(`Aucun compte avec l'adresse ${courriel}`);

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
