// Verification des jetons d'identite Google (OpenID Connect), sans dependance externe.
// La signature est verifiee localement a partir des cles publiques de Google.
const crypto = require('crypto');

const URL_CLES = 'https://www.googleapis.com/oauth2/v3/certs';
const EMETTEURS = ['https://accounts.google.com', 'accounts.google.com'];
const TOLERANCE_SECONDES = 60;

let cache = { cles: null, expireLe: 0 };

async function clesPubliques() {
    if (cache.cles && Date.now() < cache.expireLe) return cache.cles;

    const reponse = await fetch(URL_CLES);
    if (!reponse.ok) {
        throw new Error(`Cles Google indisponibles (HTTP ${reponse.status})`);
    }

    const { keys } = await reponse.json();
    if (!Array.isArray(keys) || !keys.length) {
        throw new Error('Reponse inattendue du service de cles Google');
    }

    // Duree de validite indiquee par Google, une heure par defaut
    const controle = reponse.headers.get('cache-control') || '';
    const age = /max-age=(\d+)/.exec(controle);
    const secondes = age ? Number(age[1]) : 3600;

    cache = { cles: keys, expireLe: Date.now() + secondes * 1000 };
    return keys;
}

function decoder(partie) {
    return Buffer.from(partie.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// Renvoie les informations du compte Google si le jeton est authentique et valide.
async function verifierJeton(jeton) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
        throw new Error("GOOGLE_CLIENT_ID absent du .env : connexion Google non configuree");
    }

    if (typeof jeton !== 'string') throw new Error('Jeton Google invalide');

    const parties = jeton.split('.');
    if (parties.length !== 3) throw new Error('Jeton Google invalide');

    let entete;
    let charge;
    try {
        entete = JSON.parse(decoder(parties[0]).toString('utf-8'));
        charge = JSON.parse(decoder(parties[1]).toString('utf-8'));
    } catch (e) {
        throw new Error('Jeton Google illisible');
    }

    if (entete.alg !== 'RS256') throw new Error('Algorithme de signature non accepte');

    const cles = await clesPubliques();
    const cle = cles.find((k) => k.kid === entete.kid);
    if (!cle) throw new Error('Cle de signature Google inconnue');

    const clePublique = crypto.createPublicKey({ key: cle, format: 'jwk' });
    const signee = Buffer.from(`${parties[0]}.${parties[1]}`, 'utf-8');
    const signature = decoder(parties[2]);

    if (!crypto.verify('RSA-SHA256', signee, clePublique, signature)) {
        throw new Error('Signature du jeton Google invalide');
    }

    if (!EMETTEURS.includes(charge.iss)) throw new Error('Emetteur du jeton inattendu');
    if (charge.aud !== clientId) throw new Error("Jeton emis pour une autre application");

    const maintenant = Math.floor(Date.now() / 1000);
    if (typeof charge.exp !== 'number' || charge.exp + TOLERANCE_SECONDES < maintenant) {
        throw new Error('Jeton Google expire');
    }
    if (typeof charge.iat === 'number' && charge.iat - TOLERANCE_SECONDES > maintenant) {
        throw new Error('Jeton Google date du futur');
    }
    if (!charge.sub) throw new Error('Jeton Google sans identifiant de compte');
    if (charge.email_verified === false) {
        throw new Error("Adresse de courriel non verifiee par Google");
    }

    return {
        sub: String(charge.sub),
        courriel: charge.email ? String(charge.email).toLowerCase() : null,
        prenom: charge.given_name || null,
        nom: charge.family_name || null,
    };
}

module.exports = { verifierJeton };
