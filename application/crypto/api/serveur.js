// API de l'application crypto - Node natif + PostgreSQL (NAS Synology)
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../../_commun/api/db');
const auth = require('./authentification');
const google = require('./google');
const marche = require('./marche');
const actualites = require('./actualites');
const valeurs = require('./valeurs');
const motdepasse = require('../../_commun/api/motdepasse');
const courriel = require('../../_commun/api/courriel');

const PORT = Number(process.env.CRYPTO_API_PORT || 9998);
const HOTE = process.env.CRYPTO_API_HOST || '127.0.0.1';

class ErreurClient extends Error {
    constructor(message, code = 400) {
        super(message);
        this.code = code;
    }
}

function repondre(res, code, corps) {
    const contenu = JSON.stringify(corps);
    res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(contenu),
    });
    res.end(contenu);
}

function lireCorps(req) {
    return new Promise((resoudre, rejeter) => {
        let brut = '';
        req.on('data', (morceau) => {
            brut += morceau;
            if (brut.length > 1000000) {
                rejeter(new ErreurClient('Corps de requete trop volumineux', 413));
                req.destroy();
            }
        });
        req.on('error', rejeter);
        req.on('end', () => {
            if (!brut) return resoudre({});
            try {
                resoudre(JSON.parse(brut));
            } catch (e) {
                rejeter(new ErreurClient('Format JSON invalide'));
            }
        });
    });
}

// Les quantites et montants transitent en chaine decimale : jamais convertis en flottant
const DECIMAL = /^\d+(\.\d+)?$/;

function exigerDecimal(corps, champ, obligatoire = true) {
    const valeur = corps[champ];
    if (valeur === undefined || valeur === null || valeur === '') {
        if (obligatoire) throw new ErreurClient(`Champ requis : ${champ}`);
        return null;
    }
    const texte = String(valeur);
    if (!DECIMAL.test(texte)) {
        throw new ErreurClient(`Champ ${champ} : decimal positif attendu (chaine)`);
    }
    return texte;
}

function exigerTexte(corps, champ) {
    const valeur = corps[champ];
    if (typeof valeur !== 'string' || !valeur.trim()) {
        throw new ErreurClient(`Champ requis : ${champ}`);
    }
    return valeur.trim();
}

function exigerEntier(valeur, champ) {
    const nombre = Number(valeur);
    if (!Number.isInteger(nombre) || nombre <= 0) {
        throw new ErreurClient(`Champ ${champ} : entier positif attendu`);
    }
    return nombre;
}

function exigerDate(valeur, champ) {
    const date = valeur ? new Date(valeur) : new Date();
    if (Number.isNaN(date.getTime())) {
        throw new ErreurClient(`Champ ${champ} : date ISO 8601 attendue`);
    }
    return date.toISOString();
}

const routes = [];
function route(methode, motif, gestionnaire) {
    const noms = [];
    const regex = new RegExp('^' + motif.replace(/:([a-z_]+)/g, (_, nom) => {
        noms.push(nom);
        return '([^/]+)';
    }) + '$');
    routes.push({ methode, regex, noms, gestionnaire });
}

// --- Sante -----------------------------------------------------------------
route('GET', '/api/crypto/sante', async () => {
    const { rows } = await db.requete('SELECT now() AS horodatage');
    return { code: 200, corps: { statut: 'ok', horodatage: rows[0].horodatage } };
});

// Reglages publics dont l'interface a besoin. Aucun secret ici :
// l'identifiant client Google est destine a etre expose au navigateur.
route('GET', '/api/crypto/configuration', async () => ({
    code: 200,
    corps: { google_client_id: process.env.GOOGLE_CLIENT_ID || null },
}));

// --- Marche et actualites (acces public) -----------------------------------
// Ces deux routes sont ouvertes : les informations sont affichees avant connexion,
// sur le site comme dans l'application mobile.
route('GET', '/api/crypto/marche/cours', async ({ url }) => {
    try {
        const donnees = await marche.cours(url.searchParams.get('devise'), url.searchParams.get('forcer') === '1');
        return { code: 200, corps: donnees };
    } catch (err) {
        throw new ErreurClient(err.message, 503);
    }
});

route('GET', '/api/crypto/actualites', async ({ url }) => {
    try {
        const donnees = await actualites.articles(url.searchParams.get('limite'), url.searchParams.get('forcer') === '1');
        return { code: 200, corps: donnees };
    } catch (err) {
        throw new ErreurClient(err.message, 503);
    }
});

// --- Cryptos ---------------------------------------------------------------
const DEVISES_AFFICHAGE = ['EUR', 'USD'];

function exigerDevise(valeur, defaut = 'EUR') {
    const devise = String(valeur || defaut).toUpperCase();
    if (!DEVISES_AFFICHAGE.includes(devise)) {
        throw new ErreurClient(`Devise inconnue : ${DEVISES_AFFICHAGE.join(' ou ')} attendu`);
    }
    return devise;
}

route('GET', '/api/crypto/cryptos', async () => {
    const { rows } = await db.requete(
        `SELECT id, libelle, identifiant_coingecko, paire_binance, est_suivi, logo_url, cree_le
         FROM crypto ORDER BY id`
    );
    return { code: 200, corps: rows };
});

route('GET', '/api/crypto/cryptos/:id', async ({ params }) => {
    const { rows } = await db.requete(
        `SELECT id, libelle, identifiant_coingecko, paire_binance, est_suivi, logo_url, cree_le
         FROM crypto WHERE id = $1`,
        [params.id.toUpperCase()]
    );
    if (!rows.length) throw new ErreurClient('Crypto introuvable', 404);
    return { code: 200, corps: rows[0] };
});

// Le referentiel n'est pas modifiable par un visiteur : il sert de base aux calculs
route('POST', '/api/crypto/cryptos', async ({ req, corps }) => {
    await exigerAdmin(req);

    const id = exigerTexte(corps, 'id').toUpperCase();
    const libelle = exigerTexte(corps, 'libelle');
    const coingecko = corps.identifiant_coingecko
        ? String(corps.identifiant_coingecko).trim().toLowerCase()
        : null;
    const paire = corps.paire_binance
        ? String(corps.paire_binance).trim().toUpperCase()
        : null;
    const suivi = corps.est_suivi === undefined ? true : corps.est_suivi === true;

    const { rows } = await db.requete(
        `INSERT INTO crypto (id, libelle, identifiant_coingecko, paire_binance, est_suivi)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE
             SET libelle = EXCLUDED.libelle,
                 identifiant_coingecko = EXCLUDED.identifiant_coingecko,
                 paire_binance = EXCLUDED.paire_binance,
                 est_suivi = EXCLUDED.est_suivi
         RETURNING id, libelle, identifiant_coingecko, paire_binance, est_suivi, logo_url, cree_le`,
        [id, libelle, coingecko, paire, suivi]
    );
    return { code: 201, corps: rows[0] };
});

