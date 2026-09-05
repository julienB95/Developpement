// Sessions : creation, lecture et revocation
const crypto = require('crypto');
const db = require('../../_commun/api/db');

const DUREE_JOURS = Number(process.env.SESSION_DUREE_JOURS || 30);
const MILLISECONDES_PAR_JOUR = 24 * 60 * 60 * 1000;

// Le jeton n'est jamais stocke : seule son empreinte l'est
function empreinte(jeton) {
    return crypto.createHash('sha256').update(jeton).digest('base64');
}

async function creerSession(utilisateurId) {
    const jeton = crypto.randomBytes(32).toString('base64url');
    const expireLe = new Date(Date.now() + DUREE_JOURS * MILLISECONDES_PAR_JOUR);

    await db.requete(
        'INSERT INTO session (jeton_hash, utilisateur_id, expire_le) VALUES ($1, $2, $3)',
        [empreinte(jeton), utilisateurId, expireLe.toISOString()]
    );

    return { jeton, expire_le: expireLe.toISOString() };
}

// Renvoie l'utilisateur associe au jeton, ou null si la session est invalide,
// expiree, ou si le compte a ete desactive depuis la connexion.
async function utilisateurDepuisJeton(jeton) {
    if (!jeton) return null;

    const { rows } = await db.requete(
        `SELECT u.id, u.courriel, u.nom, u.prenom, u.est_actif, u.est_admin, u.devise, u.autorise_google, u.est_bloque, u.plateforme_defaut, u.frais_defaut, u.cree_le, s.expire_le
         FROM session s
         JOIN utilisateur u ON u.id = s.utilisateur_id
         WHERE s.jeton_hash = $1 AND s.expire_le > now()`,
        [empreinte(jeton)]
    );

    if (!rows.length || !rows[0].est_actif) return null;
    return rows[0];
}

async function supprimerSession(jeton) {
    if (!jeton) return;
    await db.requete('DELETE FROM session WHERE jeton_hash = $1', [empreinte(jeton)]);
}

async function supprimerSessionsUtilisateur(utilisateurId) {
    await db.requete('DELETE FROM session WHERE utilisateur_id = $1', [utilisateurId]);
}

async function purgerSessionsExpirees() {
    const { rowCount } = await db.requete('DELETE FROM session WHERE expire_le <= now()');
    return rowCount;
}

// Lit l'en-tete "Authorization: Bearer <jeton>"
function jetonDepuisRequete(req) {
    const entete = req.headers.authorization;
    if (!entete || !entete.startsWith('Bearer ')) return null;
    return entete.slice(7).trim() || null;
}

module.exports = {
    creerSession,
    utilisateurDepuisJeton,
    supprimerSession,
    supprimerSessionsUtilisateur,
    purgerSessionsExpirees,
    jetonDepuisRequete,
    DUREE_JOURS,
};