// Une crypto encore utilisee par une operation n'est pas supprimable :
// l'historique d'un utilisateur ne doit pas perdre sa reference.
route('DELETE', '/api/crypto/cryptos/:id', async ({ req, params }) => {
    await exigerAdmin(req);
    const id = params.id.toUpperCase();

    const { rows: usage } = await db.requete(
        'SELECT count(*)::int AS n FROM operation WHERE id_crypto = $1',
        [id]
    );
    if (usage[0].n > 0) {
        throw new ErreurClient(
            `Suppression refusée : ${usage[0].n} opération(s) utilisent cette crypto. `
            + 'Décochez « suivie » pour la retirer des affichages.',
            409
        );
    }

    const { rows } = await db.requete('DELETE FROM crypto WHERE id = $1 RETURNING id', [id]);
    if (!rows.length) throw new ErreurClient('Crypto introuvable', 404);
    return { code: 200, corps: { statut: 'crypto supprimee', id } };
});

// --- Plateformes -----------------------------------------------------------
route('GET', '/api/crypto/plateformes', async () => {
    const { rows } = await db.requete(
        'SELECT id, libelle, cree_le FROM plateforme ORDER BY libelle'
    );
    return { code: 200, corps: rows };
});

route('POST', '/api/crypto/plateformes', async ({ req, corps }) => {
    await exigerAdmin(req);

    const id = exigerTexte(corps, 'id').toLowerCase();
    const libelle = exigerTexte(corps, 'libelle');

    const { rows } = await db.requete(
        `INSERT INTO plateforme (id, libelle) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET libelle = EXCLUDED.libelle
         RETURNING id, libelle, cree_le`,
        [id, libelle]
    );
    return { code: 201, corps: rows[0] };
});

route('DELETE', '/api/crypto/plateformes/:id', async ({ req, params }) => {
    await exigerAdmin(req);
    const id = params.id.toLowerCase();

    const { rows: usage } = await db.requete(
        'SELECT count(*)::int AS n FROM operation WHERE plateforme_id = $1',
        [id]
    );
    if (usage[0].n > 0) {
        throw new ErreurClient(
            `Suppression refusée : ${usage[0].n} opération(s) référencent cette plateforme.`,
            409
        );
    }

    const { rows } = await db.requete('DELETE FROM plateforme WHERE id = $1 RETURNING id', [id]);
    if (!rows.length) throw new ErreurClient('Plateforme introuvable', 404);
    return { code: 200, corps: { statut: 'plateforme supprimee', id } };
});

// --- Valeurs quotidiennes --------------------------------------------------
route('GET', '/api/crypto/valeurs', async ({ url }) => {
    const idCrypto = (url.searchParams.get('crypto') || '').toUpperCase();
    if (!idCrypto) throw new ErreurClient('Parametre requis : crypto');
    const limite = Math.min(Number(url.searchParams.get('limite')) || 90, 1000);
    const annee = url.searchParams.get('annee');

    const conditions = ['id_crypto = $1'];
    const parametres = [idCrypto];

    if (annee) {
        parametres.push(exigerEntier(annee, 'annee'));
        const rang = parametres.length;
        conditions.push(`date >= make_date($${rang}, 1, 1) AND date < make_date($${rang} + 1, 1, 1)`);
    }

    parametres.push(limite);

    const { rows } = await db.requete(
        `SELECT id_crypto, date, devise, source, vwap, ouverture, haut, bas, cloture,
                volume, volume_devise, releve_le
         FROM crypto_valeur
         WHERE ${conditions.join(' AND ')}
         ORDER BY date DESC
         LIMIT $${parametres.length}`,
        parametres
    );
    return { code: 200, corps: rows };
});

route('POST', '/api/crypto/valeurs', async ({ req, corps }) => {
    await exigerAdmin(req);

    const idCrypto = exigerTexte(corps, 'id_crypto').toUpperCase();
    const date = exigerTexte(corps, 'date');
    const source = exigerTexte(corps, 'source');
    const devise = exigerDevise(corps.devise);

    const { rows } = await db.requete(
        `INSERT INTO crypto_valeur
             (id_crypto, date, devise, source, vwap, ouverture, haut, bas, cloture,
              volume, volume_devise)
         VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id_crypto, date) DO UPDATE
             SET devise = EXCLUDED.devise,
                 source = EXCLUDED.source,
                 vwap = EXCLUDED.vwap,
                 ouverture = EXCLUDED.ouverture,
                 haut = EXCLUDED.haut,
                 bas = EXCLUDED.bas,
                 cloture = EXCLUDED.cloture,
                 volume = EXCLUDED.volume,
                 volume_devise = EXCLUDED.volume_devise,
                 releve_le = now()
         RETURNING id_crypto, date, devise, source, vwap, ouverture, haut, bas, cloture,
                   volume, volume_devise, releve_le`,
        [
            idCrypto, date, devise, source,
            exigerDecimal(corps, 'vwap', false),
            exigerDecimal(corps, 'ouverture', false),
            exigerDecimal(corps, 'haut', false),
            exigerDecimal(corps, 'bas', false),
            exigerDecimal(corps, 'cloture', false),
            exigerDecimal(corps, 'volume', false),
            exigerDecimal(corps, 'volume_devise', false),
        ]
    );
    return { code: 201, corps: rows[0] };
});

// --- Operations ------------------------------------------------------------
// Chaque utilisateur ne voit et n'ecrit que ses propres operations :
// l'identifiant vient du jeton de session, jamais du corps de la requete.

// Montant total de l'operation, signe selon le sens : negatif quand l'argent
// sort (achat), positif quand il rentre (vente). Les frais suivent le meme sens.
const MONTANT_SQL = `CASE
        WHEN o.prix_unitaire IS NULL THEN NULL
        WHEN o.sens = 'achat' THEN -(o.quantite * o.prix_unitaire + o.frais)
        ELSE (o.quantite * o.prix_unitaire - o.frais)
    END`;

const CHAMPS_OPERATION = `o.id, o.horodatage, o.sens, o.id_crypto, c.libelle,
                o.quantite, o.plateforme_id, p.libelle AS plateforme,
                o.prix_unitaire, o.frais, ${MONTANT_SQL}::text AS montant, o.cree_le`;

function filtresOperations(utilisateurId, url) {
    const conditions = ['o.utilisateur_id = $1'];
    const valeurs = [utilisateurId];

    const annee = url.searchParams.get('annee');
    if (annee) {
        const millesime = exigerEntier(annee, 'annee');
        valeurs.push(millesime);
        conditions.push(
            `(o.horodatage AT TIME ZONE 'Europe/Paris') >= make_date($${valeurs.length}, 1, 1)
             AND (o.horodatage AT TIME ZONE 'Europe/Paris') < make_date($${valeurs.length} + 1, 1, 1)`
        );
    }

    const crypto = url.searchParams.get('crypto');
    if (crypto) {
        valeurs.push(crypto.toUpperCase());
        conditions.push(`o.id_crypto = $${valeurs.length}`);
    }

    const sens = url.searchParams.get('sens');
    if (sens) {
        if (sens !== 'achat' && sens !== 'vente') {
            throw new ErreurClient('Filtre sens : achat ou vente attendu');
        }
        valeurs.push(sens);
        conditions.push(`o.sens = $${valeurs.length}`);
    }

    return { ou: conditions.join(' AND '), valeurs };
}

route('GET', '/api/crypto/operations', async ({ req, url }) => {
    const utilisateur = await exigerConnexion(req);
    const { ou, valeurs } = filtresOperations(utilisateur.id, url);

    const taille = Math.min(Math.max(Number(url.searchParams.get('taille')) || 5, 1), 100);
    const page = Math.max(Number(url.searchParams.get('page')) || 1, 1);

    const total = await db.requete(
        `SELECT count(*)::int AS n FROM operation o WHERE ${ou}`,
        valeurs
    );

    const { rows } = await db.requete(
        `SELECT ${CHAMPS_OPERATION}
         FROM operation o
         JOIN crypto c ON c.id = o.id_crypto
         LEFT JOIN plateforme p ON p.id = o.plateforme_id
         WHERE ${ou}
         ORDER BY o.horodatage DESC, o.id DESC
         LIMIT $${valeurs.length + 1} OFFSET $${valeurs.length + 2}`,
        valeurs.concat([taille, (page - 1) * taille])
    );

    return {
        code: 200,
        corps: {
            lignes: rows,
            total: total.rows[0].n,
            page,
            taille,
            pages: Math.max(1, Math.ceil(total.rows[0].n / taille)),
        },
    };
});

// Millesimes disponibles, pour alimenter le filtre par annee
route('GET', '/api/crypto/operations/annees', async ({ req }) => {
    const utilisateur = await exigerConnexion(req);

    const { rows } = await db.requete(
        `SELECT DISTINCT EXTRACT(YEAR FROM o.horodatage AT TIME ZONE 'Europe/Paris')::int AS annee
         FROM operation o
         WHERE o.utilisateur_id = $1
         ORDER BY annee DESC`,
        [utilisateur.id]
    );
    return { code: 200, corps: rows.map((ligne) => ligne.annee) };
});

function lireOperation(corps) {
    const sens = exigerTexte(corps, 'sens').toLowerCase();
    if (sens !== 'achat' && sens !== 'vente') {
        throw new ErreurClient('Champ sens : achat ou vente attendu');
    }

    return {
        sens,
        idCrypto: exigerTexte(corps, 'id_crypto').toUpperCase(),
        quantite: exigerDecimal(corps, 'quantite'),
        horodatage: exigerDate(corps.horodatage, 'horodatage'),
        plateforme: corps.plateforme_id ? String(corps.plateforme_id).trim().toLowerCase() : null,
        prixUnitaire: exigerDecimal(corps, 'prix_unitaire', false),
        frais: exigerDecimal(corps, 'frais', false) || '0',
    };
}

// Une vente est une cession imposable : la valeur du jour de toutes les cryptos
// detenues est relevee et figee, car c'est elle qui servira a calculer la valeur
// globale du portefeuille au moment de la cession. Un echec de la source ne fait
// pas echouer l'enregistrement de l'operation : le releve pourra etre rejoue.
async function releverSiVente(utilisateurId, operation) {
    if (operation.sens !== 'vente') return null;
    try {
        return await valeurs.releverPourUtilisateur(
            utilisateurId,
            valeurs.jourParis(new Date(operation.horodatage))
        );
    } catch (err) {
        console.error('Relevé des valeurs après une vente :', err.message);
        return { jour: null, releves: [], deja: [], echecs: [{ raison: err.message }] };
    }
}

route('POST', '/api/crypto/operations', async ({ req, corps }) => {
    const utilisateur = await exigerConnexion(req);
    const saisie = lireOperation(corps);

    const { rows } = await db.requete(
        `INSERT INTO operation
             (utilisateur_id, horodatage, sens, id_crypto, quantite, plateforme_id,
              prix_unitaire, frais)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [utilisateur.id, saisie.horodatage, saisie.sens, saisie.idCrypto, saisie.quantite,
         saisie.plateforme, saisie.prixUnitaire, saisie.frais]
    );

    const bilan = await releverSiVente(utilisateur.id, saisie);
    const complete = await db.requete(
        `SELECT ${CHAMPS_OPERATION}
         FROM operation o
         JOIN crypto c ON c.id = o.id_crypto
         LEFT JOIN plateforme p ON p.id = o.plateforme_id
         WHERE o.id = $1`,
        [rows[0].id]
    );

    return { code: 201, corps: Object.assign({}, complete.rows[0], { valeurs_relevees: bilan }) };
});

route('PUT', '/api/crypto/operations/:id', async ({ req, params, corps }) => {
    const utilisateur = await exigerConnexion(req);
    const id = exigerEntier(params.id, 'id');
    const saisie = lireOperation(corps);

    const { rows } = await db.requete(
        `UPDATE operation
         SET horodatage = $3, sens = $4, id_crypto = $5, quantite = $6,
             plateforme_id = $7, prix_unitaire = $8, frais = $9
         WHERE id = $1 AND utilisateur_id = $2
         RETURNING id`,
        [id, utilisateur.id, saisie.horodatage, saisie.sens, saisie.idCrypto,
         saisie.quantite, saisie.plateforme, saisie.prixUnitaire, saisie.frais]
    );
    if (!rows.length) throw new ErreurClient('Opération introuvable', 404);

    const bilan = await releverSiVente(utilisateur.id, saisie);
    const complete = await db.requete(
        `SELECT ${CHAMPS_OPERATION}
         FROM operation o
         JOIN crypto c ON c.id = o.id_crypto
         LEFT JOIN plateforme p ON p.id = o.plateforme_id
         WHERE o.id = $1`,
        [id]
    );

    return { code: 200, corps: Object.assign({}, complete.rows[0], { valeurs_relevees: bilan }) };
});

route('DELETE', '/api/crypto/operations/:id', async ({ req, params }) => {
    const utilisateur = await exigerConnexion(req);
    const id = exigerEntier(params.id, 'id');

    const { rows } = await db.requete(
        'DELETE FROM operation WHERE id = $1 AND utilisateur_id = $2 RETURNING id',
        [id, utilisateur.id]
    );
    if (!rows.length) throw new ErreurClient('Opération introuvable', 404);

    // Les valeurs de marche relevees ne sont pas supprimees : elles ne sont pas
    // la propriete de l'operation et peuvent servir a d'autres cessions.
    return { code: 200, corps: { statut: 'operation supprimee', id } };
});

// --- Logos des cryptos -----------------------------------------------------
// Les images sont relayees par l'API : le navigateur ne contacte jamais la source
// des cours, conformement a la regle du projet. Un logo ne bouge pratiquement
// jamais, d'ou un cache long en memoire.
const HOTES_LOGOS = ['coin-images.coingecko.com', 'assets.coingecko.com'];
const DUREE_CACHE_LOGO = 24 * 60 * 60 * 1000;
const TAILLE_MAX_LOGO = 512 * 1024;
const DELAI_LOGO = 8000;
const cacheLogos = new Map();

function reponseLogo(entree) {
    return {
        code: 200,
        brut: {
            contenu: entree.contenu,
            entetes: {
                'Content-Type': entree.type,
                'Content-Length': entree.contenu.length,
                'Cache-Control': 'public, max-age=86400',
            },
        },
    };
}

route('GET', '/api/crypto/cryptos/:id/logo', async ({ params }) => {
    const id = params.id.toUpperCase();

    const enCache = cacheLogos.get(id);
    if (enCache && Date.now() - enCache.horodatage < DUREE_CACHE_LOGO) {
        return reponseLogo(enCache);
    }

    const { rows } = await db.requete(
        'SELECT logo_url, identifiant_coingecko FROM crypto WHERE id = $1',
        [id]
    );
    if (!rows.length) throw new ErreurClient('Crypto introuvable', 404);

    // L'adresse est retenue en base au premier passage : les fois suivantes,
    // le referentiel suffit et la source des cours n'est plus sollicitee.
    let adresse = rows[0].logo_url;
    if (!adresse) {
        if (!rows[0].identifiant_coingecko) {
            throw new ErreurClient('Aucun logo connu pour cette crypto', 404);
        }
        try {
            adresse = await marche.logoActif(rows[0].identifiant_coingecko);
        } catch (err) {
            // Source injoignable : le dernier logo connu vaut mieux qu'une erreur
            if (enCache) return reponseLogo(enCache);
            throw new ErreurClient('Logo momentanement indisponible', 503);
        }
        if (adresse) {
            await db.requete('UPDATE crypto SET logo_url = $2 WHERE id = $1', [id, adresse]);
        }
    }
    if (!adresse) {
        if (enCache) return reponseLogo(enCache);
        throw new ErreurClient('Aucun logo connu pour cette crypto', 404);
    }

    // L'adresse vient de la source, pas du client, mais elle est verifiee
    // avant toute requete sortante : aucune URL arbitraire n'est appelee.
    let cible;
    try {
        cible = new URL(adresse);
    } catch (err) {
        throw new ErreurClient('Adresse de logo invalide', 502);
    }
    if (cible.protocol !== 'https:' || !HOTES_LOGOS.includes(cible.hostname)) {
        throw new ErreurClient('Adresse de logo refusee', 502);
    }

    let reponse;
    try {
        reponse = await fetch(cible, { signal: AbortSignal.timeout(DELAI_LOGO) });
    } catch (err) {
        if (enCache) return reponseLogo(enCache);
        throw new ErreurClient('Logo momentanement indisponible', 503);
    }

    const type = reponse.headers.get('content-type') || '';
    if (!reponse.ok || !type.startsWith('image/')) {
        if (enCache) return reponseLogo(enCache);
        throw new ErreurClient('Logo momentanement indisponible', 503);
    }

    const contenu = Buffer.from(await reponse.arrayBuffer());
    if (contenu.length > TAILLE_MAX_LOGO) {
        throw new ErreurClient('Logo trop volumineux', 502);
    }

    const entree = { contenu, type: type.split(';')[0], horodatage: Date.now() };
    cacheLogos.set(id, entree);
    return reponseLogo(entree);
});

// --- Detentions ------------------------------------------------------------
// Cryptos encore detenues : quantite nette strictement positive, calculee sur
// l'ensemble des operations. Restreindre au millesime en cours donnerait des
// quantites negatives des qu'un achat anterieur sort du filtre.
route('GET', '/api/crypto/mon-portefeuille', async ({ req }) => {
    const utilisateur = await exigerConnexion(req);

    const { rows } = await db.requete(
        `SELECT o.id_crypto,
                c.libelle,
                SUM(CASE WHEN o.sens = 'achat' THEN o.quantite ELSE -o.quantite END)::text AS quantite,
                count(*)::int AS operations
         FROM operation o
         JOIN crypto c ON c.id = o.id_crypto
         WHERE o.utilisateur_id = $1
         GROUP BY o.id_crypto, c.libelle
         HAVING SUM(CASE WHEN o.sens = 'achat' THEN o.quantite ELSE -o.quantite END) > 0
         ORDER BY c.libelle`,
        [utilisateur.id]
    );

    return { code: 200, corps: { lignes: rows } };
});

// --- Comptes et connexion --------------------------------------------------
const COURRIEL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LONGUEUR_MOT_DE_PASSE = 12;

function exigerCourriel(corps) {
    const courriel = exigerTexte(corps, 'courriel').toLowerCase();
    if (!COURRIEL.test(courriel)) throw new ErreurClient('Adresse de courriel invalide');
    return courriel;
}

// Vue publique d'un compte : ni empreinte de mot de passe, ni identifiant Google
function comptePublic(ligne) {
    return {
        id: ligne.id,
        courriel: ligne.courriel,
        nom: ligne.nom,
        prenom: ligne.prenom,
        est_actif: ligne.est_actif,
        est_admin: ligne.est_admin,
        devise: ligne.devise,
        autorise_google: ligne.autorise_google,
        est_bloque: ligne.est_bloque,
        mot_de_passe_a_definir: ligne.mot_de_passe_a_definir,
        cree_le: ligne.cree_le,
    };
}

async function exigerConnexion(req) {
    const utilisateur = await auth.utilisateurDepuisJeton(auth.jetonDepuisRequete(req));
    if (!utilisateur) throw new ErreurClient('Authentification requise', 401);
    return utilisateur;
}

// Aucune inscription publique : les comptes sont crees par un administrateur,
// via POST /api/crypto/administration/utilisateurs. Le tout premier compte d'une
// base neuve se cree en ligne de commande : npm run crypto:admin -- <courriel>

// Blocage apres echecs repetes. Ne concerne que la connexion par mot de passe :
// une connexion Google ne presente aucun mot de passe a deviner.
const MAX_TENTATIVES = 3;
const DUREE_REINITIALISATION = 60 * 60 * 1000;

const CHAMPS_COMPTE = `id, courriel, nom, prenom, est_actif, est_admin, devise,
                autorise_google, est_bloque, mot_de_passe_a_definir, cree_le`;

function messageBloque() {
    return new ErreurClient(
        `Ce compte est bloqué après ${MAX_TENTATIVES} échecs de connexion. `
        + 'Réinitialisez votre mot de passe pour le débloquer.',
        403
    );
}

route('POST', '/api/crypto/connexion', async ({ corps }) => {
    const adresse = exigerCourriel(corps);
    const enClair = exigerTexte(corps, 'mot_de_passe');

    const { rows } = await db.requete(
        `SELECT ${CHAMPS_COMPTE}, tentatives_echouees, mot_de_passe_hash
         FROM utilisateur WHERE courriel = $1`,
        [adresse]
    );

    const ligne = rows[0];

    // Un compte bloque ne voit meme pas son mot de passe verifie
    if (ligne && ligne.est_bloque) throw messageBloque();

    const valide = ligne && ligne.mot_de_passe_hash
        ? await motdepasse.verifier(enClair, ligne.mot_de_passe_hash)
        : false;

    if (!valide) {
        // Le compteur n'avance que sur un compte reellement protege par mot de passe :
        // sinon le comportement observe revelerait quelles adresses existent.
        if (ligne && ligne.mot_de_passe_hash) {
            const { rows: apres } = await db.requete(
                `UPDATE utilisateur
                 SET tentatives_echouees = tentatives_echouees + 1,
                     est_bloque = (tentatives_echouees + 1 >= $2)
                 WHERE id = $1
                 RETURNING est_bloque`,
                [ligne.id, MAX_TENTATIVES]
            );
            if (apres[0].est_bloque) {
                // Un compte qui vient d'etre bloque ne garde aucune session ouverte
                await auth.supprimerSessionsUtilisateur(ligne.id);
                throw messageBloque();
            }
        }
        // Message identique dans tous les cas : ne revele pas si le compte existe
        throw new ErreurClient('Courriel ou mot de passe incorrect', 401);
    }

    if (!ligne.est_actif) throw new ErreurClient('Ce compte est desactive', 403);

    if (ligne.tentatives_echouees > 0) {
        await db.requete('UPDATE utilisateur SET tentatives_echouees = 0 WHERE id = $1', [ligne.id]);
    }

    const session = await auth.creerSession(ligne.id);
    return { code: 200, corps: { utilisateur: comptePublic(ligne), ...session } };
});

// La connexion Google ne cree jamais de compte : l'adresse doit deja exister
// en base et avoir recu l'autorisation d'un administrateur.
route('POST', '/api/crypto/connexion/google', async ({ corps }) => {
    const jetonGoogle = exigerTexte(corps, 'jeton');

    let profil;
    try {
        profil = await google.verifierJeton(jetonGoogle);
    } catch (err) {
        throw new ErreurClient(err.message, 401);
    }
    if (!profil.courriel) {
        throw new ErreurClient("Le compte Google ne fournit pas d'adresse de courriel", 400);
    }

    // Compte deja rattache a ce compte Google
    let { rows } = await db.requete(
        `SELECT ${CHAMPS_COMPTE} FROM utilisateur WHERE google_sub = $1`,
        [profil.sub]
    );

    // Sinon, premier rattachement : uniquement sur un compte existant, actif,
    // et dont le droit de connexion Google a ete ouvert.
    if (!rows.length) {
        ({ rows } = await db.requete(
            `UPDATE utilisateur SET google_sub = $2
             WHERE courriel = $1 AND google_sub IS NULL AND autorise_google AND est_actif
             RETURNING ${CHAMPS_COMPTE}`,
            [profil.courriel, profil.sub]
        ));
    }

    if (!rows.length) {
        throw new ErreurClient(
            "Cette adresse Google n'est pas autorisée à se connecter ici. "
            + "Un administrateur doit d'abord ouvrir l'accès sur un compte existant.",
            403
        );
    }
    if (!rows[0].autorise_google) {
        throw new ErreurClient("L'accès par Google a été retiré à ce compte", 403);
    }
    if (!rows[0].est_actif) throw new ErreurClient('Ce compte est desactive', 403);

    const session = await auth.creerSession(rows[0].id);
    return { code: 200, corps: { utilisateur: comptePublic(rows[0]), ...session } };
});

// --- Reinitialisation du mot de passe --------------------------------------
function adresseDuSite(req) {
    if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, '');
    const protocole = req.headers['x-forwarded-proto'] || 'http';
    return `${protocole}://${req.headers.host || `${HOTE}:${PORT}`}`;
}

// La reponse est la meme que l'adresse existe ou non : cette route dirait
// sinon a n'importe qui quelles adresses possedent un compte.
// Prepare un lien de definition de mot de passe a usage unique.
// Les demandes precedentes encore ouvertes sont annulees.
async function preparerLienMotDePasse(utilisateurId, req) {
    const jeton = crypto.randomBytes(32).toString('base64url');
    const empreinte = crypto.createHash('sha256').update(jeton).digest('base64');
    const expireLe = new Date(Date.now() + DUREE_REINITIALISATION).toISOString();

    await db.requete(
        'DELETE FROM reinitialisation WHERE utilisateur_id = $1 AND utilise_le IS NULL',
        [utilisateurId]
    );
    await db.requete(
        'INSERT INTO reinitialisation (jeton_hash, utilisateur_id, expire_le) VALUES ($1, $2, $3)',
        [empreinte, utilisateurId, expireLe]
    );

    return `${adresseDuSite(req)}/reinitialisation.html?jeton=${encodeURIComponent(jeton)}`;
}

route('POST', '/api/crypto/mot-de-passe/oubli', async ({ corps, req }) => {
    const adresse = exigerCourriel(corps);

    const { rows } = await db.requete(
        `SELECT id, prenom FROM utilisateur
         WHERE courriel = $1 AND est_actif AND (mot_de_passe_hash IS NOT NULL OR mot_de_passe_a_definir)`,
        [adresse]
    );

    if (rows.length) {
        const lien = await preparerLienMotDePasse(rows[0].id, req);
        const texte = [
            `Bonjour ${rows[0].prenom},`,
            '',
            'Vous avez demandé la réinitialisation de votre mot de passe sur Suivi crypto.',
            'Ouvrez le lien ci-dessous pour en choisir un nouveau :',
            '',
            lien,
            '',
            "Ce lien est valable une heure et ne peut servir qu'une fois.",
            "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message :",
            'votre mot de passe actuel reste valable.',
        ].join('\r\n');

        try {
            await courriel.envoyer({
                destinataire: adresse,
                sujet: 'Réinitialisation de votre mot de passe',
                texte,
            });
        } catch (err) {
            // L'echec d'envoi est journalise, jamais renvoye au client :
            // la reponse doit rester identique pour toutes les adresses.
            console.error('Envoi du courriel de réinitialisation :', err.message);
        }
    }

    return {
        code: 200,
        corps: { statut: 'Si un compte existe pour cette adresse, un courriel vient de partir.' },
    };
});

route('POST', '/api/crypto/mot-de-passe/reinitialisation', async ({ corps }) => {
    const jeton = exigerTexte(corps, 'jeton');
    const enClair = exigerTexte(corps, 'mot_de_passe');

    if (enClair.length < LONGUEUR_MOT_DE_PASSE) {
        throw new ErreurClient(`Le mot de passe doit faire au moins ${LONGUEUR_MOT_DE_PASSE} caracteres`);
    }

    const empreinte = crypto.createHash('sha256').update(jeton).digest('base64');
    const { rows } = await db.requete(
        `SELECT utilisateur_id FROM reinitialisation
         WHERE jeton_hash = $1 AND utilise_le IS NULL AND expire_le > now()`,
        [empreinte]
    );
    if (!rows.length) {
        throw new ErreurClient('Ce lien de réinitialisation est expiré ou déjà utilisé', 400);
    }

    let hash;
    try {
        hash = await motdepasse.hacher(enClair);
    } catch (err) {
        throw new ErreurClient(err.message);
    }

    // Le nouveau mot de passe debloque le compte et remet le compteur a zero
    await db.requete(
        `UPDATE utilisateur
         SET mot_de_passe_hash = $2, est_bloque = FALSE, tentatives_echouees = 0,
             mot_de_passe_a_definir = FALSE
         WHERE id = $1`,
        [rows[0].utilisateur_id, hash]
    );
    await db.requete(
        'UPDATE reinitialisation SET utilise_le = now() WHERE jeton_hash = $1',
        [empreinte]
    );

    // Toute session ouverte ailleurs tombe : le mot de passe a pu fuiter
    await auth.supprimerSessionsUtilisateur(rows[0].utilisateur_id);

    return { code: 200, corps: { statut: 'mot de passe enregistre' } };
});

route('GET', '/api/crypto/moi', async ({ req }) => {
    const utilisateur = await exigerConnexion(req);
    return { code: 200, corps: comptePublic(utilisateur) };
});

// Modification de son propre profil. Le changement d'adresse est possible :
// l'identite technique du compte reste son id, jamais son courriel.
route('PUT', '/api/crypto/moi', async ({ req, corps }) => {
    const utilisateur = await exigerConnexion(req);

    const adresse = exigerCourriel(corps);
    const nom = exigerTexte(corps, 'nom');
    const prenom = exigerTexte(corps, 'prenom');
    const devise = exigerDevise(corps.devise || utilisateur.devise);

    const { rows } = await db.requete(
        `UPDATE utilisateur SET courriel = $2, nom = $3, prenom = $4, devise = $5
         WHERE id = $1
         RETURNING id, courriel, nom, prenom, est_actif, est_admin, devise, autorise_google, est_bloque, mot_de_passe_a_definir, cree_le`,
        [utilisateur.id, adresse, nom, prenom, devise]
    );
    if (!rows.length) throw new ErreurClient('Compte introuvable', 404);

    return { code: 200, corps: comptePublic(rows[0]) };
});

route('POST', '/api/crypto/deconnexion', async ({ req }) => {
    await auth.supprimerSession(auth.jetonDepuisRequete(req));
    return { code: 200, corps: { statut: 'deconnecte' } };
});

// Desactivation de son propre compte : les donnees sont conservees,
// toutes les sessions ouvertes sont fermees.
// Devise d affichage du compte. Ne change rien aux montants stockes :
// seules les valeurs presentees a l ecran sont converties.
route('PUT', '/api/crypto/moi/devise', async ({ req, corps }) => {
    const utilisateur = await exigerConnexion(req);
    const devise = exigerDevise(corps.devise);

    const { rows } = await db.requete(
        `UPDATE utilisateur SET devise = $2 WHERE id = $1
         RETURNING id, courriel, nom, prenom, est_actif, est_admin, devise, autorise_google, est_bloque, mot_de_passe_a_definir, cree_le`,
        [utilisateur.id, devise]
    );
    return { code: 200, corps: comptePublic(rows[0]) };
});

route('POST', '/api/crypto/moi/desactivation', async ({ req }) => {
    const utilisateur = await exigerConnexion(req);
    await db.requete('UPDATE utilisateur SET est_actif = FALSE WHERE id = $1', [utilisateur.id]);
    await auth.supprimerSessionsUtilisateur(utilisateur.id);
    return { code: 200, corps: { statut: 'compte desactive' } };
});

// --- Administration : parametrage des utilisateurs -------------------------
async function exigerAdmin(req) {
    const utilisateur = await exigerConnexion(req);
    if (!utilisateur.est_admin) {
        throw new ErreurClient('Reserve aux administrateurs', 403);
    }
    return utilisateur;
}

function exigerBooleen(corps, champ) {
    const valeur = corps[champ];
    if (typeof valeur !== 'boolean') {
        throw new ErreurClient(`Champ ${champ} : true ou false attendu`);
    }
    return valeur;
}

route('GET', '/api/crypto/administration/utilisateurs', async ({ req }) => {
    await exigerAdmin(req);

    const { rows } = await db.requete(
        `SELECT id, courriel, nom, prenom, est_actif, est_admin, devise, autorise_google, est_bloque, mot_de_passe_a_definir, cree_le,
                (mot_de_passe_hash IS NOT NULL) AS a_mot_de_passe,
                (google_sub IS NOT NULL) AS a_google,
                (SELECT count(*) FROM session s WHERE s.utilisateur_id = u.id AND s.expire_le > now())::int AS sessions_ouvertes
         FROM utilisateur u
         ORDER BY nom, prenom`
    );
    return { code: 200, corps: rows };
});

route('POST', '/api/crypto/administration/utilisateurs/:id/activation', async ({ req, params, corps }) => {
    const administrateur = await exigerAdmin(req);
    const id = exigerEntier(params.id, 'id');
    const estActif = exigerBooleen(corps, 'est_actif');

    // Se desactiver soi-meme fermerait la session en cours : passer par son propre compte
    if (id === administrateur.id) {
        throw new ErreurClient('Utilisez votre propre compte pour vous desactiver', 400);
    }

    const { rows } = await db.requete(
        `UPDATE utilisateur SET est_actif = $2 WHERE id = $1
         RETURNING id, courriel, nom, prenom, est_actif, est_admin, devise, autorise_google, est_bloque, mot_de_passe_a_definir, cree_le`,
        [id, estActif]
    );
    if (!rows.length) throw new ErreurClient('Utilisateur introuvable', 404);

    // Un compte desactive ne doit plus disposer de session valide
    if (!estActif) await auth.supprimerSessionsUtilisateur(id);

    return { code: 200, corps: rows[0] };
});

route('POST', '/api/crypto/administration/utilisateurs/:id/administrateur', async ({ req, params, corps }) => {
    const administrateur = await exigerAdmin(req);
    const id = exigerEntier(params.id, 'id');
    const estAdmin = exigerBooleen(corps, 'est_admin');

    // Empeche de se retirer soi-meme le droit et de se verrouiller dehors
    if (id === administrateur.id) {
        throw new ErreurClient('Un administrateur ne peut pas modifier son propre droit', 400);
    }

    if (!estAdmin) {
        const { rows: restants } = await db.requete(
            'SELECT count(*)::int AS n FROM utilisateur WHERE est_admin AND est_actif AND id <> $1',
            [id]
        );
        if (restants[0].n === 0) {
            throw new ErreurClient('Il doit rester au moins un administrateur actif', 400);
        }
    }

    const { rows } = await db.requete(
        `UPDATE utilisateur SET est_admin = $2 WHERE id = $1
         RETURNING id, courriel, nom, prenom, est_actif, est_admin, devise, autorise_google, est_bloque, mot_de_passe_a_definir, cree_le`,
        [id, estAdmin]
    );
    if (!rows.length) throw new ErreurClient('Utilisateur introuvable', 404);

    return { code: 200, corps: rows[0] };
});

// Ouverture ou fermeture du droit de connexion par Google.
// Sans ce droit, un compte Google inconnu ne peut pas se creer un acces.
route('POST', '/api/crypto/administration/utilisateurs/:id/google', async ({ req, params, corps }) => {
    await exigerAdmin(req);
    const id = exigerEntier(params.id, 'id');
    const autorise = exigerBooleen(corps, 'autorise_google');

    const { rows } = await db.requete(
        `UPDATE utilisateur SET autorise_google = $2 WHERE id = $1
         RETURNING id, courriel, nom, prenom, est_actif, est_admin, devise, autorise_google, est_bloque, mot_de_passe_a_definir, cree_le`,
        [id, autorise]
    );
    if (!rows.length) throw new ErreurClient('Utilisateur introuvable', 404);
    return { code: 200, corps: rows[0] };
});

// Deblocage d'un compte apres des echecs de connexion.
// Le blocage, lui, ne se pose que tout seul : un administrateur n'a pas
// a bloquer un compte a la main, il le desactive.
route('POST', '/api/crypto/administration/utilisateurs/:id/deblocage', async ({ req, params }) => {
    await exigerAdmin(req);
    const id = exigerEntier(params.id, 'id');

    const { rows } = await db.requete(
        `UPDATE utilisateur SET est_bloque = FALSE, tentatives_echouees = 0 WHERE id = $1
         RETURNING id, courriel, nom, prenom, est_actif, est_admin, devise, autorise_google, est_bloque, mot_de_passe_a_definir, cree_le`,
        [id]
    );
    if (!rows.length) throw new ErreurClient('Utilisateur introuvable', 404);
    return { code: 200, corps: rows[0] };
});

// Creation d'un compte par un administrateur.
// La case "definira son mot de passe lui-meme" cree le compte sans mot de passe
// et prepare un lien a usage unique, envoye par courriel si le SMTP est configure,
// affiche a l'administrateur sinon pour qu'il le transmette lui-meme.
route('POST', '/api/crypto/administration/utilisateurs', async ({ req, corps }) => {
    await exigerAdmin(req);

    const adresse = exigerCourriel(corps);
    const nom = exigerTexte(corps, 'nom');
    const prenom = exigerTexte(corps, 'prenom');
    const autoriseGoogle = corps.autorise_google === true;
    const aDefinir = corps.mot_de_passe_a_definir === true;

    let empreinte = null;
    if (!aDefinir) {
        const enClair = exigerTexte(corps, 'mot_de_passe');
        if (enClair.length < LONGUEUR_MOT_DE_PASSE) {
            throw new ErreurClient(`Le mot de passe doit faire au moins ${LONGUEUR_MOT_DE_PASSE} caracteres`);
        }
        try {
            empreinte = await motdepasse.hacher(enClair);
        } catch (err) {
            throw new ErreurClient(err.message);
        }
    }

    const { rows } = await db.requete(
        `INSERT INTO utilisateur
             (courriel, nom, prenom, mot_de_passe_hash, autorise_google, mot_de_passe_a_definir)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, courriel, nom, prenom, est_actif, est_admin, devise,
                   autorise_google, est_bloque, mot_de_passe_a_definir, cree_le`,
        [adresse, nom, prenom, empreinte, autoriseGoogle, aDefinir]
    );

    let lien = null;
    let envoye = false;

    if (aDefinir) {
        lien = await preparerLienMotDePasse(rows[0].id, req);

        if (courriel.estConfigure()) {
            try {
                await courriel.envoyer({
                    destinataire: adresse,
                    sujet: 'Votre accès à Suivi crypto',
                    texte: [
                        `Bonjour ${prenom},`,
                        '',
                        'Un compte vient de vous être créé sur Suivi crypto.',
                        'Choisissez votre mot de passe avec le lien ci-dessous :',
                        '',
                        lien,
                        '',
                        "Ce lien est valable une heure et ne peut servir qu'une fois.",
                    ].join('\r\n'),
                });
                envoye = true;
                // Courriel parti : inutile d'exposer le jeton une seconde fois
                lien = null;
            } catch (err) {
                console.error("Envoi du courriel de création de compte :", err.message);
            }
        }
    }

    return {
        code: 201,
        corps: { utilisateur: comptePublic(rows[0]), lien, courriel_envoye: envoye },
    };
});

// Relève d'une période chez Binance, à la demande d'un administrateur.
// Une seule requête sortante couvre jusqu'à 1000 jours.
route('POST', '/api/crypto/administration/valeurs/relever', async ({ req, corps }) => {
    await exigerAdmin(req);

    const debut = exigerTexte(corps, 'debut');
    const fin = exigerTexte(corps, 'fin');
    const ecraser = corps.ecraser === true;

    // Sans crypto précisée, toutes celles qui ont une paire Binance
    let cibles;
    if (corps.id_crypto) {
        cibles = [String(corps.id_crypto).toUpperCase()];
    } else {
        const { rows } = await db.requete(
            'SELECT id FROM crypto WHERE paire_binance IS NOT NULL ORDER BY id'
        );
        cibles = rows.map((ligne) => ligne.id);
    }

    const bilans = [];
    for (const id of cibles) {
        try {
            bilans.push(await valeurs.releverPeriode(id, debut, fin, ecraser));
        } catch (err) {
            bilans.push({ id_crypto: id, releves: 0, ignorees: 0, erreur: err.message });
        }
    }

    return { code: 200, corps: { debut, fin, ecraser, bilans } };
});

// Une valeur erronée doit pouvoir être retirée, pour être relevée à nouveau.
route('DELETE', '/api/crypto/administration/valeurs/:crypto/:date', async ({ req, params }) => {
    await exigerAdmin(req);

    const { rows } = await db.requete(
        'DELETE FROM crypto_valeur WHERE id_crypto = $1 AND date = $2::date RETURNING id_crypto',
        [params.crypto.toUpperCase(), params.date]
    );
    if (!rows.length) throw new ErreurClient('Valeur introuvable', 404);
    return { code: 200, corps: { statut: 'valeur supprimee' } };
});


// --- Fichiers de l'interface web -------------------------------------------
const RACINE_WEB = path.resolve(__dirname, '..', 'web');
// Images partagees entre le site et le mobile, servies sous /image/
const RACINE_IMAGE = path.resolve(__dirname, '..', '_commun', 'image');
const PREFIXE_IMAGE = '/image/';

const TYPES_MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.webmanifest': 'application/manifest+json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
};

async function servirFichier(chemin, res) {
    const demande = chemin === '/' ? '/index.html' : chemin;

    const dansImages = demande.startsWith(PREFIXE_IMAGE);
    const racine = dansImages ? RACINE_IMAGE : RACINE_WEB;
    const relatif = dansImages ? demande.slice(PREFIXE_IMAGE.length - 1) : demande;

    // Le chemin resolu doit rester sous sa racine : bloque les remontees ../
    const fichier = path.resolve(racine, '.' + relatif);
    if (fichier !== racine && !fichier.startsWith(racine + path.sep)) {
        return repondre(res, 403, { erreur: 'Acces refuse' });
    }

    let contenu;
    try {
        contenu = await fs.promises.readFile(fichier);
    } catch (err) {
        if (err.code === 'ENOENT' || err.code === 'EISDIR') {
            return repondre(res, 404, { erreur: 'Page introuvable' });
        }
        throw err;
    }

    res.writeHead(200, {
        'Content-Type': TYPES_MIME[path.extname(fichier).toLowerCase()] || 'application/octet-stream',
        'Content-Length': contenu.length,
        'Cache-Control': 'no-cache',
    });
    res.end(contenu);
}

// --- Serveur ---------------------------------------------------------------
const serveur = http.createServer(async (req, res) => {
    let url;
    try {
        url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch (e) {
        return repondre(res, 400, { erreur: 'URL invalide' });
    }

    const correspondances = routes
        .map((r) => ({ r, m: r.regex.exec(url.pathname) }))
        .filter(({ m }) => m !== null);

    const trouvee = correspondances.find(({ r }) => r.methode === req.method);

    if (!trouvee) {
        // Hors API, les requetes de lecture sont servies par les fichiers du site
        if (!url.pathname.startsWith('/api/') && (req.method === 'GET' || req.method === 'HEAD')) {
            try {
                return await servirFichier(url.pathname, res);
            } catch (err) {
                console.error('Erreur de lecture de fichier :', err);
                return repondre(res, 500, { erreur: 'Erreur interne' });
            }
        }
        return repondre(res, correspondances.length ? 405 : 404, { erreur: 'Route inconnue' });
    }

    try {
        const params = {};
        trouvee.r.noms.forEach((nom, i) => { params[nom] = decodeURIComponent(trouvee.m[i + 1]); });

        const corps = (req.method === 'POST' || req.method === 'PUT') ? await lireCorps(req) : {};
        const resultat = await trouvee.r.gestionnaire({ params, corps, url, req });

        // Une route peut renvoyer autre chose que du JSON (une image, par exemple)
        if (resultat.brut) {
            res.writeHead(resultat.code, resultat.brut.entetes);
            return res.end(resultat.brut.contenu);
        }

        repondre(res, resultat.code, resultat.corps);
    } catch (err) {
        if (err instanceof ErreurClient) {
            return repondre(res, err.code, { erreur: err.message });
        }
        if (err.code === '23505') {
            return repondre(res, 409, { erreur: 'Enregistrement deja existant' });
        }
        if (err.code === '23503' || err.code === '23514') {
            return repondre(res, 400, { erreur: 'Donnees invalides au regard du schema' });
        }
        console.error('Erreur serveur :', err);
        repondre(res, 500, { erreur: 'Erreur interne' });
    }
});

serveur.listen(PORT, HOTE, () => {
    console.log(`API crypto active sur http://${HOTE}:${PORT}`);
});

// Purge des sessions expirees, au demarrage puis toutes les six heures
const INTERVALLE_PURGE = 6 * 60 * 60 * 1000;
function purger() {
    auth.purgerSessionsExpirees()
        .then((nombre) => { if (nombre) console.log('Sessions expirees supprimees :', nombre); })
        .catch((err) => console.error('Echec de la purge des sessions :', err.message));
}
purger();
const minuterie = setInterval(purger, INTERVALLE_PURGE);
minuterie.unref();

function arreter() {
    serveur.close(() => db.fermer());
}
process.on('SIGTERM', arreter);
process.on('SIGINT', arreter);

module.exports = serveur;
