// API de l'application crypto - Node natif + PostgreSQL (NAS Synology)
const http = require('http');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const db = require('../../_commun/api/db');
const auth = require('./authentification');
const google = require('./google');
const marche = require('./marche');
const actualites = require('./actualites');
const valeurs = require('./valeurs');
const plusvalues = require('./plusvalues');
const sauvegarde = require('./sauvegarde');
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

// --- Version ---------------------------------------------------------------
// En production, l'image n'embarque pas le depot git : la commande de
// deploiement transmet le commit, sa date et l'instant du deploiement en
// arguments de construction. Sur le poste, la version se lit dans git et
// le site n'a pas de date de deploiement.
function lireGit(args) {
    try {
        return execFileSync('git', args, {
            cwd: path.join(__dirname, '..', '..', '..'),
            encoding: 'utf8',
            timeout: 5000,
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim() || null;
    } catch (err) {
        console.error(`Version du site illisible dans git (${err.code || err.message})`);
        return null;
    }
}

const VERSION = {
    commit: process.env.VERSION_COMMIT || lireGit(['rev-parse', '--short', 'HEAD']),
    date_version: process.env.VERSION_DATE || lireGit(['log', '-1', '--format=%cI']),
    deploye_le: process.env.DEPLOYE_LE || null,
};

route('GET', '/api/crypto/version', async ({ req }) => {
    await exigerConnexion(req);
    return { code: 200, corps: VERSION };
});

// Reglages publics dont l'interface a besoin. Aucun secret ici :
// l'identifiant client Google est destine a etre expose au navigateur.
route('GET', '/api/crypto/configuration', async () => ({
    code: 200,
    corps: { google_client_id: process.env.GOOGLE_CLIENT_ID || null },
}));

// --- Marche et actualites (acces public) -----------------------------------
// Ces routes sont ouvertes : les informations sont affichees avant connexion,
// sur le site comme dans l'application mobile.
route('GET', '/api/crypto/marche/cours', async ({ url }) => {
    try {
        const donnees = await marche.cours(url.searchParams.get('devise'), url.searchParams.get('forcer') === '1');
        return { code: 200, corps: donnees };
    } catch (err) {
        throw new ErreurClient(err.message, 503);
    }
});

// Evolution du cours sur une periode glissante (jours=1, 7, 30, 90 ou 365 ;
// 24 heures par defaut), pour les graphiques. Publique comme les cours eux-memes.
route('GET', '/api/crypto/marche/historique/:actif', async ({ params, url }) => {
    try {
        const donnees = await marche.historique(params.actif, url.searchParams.get('devise'),
            url.searchParams.get('forcer') === '1', url.searchParams.get('jours'));
        return { code: 200, corps: donnees };
    } catch (err) {
        throw new ErreurClient(err.message, Number.isInteger(err.code) ? err.code : 503);
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

// actives=1 : uniquement les cryptos encore suivies. Une crypto desactivee
// disparait des choix proposes, mais reste visible dans l'administration.
// Les compteurs servent a prevenir de ce qu'une suppression emporterait.
route('GET', '/api/crypto/cryptos', async ({ url }) => {
    const seulementActives = url.searchParams.get('actives') === '1';

    const { rows } = await db.requete(
        `SELECT c.id, c.libelle, c.identifiant_coingecko, c.paire_binance,
                c.est_suivi, c.logo_url, c.cree_le,
                (SELECT count(*)::int FROM operation o WHERE o.id_crypto = c.id) AS operations,
                (SELECT count(*)::int FROM crypto_valeur v WHERE v.id_crypto = c.id) AS valeurs
         FROM crypto c
         ${seulementActives ? 'WHERE c.est_suivi' : ''}
         ORDER BY c.est_suivi DESC, c.id`
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

// Les cent plus grosses capitalisations, pour alimenter la saisie d'une crypto.
// Reserve aux administrateurs : c'est le seul endroit qui s'en sert.
route('GET', '/api/crypto/administration/catalogue-cryptos', async ({ req }) => {
    await exigerAdmin(req);
    try {
        return { code: 200, corps: await marche.catalogue() };
    } catch (err) {
        throw new ErreurClient(err.message, 503);
    }
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
    const logo = corps.logo_url ? String(corps.logo_url).trim() : null;

    const { rows } = await db.requete(
        `INSERT INTO crypto (id, libelle, identifiant_coingecko, paire_binance, est_suivi, logo_url)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE
             SET libelle = EXCLUDED.libelle,
                 identifiant_coingecko = EXCLUDED.identifiant_coingecko,
                 paire_binance = EXCLUDED.paire_binance,
                 est_suivi = EXCLUDED.est_suivi,
                 logo_url = COALESCE(EXCLUDED.logo_url, crypto.logo_url)
         RETURNING id, libelle, identifiant_coingecko, paire_binance, est_suivi, logo_url, cree_le`,
        [id, libelle, coingecko, paire, suivi, logo]
    );

    marche.viderCache();
    return { code: 201, corps: rows[0] };
});

// Une crypto encore utilisee par une operation n'est pas supprimable :
// l'historique d'un utilisateur ne doit pas perdre sa reference.
// cascade=1 : l'administrateur a confirme emporter les operations avec la crypto.
// Sans ce drapeau, une crypto utilisee reste protegee.
route('DELETE', '/api/crypto/cryptos/:id', async ({ req, params, url }) => {
    await exigerAdmin(req);
    const id = params.id.toUpperCase();
    const cascade = url.searchParams.get('cascade') === '1';

    const { rows: usage } = await db.requete(
        'SELECT count(*)::int AS n FROM operation WHERE id_crypto = $1',
        [id]
    );

    if (usage[0].n > 0 && !cascade) {
        throw new ErreurClient(
            `Suppression refusée : ${usage[0].n} opération(s) utilisent cette crypto. `
            + 'Confirmez la suppression en cascade pour les emporter avec elle.',
            409
        );
    }

    // Les operations n'ont pas de suppression en cascade cote schema : elles
    // sont retirees explicitement, dans la meme transaction que la crypto,
    // pour qu'un echec ne laisse jamais la moitie du travail fait.
    const supprimee = await db.transaction(async (client) => {
        if (usage[0].n > 0) {
            await client.query('DELETE FROM operation WHERE id_crypto = $1', [id]);
        }
        const { rows } = await client.query('DELETE FROM crypto WHERE id = $1 RETURNING id', [id]);
        return rows[0];
    });

    if (!supprimee) throw new ErreurClient('Crypto introuvable', 404);

    marche.viderCache();
    return { code: 200, corps: { statut: 'crypto supprimee', id, operations: usage[0].n } };
});

// --- Plateformes -----------------------------------------------------------
route('GET', '/api/crypto/plateformes', async ({ url }) => {
    // actives=1 : uniquement celles encore proposees a la saisie
    const seulementActives = url.searchParams.get('actives') === '1';
    const { rows } = await db.requete(
        'SELECT libelle, est_actif, frais_defaut, cree_le FROM plateforme'
        + (seulementActives ? ' WHERE est_actif' : '')
        + ' ORDER BY est_actif DESC, libelle'
    );
    return { code: 200, corps: rows };
});

route('POST', '/api/crypto/plateformes', async ({ req, corps }) => {
    await exigerAdmin(req);

    // Le libellé est la clé ; ancien_libelle permet de renommer une plateforme,
    // la contrainte ON UPDATE CASCADE reporte le nouveau nom sur les opérations.
    // frais_defaut, facultatif, pré-remplit les frais à la saisie d'une opération.
    const libelle = exigerTexte(corps, 'libelle');
    const actif = corps.est_actif === undefined ? true : corps.est_actif === true;
    const ancien = corps.ancien_libelle ? String(corps.ancien_libelle).trim() : null;
    const fraisDefaut = exigerDecimal(corps, 'frais_defaut', false);

    // Modification : ancien_libelle designe la ligne a mettre a jour
    if (ancien) {
        const { rows } = await db.requete(
            `UPDATE plateforme SET libelle = $2, est_actif = $3, frais_defaut = $4
             WHERE libelle = $1
             RETURNING libelle, est_actif, frais_defaut, cree_le`,
            [ancien, libelle, actif, fraisDefaut]
        );
        if (!rows.length) throw new ErreurClient('Plateforme introuvable', 404);
        return { code: 200, corps: rows[0] };
    }

    // Creation : un doublon doit echouer, pas ecraser la plateforme existante.
    // L'index unique sur lower(libelle) attrape aussi « kraken » face a « Kraken ».
    const { rows: existante } = await db.requete(
        'SELECT libelle FROM plateforme WHERE lower(libelle) = lower($1)',
        [libelle]
    );
    if (existante.length) {
        throw new ErreurClient(
            `La plateforme « ${existante[0].libelle} » existe déjà.`,
            409
        );
    }

    const { rows } = await db.requete(
        `INSERT INTO plateforme (libelle, est_actif, frais_defaut) VALUES ($1, $2, $3)
         RETURNING libelle, est_actif, frais_defaut, cree_le`,
        [libelle, actif, fraisDefaut]
    );
    return { code: 201, corps: rows[0] };
});

route('DELETE', '/api/crypto/plateformes/:libelle', async ({ req, params }) => {
    await exigerAdmin(req);
    const libelle = params.libelle;

    const { rows: usage } = await db.requete(
        'SELECT count(*)::int AS n FROM operation WHERE plateforme = $1',
        [libelle]
    );
    if (usage[0].n > 0) {
        throw new ErreurClient(
            `Suppression refusée : ${usage[0].n} opération(s) référencent cette plateforme.`,
            409
        );
    }

    const { rows } = await db.requete(
        'DELETE FROM plateforme WHERE libelle = $1 RETURNING libelle',
        [libelle]
    );
    if (!rows.length) throw new ErreurClient('Plateforme introuvable', 404);
    return { code: 200, corps: { statut: 'plateforme supprimee', libelle } };
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

// Montant total de l'operation : negatif quand l'argent sort (achat), positif
// quand il rentre (vente). Les frais suivent le meme sens. Une recompense de
// staking ne deplace aucun argent : elle n'a pas de montant, meme si sa valeur
// a la reception est renseignee.
const MONTANT_SQL = `CASE
        WHEN o.type = 'staking' THEN NULL
        WHEN o.prix_unitaire IS NULL THEN NULL
        WHEN o.type = 'achat' THEN -(o.quantite * o.prix_unitaire + o.frais)
        ELSE (o.quantite * o.prix_unitaire - o.frais)
    END`;

const CHAMPS_OPERATION = `o.id, o.horodatage, o.type, o.id_crypto, c.libelle,
                o.quantite, o.plateforme,
                o.prix_unitaire, o.frais, ${MONTANT_SQL}::text AS montant, o.cree_le`;

// Le staking fait entrer de la crypto comme un achat, mais sans contrepartie
// en argent : ni frais, ni prix d'acquisition a imputer.
const TYPES_OPERATION = ['achat', 'vente', 'staking'];

// Conventions admises pour le prix d'acquisition d'une recompense de staking
const STAKING_ACQUISITION = ['nulle', 'valeur_recue'];

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

    const type = url.searchParams.get('type');
    if (type) {
        if (!TYPES_OPERATION.includes(type)) {
            throw new ErreurClient(`Filtre type : ${TYPES_OPERATION.join(', ')} attendu`);
        }
        valeurs.push(type);
        conditions.push(`o.type = $${valeurs.length}`);
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

// Plus-values de cession de l'annee demandee, detaillees par crypto. Le calcul
// porte sur tout l'historique du compte, pas sur la seule annee affichee :
// c'est la seule facon d'imputer les fractions de capital initial deja
// consommees par les cessions anterieures.
route('GET', '/api/crypto/plus-values', async ({ req, url }) => {
    const utilisateur = await exigerConnexion(req);
    const demandee = url.searchParams.get('annee');
    const anneeCourante = Number(valeurs.jourParis(new Date()).slice(0, 4));
    const annee = demandee ? exigerEntier(demandee, 'annee') : anneeCourante;

    // Les cours servent au tri, et pour l'année en cours à simuler la vente de
    // ce qui est encore détenu : sans eux, seules les cessions réelles restent.
    let cotees = [];
    let marcheEur = null;
    let coursIndisponible = null;
    try {
        marcheEur = await marche.cours('eur');
        cotees = marcheEur.actifs.filter((actif) => actif.prix !== null);
    } catch (err) {
        console.error('Cours indisponibles pour les plus-values :', err.message);
        coursIndisponible = err.message;
    }

    const simulation = annee === anneeCourante
        ? {
            cotees: marcheEur ? cotees : null,
            source: marcheEur ? marcheEur.source : null,
            releve_le: marcheEur ? marcheEur.releve_le : null,
            cours_indisponible: coursIndisponible,
        }
        : null;

    const bilan = await plusvalues.parAnnee(utilisateur.id, annee, simulation);

    // Les cryptos se suivent comme dans « Mes cryptos » : par valeur détenue en
    // euro, décroissante. Une crypto entièrement cédée, ou sans cours, finit la
    // liste dans l'ordre alphabétique. Le produit est calculé en NUMERIC par
    // PostgreSQL : seul le rang revient au serveur, jamais un montant en flottant.
    if (bilan.cryptos.length > 1) {
        const { rows } = await db.requete(
            `WITH detention AS (
                 SELECT o.id_crypto,
                        c.libelle,
                        SUM(CASE WHEN o.type = 'vente' THEN -o.quantite ELSE o.quantite END) AS quantite
                 FROM operation o
                 JOIN crypto c ON c.id = o.id_crypto
                 WHERE o.utilisateur_id = $1
                 GROUP BY o.id_crypto, c.libelle
             ),
             cours AS (
                 SELECT * FROM unnest($2::text[], $3::numeric[]) AS t(id_crypto, prix)
             )
             SELECT d.id_crypto
             FROM detention d
             LEFT JOIN cours k ON k.id_crypto = d.id_crypto
             ORDER BY CASE WHEN d.quantite > 0 THEN d.quantite * k.prix END DESC NULLS LAST, d.libelle`,
            [utilisateur.id, cotees.map((actif) => actif.symbole), cotees.map((actif) => actif.prix)]
        );

        const rangs = new Map(rows.map((ligne, rang) => [ligne.id_crypto, rang]));
        const rangDe = (crypto) => (rangs.has(crypto.id_crypto) ? rangs.get(crypto.id_crypto) : rows.length);
        bilan.cryptos.sort((a, b) => rangDe(a) - rangDe(b));
    }

    return { code: 200, corps: bilan };
});

// Declaration fiscale du compte connecte : les annees de cession, puis pour
// l'une d'elles le detail du formulaire 2086 et la case de la 2042-C.
// Reservee aux administrateurs, comme toute route sous /administration/.
route('GET', '/api/crypto/administration/declaration', async ({ req }) => {
    const utilisateur = await exigerAdmin(req);
    return { code: 200, corps: await plusvalues.parAnnees(utilisateur.id) };
});

route('GET', '/api/crypto/administration/declaration/:annee', async ({ req, params }) => {
    const utilisateur = await exigerAdmin(req);
    const annee = exigerEntier(params.annee, 'annee');
    return { code: 200, corps: await plusvalues.declaration(utilisateur.id, annee) };
});

function lireOperation(corps) {
    const type = exigerTexte(corps, 'type').toLowerCase();
    if (!TYPES_OPERATION.includes(type)) {
        throw new ErreurClient(`Champ type : ${TYPES_OPERATION.join(', ')} attendu`);
    }

    const frais = exigerDecimal(corps, 'frais', false) || '0';

    // Une recompense de staking ne s'achete pas : des frais dessus ne veulent
    // rien dire. Refuses plutot que ramenes a zero en silence, pour que la
    // saisie soit corrigee la ou elle est fausse.
    if (type === 'staking' && Number(frais) !== 0) {
        throw new ErreurClient('Une opération de staking ne porte pas de frais');
    }

    return {
        type,
        idCrypto: exigerTexte(corps, 'id_crypto').toUpperCase(),
        quantite: exigerDecimal(corps, 'quantite'),
        horodatage: exigerDate(corps.horodatage, 'horodatage'),
        plateforme: corps.plateforme ? String(corps.plateforme).trim() : null,
        prixUnitaire: exigerDecimal(corps, 'prix_unitaire', false),
        frais,
    };
}

// Une vente est une cession imposable : la valeur du jour de toutes les cryptos
// detenues est relevee, car c'est elle qui servira a calculer la valeur globale
// du portefeuille au moment de la cession. Relevee le jour meme, elle ne porte
// qu'une bougie partielle : les journees de vente anterieures restees
// incompletes sont donc terminees dans la foulee. Un echec de la source ne fait
// pas echouer l'enregistrement de l'operation : le releve pourra etre rejoue.
// Une journee sans valorisation sous-evalue le portefeuille au moment de la
// cession. L'interface ne lit pas encore le bilan renvoye par l'API : le
// journal du serveur est pour l'instant le seul endroit ou cela se voit.
function journaliserEchecs(echecs) {
    (echecs || []).forEach((echec) => {
        console.error('Valeur journalière non relevée :',
            echec.id_crypto || '?', echec.jour || '', echec.raison);
    });
}

async function releverSiVente(utilisateurId, operation) {
    if (operation.type !== 'vente') return null;
    try {
        const bilan = await valeurs.releverPourUtilisateur(
            utilisateurId,
            valeurs.jourParis(new Date(operation.horodatage))
        );
        bilan.reprise = await valeurs.completerPartielles(utilisateurId);
        journaliserEchecs(bilan.echecs);
        journaliserEchecs(bilan.reprise.echecs);
        return bilan;
    } catch (err) {
        console.error('Relevé des valeurs après une vente :', err.message);
        return { jour: null, releves: [], deja: [], echecs: [{ raison: err.message }] };
    }
}

// Les journees de vente relevees avant leur cloture ne portent qu'une moyenne
// partielle. La reprise est lancee a la connexion, en arriere-plan : elle ne
// doit ni retarder ni faire echouer l'ouverture de la session.
function completerValeursEnFond(utilisateurId) {
    valeurs.completerPartielles(utilisateurId)
        .then((bilan) => {
            if (bilan.completees.length) {
                console.log('Valeurs journalières complétées :', bilan.completees.length);
            }
            journaliserEchecs(bilan.echecs);
        })
        .catch((err) => console.error('Reprise des valeurs journalières :', err.message));
}

route('POST', '/api/crypto/operations', async ({ req, corps }) => {
    const utilisateur = await exigerConnexion(req);
    const saisie = lireOperation(corps);

    const { rows } = await db.requete(
        `INSERT INTO operation
             (utilisateur_id, horodatage, type, id_crypto, quantite, plateforme,
              prix_unitaire, frais)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [utilisateur.id, saisie.horodatage, saisie.type, saisie.idCrypto, saisie.quantite,
         saisie.plateforme, saisie.prixUnitaire, saisie.frais]
    );

    const bilan = await releverSiVente(utilisateur.id, saisie);
    const complete = await db.requete(
        `SELECT ${CHAMPS_OPERATION}
         FROM operation o
         JOIN crypto c ON c.id = o.id_crypto
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
         SET horodatage = $3, type = $4, id_crypto = $5, quantite = $6,
             plateforme = $7, prix_unitaire = $8, frais = $9
         WHERE id = $1 AND utilisateur_id = $2
         RETURNING id`,
        [id, utilisateur.id, saisie.horodatage, saisie.type, saisie.idCrypto,
         saisie.quantite, saisie.plateforme, saisie.prixUnitaire, saisie.frais]
    );
    if (!rows.length) throw new ErreurClient('Opération introuvable', 404);

    const bilan = await releverSiVente(utilisateur.id, saisie);
    const complete = await db.requete(
        `SELECT ${CHAMPS_OPERATION}
         FROM operation o
         JOIN crypto c ON c.id = o.id_crypto
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
// Chaque ligne est valorisée au cours en euro du moment : le prix arrive de la
// source en chaîne et le total est calculé en NUMERIC, jamais en flottant. Les
// lignes sont triées par total décroissant ; une crypto sans cours finit la liste.
route('GET', '/api/crypto/mon-portefeuille', async ({ req }) => {
    const utilisateur = await exigerConnexion(req);

    // Sans cours, les quantités restent affichées : la réponse le signale
    let marcheEur = null;
    let coursIndisponible = null;
    try {
        marcheEur = await marche.cours('eur');
    } catch (err) {
        console.error('Cours indisponibles pour le portefeuille :', err.message);
        coursIndisponible = err.message;
    }
    const cotees = (marcheEur ? marcheEur.actifs : []).filter((actif) => actif.prix !== null);

    const { rows } = await db.requete(
        `WITH detention AS (
             SELECT o.id_crypto,
                    c.libelle,
                    SUM(CASE WHEN o.type = 'vente' THEN -o.quantite ELSE o.quantite END) AS quantite,
                    count(*)::int AS operations
             FROM operation o
             JOIN crypto c ON c.id = o.id_crypto
             WHERE o.utilisateur_id = $1
             GROUP BY o.id_crypto, c.libelle
             HAVING SUM(CASE WHEN o.type = 'vente' THEN -o.quantite ELSE o.quantite END) > 0
         ),
         cours AS (
             SELECT * FROM unnest($2::text[], $3::numeric[]) AS t(id_crypto, prix)
         )
         SELECT d.id_crypto,
                d.libelle,
                d.quantite::text AS quantite,
                d.operations,
                k.prix::text AS prix,
                (d.quantite * k.prix)::text AS total
         FROM detention d
         LEFT JOIN cours k ON k.id_crypto = d.id_crypto
         ORDER BY d.quantite * k.prix DESC NULLS LAST, d.libelle`,
        [utilisateur.id, cotees.map((actif) => actif.symbole), cotees.map((actif) => actif.prix)]
    );

    // Total du portefeuille, additionné par PostgreSQL : seules les lignes
    // cotées y entrent, les autres sont comptées pour que l'écran le dise.
    const valorisees = rows.filter((ligne) => ligne.total !== null).map((ligne) => ligne.total);
    const { rows: [somme] } = await db.requete(
        'SELECT COALESCE(SUM(v), 0)::text AS total FROM unnest($1::numeric[]) AS v',
        [valorisees]
    );

    return {
        code: 200,
        corps: {
            lignes: rows,
            total: valorisees.length ? somme.total : null,
            lignes_sans_cours: rows.length - valorisees.length,
            devise: 'EUR',
            source: marcheEur ? marcheEur.source : null,
            releve_le: marcheEur ? marcheEur.releve_le : null,
            cours_indisponible: coursIndisponible,
        },
    };
});

// Detail d'une crypto du portefeuille : quantite, cours, valeur, prix moyen
// d'acquisition et performance latente.
//
// Le prix moyen suit la methode du cout moyen pondere, operation par operation :
// un achat ajoute sa quantite et son cout (frais compris), une vente retire sa
// quantite au prix moyen du moment, sans le modifier. Un simple quotient des
// achats par les quantites achetees serait faux des qu'un rachat suit une vente.
// Le staking ajoute sa quantite ; son cout suit la convention du compte, comme
// pour les plus-values : nul, ou valeur a la reception.
//
// Tout le calcul est fait en NUMERIC par PostgreSQL ; le cours arrive de la
// source en chaine et ne passe jamais par un flottant.
const SUIVI_POSITION = `
WITH RECURSIVE ops AS (
    SELECT row_number() OVER (ORDER BY o.horodatage, o.id) AS rang,
           o.type,
           o.quantite::numeric AS quantite,
           CASE WHEN o.type = 'achat'
                    THEN o.quantite * COALESCE(o.prix_unitaire, 0) + o.frais
                WHEN o.type = 'staking' AND $3
                    THEN o.quantite * COALESCE(o.prix_unitaire, 0)
                ELSE 0 END::numeric AS cout
    FROM operation o
    WHERE o.utilisateur_id = $1 AND o.id_crypto = $2
),
suivi (rang, quantite, cout) AS (
    SELECT 0::bigint, 0::numeric, 0::numeric
    UNION ALL
    SELECT o.rang,
           CASE WHEN o.type = 'vente' THEN s.quantite - o.quantite
                ELSE s.quantite + o.quantite END,
           CASE WHEN o.type <> 'vente' THEN s.cout + o.cout
                WHEN s.quantite > 0
                    THEN s.cout * GREATEST(s.quantite - o.quantite, 0) / s.quantite
                ELSE 0 END
    FROM suivi s
    JOIN ops o ON o.rang = s.rang + 1
),
position_finale AS (
    SELECT quantite, cout FROM suivi ORDER BY rang DESC LIMIT 1
)
SELECT (SELECT count(*)::int FROM ops) AS operations,
       p.quantite::text AS quantite,
       p.cout::text AS cout_acquisition,
       CASE WHEN p.quantite > 0 THEN (p.cout / p.quantite)::text END AS prix_moyen,
       $4::numeric::text AS cours,
       (p.quantite * $4::numeric)::text AS valeur,
       (p.quantite * $4::numeric - p.cout)::text AS performance,
       CASE WHEN p.cout > 0
            THEN ((p.quantite * $4::numeric - p.cout) / p.cout * 100)::text END
           AS performance_pourcentage
FROM position_finale p`;

route('GET', '/api/crypto/mon-portefeuille/:id', async ({ req, params }) => {
    const utilisateur = await exigerConnexion(req);
    const idCrypto = decodeURIComponent(params.id).trim().toUpperCase();

    const { rows: cryptos } = await db.requete(
        'SELECT id, libelle, identifiant_coingecko FROM crypto WHERE id = $1',
        [idCrypto]
    );
    if (!cryptos.length) throw new ErreurClient('Crypto introuvable', 404);
    const crypto = cryptos[0];

    // Sans cours, la position reste lisible : seules valeur et performance manquent
    let marcheEur = null;
    let coursIndisponible = null;
    try {
        marcheEur = await marche.cours('eur');
    } catch (err) {
        console.error('Cours indisponibles pour %s :', idCrypto, err.message);
        coursIndisponible = err.message;
    }
    const cote = marcheEur
        ? marcheEur.actifs.find((actif) => actif.symbole === idCrypto && actif.prix !== null)
        : null;
    if (marcheEur && !cote) coursIndisponible = `Aucun cours ${marcheEur.source} pour ${idCrypto}`;

    const { rows } = await db.requete(SUIVI_POSITION, [
        utilisateur.id,
        idCrypto,
        utilisateur.staking_acquisition === 'valeur_recue',
        cote ? cote.prix : null,
    ]);
    const position = rows[0];
    if (!position.operations) {
        throw new ErreurClient('Aucune opération enregistrée sur cette crypto', 404);
    }

    return {
        code: 200,
        corps: {
            id_crypto: crypto.id,
            libelle: crypto.libelle,
            identifiant_coingecko: crypto.identifiant_coingecko,
            devise: 'EUR',
            ...position,
            variation_24h: cote ? cote.variation_24h : null,
            staking_acquisition: utilisateur.staking_acquisition,
            source: marcheEur ? marcheEur.source : null,
            releve_le: marcheEur ? marcheEur.releve_le : null,
            cours_indisponible: coursIndisponible,
        },
    };
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
        plateforme_defaut: ligne.plateforme_defaut,
        staking_acquisition: ligne.staking_acquisition,
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
// Le blocage est temporaire : sur un site public, n'importe qui pourrait
// sinon verrouiller un compte en tapant son adresse avec un faux mot de passe.
const MAX_TENTATIVES = 3;
const DUREE_BLOCAGE_MINUTES = 15;
const DUREE_REINITIALISATION = 60 * 60 * 1000;

// Limiteur en memoire : au plus `max` essais par cle sur une fenetre fixe.
// Chaque essai est reserve avant tout await : reserver() est synchrone, et
// JavaScript ne l'interrompt pas, deux requetes simultanees ne lisent donc
// jamais le meme compteur ni ne franchissent le controle ensemble.
function creerLimiteur({ max, fenetre, message }) {
    const suivis = new Map();

    // Renvoie true si la limite etait deja atteinte ; sinon compte l'essai
    function depasse(cle) {
        const maintenant = Date.now();
        let suivi = suivis.get(cle);
        if (!suivi || maintenant - suivi.debut > fenetre) {
            suivi = { nombre: 0, debut: maintenant };
            suivis.set(cle, suivi);
        }
        if (suivi.nombre >= max) return true;
        suivi.nombre += 1;
        return false;
    }

    setInterval(() => {
        const maintenant = Date.now();
        for (const [cle, suivi] of suivis) {
            if (maintenant - suivi.debut > fenetre) suivis.delete(cle);
        }
    }, fenetre).unref();

    return {
        depasse,
        reserver(cle) {
            if (depasse(cle)) throw new ErreurClient(message, 429);
        },
        // Rend un essai sans effacer les autres
        rendre(cle) {
            const suivi = suivis.get(cle);
            if (suivi && suivi.nombre > 0) suivi.nombre -= 1;
        },
    };
}

// Limite par adresse IP : freine les essais en serie sur plusieurs comptes,
// que le compteur par compte ne voit pas.
const limiteConnexionIp = creerLimiteur({
    max: 10,
    fenetre: 15 * 60 * 1000,
    message: 'Trop de tentatives de connexion. Réessayez dans quelques minutes.',
});

// L'API n'ecoute que sur la boucle locale, derriere le proxy inverse de DSM :
// X-Real-IP, pose par le proxy, est donc fiable.
function adresseClient(req) {
    return req.headers['x-real-ip'] || req.socket.remoteAddress || 'inconnue';
}

// Le scrypt occupe les threads de Node : au-dela de ce nombre de verifications
// simultanees, une rafale venue de nombreuses adresses ralentirait tout le site.
// La place est prise avant le premier await : le controle ne se franchit pas
// a plusieurs en meme temps.
const MAX_VERIFICATIONS_SIMULTANEES = 8;
let verificationsEnCours = 0;

async function sousPlafond(travail) {
    if (verificationsEnCours >= MAX_VERIFICATIONS_SIMULTANEES) {
        throw new ErreurClient('Serveur occupé, réessayez dans un instant.', 503);
    }
    verificationsEnCours += 1;
    try {
        return await travail();
    } finally {
        verificationsEnCours -= 1;
    }
}

// Empreinte d'un mot de passe que personne ne connait, aux memes parametres
// qu'une vraie : une adresse sans compte coute alors le meme scrypt qu'une
// adresse existante, et le delai de reponse ne trahit rien.
const EMPREINTE_FACTICE = motdepasse.hacher(crypto.randomBytes(16).toString('hex'));
EMPREINTE_FACTICE.catch((err) => console.error('Empreinte factice de connexion :', err));

const CHAMPS_COMPTE = `id, courriel, nom, prenom, est_actif, est_admin, devise,
                autorise_google, est_bloque, mot_de_passe_a_definir, plateforme_defaut, staking_acquisition, cree_le`;

// Une seule reponse pour tout echec : adresse inconnue, mauvais mot de passe,
// compte bloque ou desactive. Toute difference dirait quelles adresses existent,
// ou confirmerait un mot de passe. Le titulaire est quand meme prevenu du blocage.
function echecConnexion() {
    return new ErreurClient(
        `Courriel ou mot de passe incorrect. Après ${MAX_TENTATIVES} échecs, `
        + `le compte est bloqué ${DUREE_BLOCAGE_MINUTES} minutes.`,
        401
    );
}

route('POST', '/api/crypto/connexion', async ({ corps, req }) => {
    const ip = adresseClient(req);
    limiteConnexionIp.reserver(ip);

    const adresse = exigerCourriel(corps);
    const enClair = exigerTexte(corps, 'mot_de_passe');

    const { ligne, valide } = await sousPlafond(async () => {
        // Sans attente d'ecriture sur disque, un compteur qui avance coute le
        // meme delai qu'une adresse inconnue, qui n'ecrit rien : le temps de
        // reponse ne distingue plus les deux. En cas de panne de la base dans
        // la fraction de seconde qui suit, un essai pourrait ne pas etre compte.
        const rows = await db.transaction(async (client) => {
            await client.query('SET LOCAL synchronous_commit TO OFF');

            // Un blocage echu est leve avant tout : le compte repart de zero
            await client.query(
                `UPDATE utilisateur SET est_bloque = FALSE, tentatives_echouees = 0, bloque_le = NULL
                 WHERE courriel = $1 AND est_bloque
                   AND (bloque_le IS NULL OR bloque_le < now() - make_interval(mins => $2))`,
                [adresse, DUREE_BLOCAGE_MINUTES]
            );

            // L'essai est compte avant la verification, en une seule requete :
            // PostgreSQL verrouille la ligne, chaque requete simultanee recoit donc
            // son propre compteur, et au plus MAX_TENTATIVES passent au scrypt.
            // Le compteur n'avance que sur un compte reellement protege par mot de
            // passe : sinon le comportement observe revelerait quelles adresses existent.
            const resultat = await client.query(
                `UPDATE utilisateur
                 SET tentatives_echouees = tentatives_echouees + 1,
                     est_bloque = (tentatives_echouees + 1 >= $2),
                     bloque_le = CASE WHEN tentatives_echouees + 1 >= $2 THEN now() ELSE bloque_le END
                 WHERE courriel = $1 AND mot_de_passe_hash IS NOT NULL AND NOT est_bloque
                 RETURNING ${CHAMPS_COMPTE}, mot_de_passe_hash`,
                [adresse, MAX_TENTATIVES]
            );
            return resultat.rows;
        });

        // Adresse inconnue, compte sans mot de passe ou bloque : le scrypt
        // tourne quand meme, sur l'empreinte factice, et son resultat est ignore.
        if (!rows.length) {
            await motdepasse.verifier(enClair, await EMPREINTE_FACTICE);
            return { ligne: null, valide: false };
        }
        return { ligne: rows[0], valide: await motdepasse.verifier(enClair, rows[0].mot_de_passe_hash) };
    });

    // Les sessions ouvertes sont conservees : un inconnu qui se trompe de
    // mot de passe ne doit pas pouvoir deconnecter le titulaire du compte.
    // Un compte desactive echoue comme les autres, meme avec le bon mot de
    // passe : son compteur n'est pas remis a zero et l'essai IP reste compte.
    if (!valide || !ligne.est_actif) throw echecConnexion();

    // Le bon mot de passe efface le compteur, y compris le blocage que son
    // propre essai venait de poser s'il etait le dernier autorise.
    await db.requete(
        'UPDATE utilisateur SET tentatives_echouees = 0, est_bloque = FALSE, bloque_le = NULL WHERE id = $1',
        [ligne.id]
    );
    ligne.est_bloque = false;
    // Une connexion reussie rend son essai, sans effacer les autres : posseder
    // un compte valide ne doit pas permettre de remettre son compteur a zero.
    limiteConnexionIp.rendre(ip);

    const session = await auth.creerSession(ligne.id);
    completerValeursEnFond(ligne.id);
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
    completerValeursEnFond(rows[0].id);
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

// Demandes de reinitialisation : par IP, un refus explicite ne revele rien sur
// les comptes ; par adresse, la reponse reste la meme, mais rien n'est fait,
// pour qu'on ne puisse ni inonder une boite ni annuler le lien du titulaire.
const limiteOubliIp = creerLimiteur({
    max: 5,
    fenetre: 60 * 60 * 1000,
    message: 'Trop de demandes. Réessayez plus tard.',
});
const limiteOubliAdresse = creerLimiteur({ max: 3, fenetre: 60 * 60 * 1000 });

// Lancee sans attendre : la reponse part avant la recherche du compte et
// l'envoi SMTP, son delai ne dit donc pas si l'adresse existe.
async function envoyerLienReinitialisation(adresse, req) {
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
}

route('POST', '/api/crypto/mot-de-passe/oubli', async ({ corps, req }) => {
    limiteOubliIp.reserver(adresseClient(req));
    const adresse = exigerCourriel(corps);

    if (!limiteOubliAdresse.depasse(adresse)) {
        envoyerLienReinitialisation(adresse, req).catch((err) => {
            console.error('Demande de réinitialisation :', err);
        });
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

    // Préférences de saisie, facultatives : une chaîne vide les efface
    const plateformeDefaut = corps.plateforme_defaut
        ? String(corps.plateforme_defaut).trim()
        : null;

    // Convention fiscale retenue pour les recompenses de staking. Elle change
    // le montant des plus-values : elle appartient au contribuable, pas au
    // code, et vaut « nulle » tant qu'il n'a rien dit.
    const stakingAcquisition = String(corps.staking_acquisition
        || utilisateur.staking_acquisition || 'nulle');
    if (!STAKING_ACQUISITION.includes(stakingAcquisition)) {
        throw new ErreurClient(
            `Champ staking_acquisition : ${STAKING_ACQUISITION.join(' ou ')} attendu`);
    }

    // Changer d'adresse ouvre la reinitialisation du mot de passe a la nouvelle :
    // une session volee suffirait sinon a s'approprier le compte pour de bon.
    const ancienneAdresse = utilisateur.courriel;
    const changeAdresse = adresse !== ancienneAdresse;
    if (changeAdresse) await confirmerMotDePasseActuel(utilisateur.id, corps, req);

    const { rows } = await db.requete(
        `UPDATE utilisateur SET courriel = $2, nom = $3, prenom = $4, devise = $5,
                plateforme_defaut = $6, staking_acquisition = $7
         WHERE id = $1
         RETURNING id, courriel, nom, prenom, est_actif, est_admin, devise, autorise_google, est_bloque, mot_de_passe_a_definir, plateforme_defaut, staking_acquisition, cree_le`,
        [utilisateur.id, adresse, nom, prenom, devise, plateformeDefaut, stakingAcquisition]
    );
    if (!rows.length) throw new ErreurClient('Compte introuvable', 404);

    if (changeAdresse) {
        prevenirChangementAdresse(ancienneAdresse, rows[0]).catch((err) => {
            console.error("Avertissement de changement d'adresse :", err.message);
        });
    }

    return { code: 200, corps: comptePublic(rows[0]) };
});

// Le mot de passe actuel est verifie sous les memes garde-fous que la
// connexion : limite par IP et plafond des verifications simultanees.
async function confirmerMotDePasseActuel(utilisateurId, corps, req) {
    const { rows } = await db.requete(
        'SELECT mot_de_passe_hash FROM utilisateur WHERE id = $1',
        [utilisateurId]
    );
    const empreinte = rows.length ? rows[0].mot_de_passe_hash : null;
    if (!empreinte) {
        throw new ErreurClient(
            "Ce compte n'a pas de mot de passe : demandez à un administrateur de changer l'adresse.", 403);
    }

    const enClair = typeof corps.mot_de_passe_actuel === 'string' ? corps.mot_de_passe_actuel : '';
    if (!enClair) {
        throw new ErreurClient("Saisissez votre mot de passe actuel pour changer d'adresse.", 403);
    }

    const ip = adresseClient(req);
    limiteConnexionIp.reserver(ip);
    const valide = await sousPlafond(() => motdepasse.verifier(enClair, empreinte));
    if (!valide) throw new ErreurClient('Mot de passe actuel incorrect', 403);
    limiteConnexionIp.rendre(ip);
}

// L'ancienne adresse est prevenue : si le changement ne vient pas du
// titulaire, c'est le seul signal qu'il recevra.
async function prevenirChangementAdresse(ancienneAdresse, compte) {
    await courriel.envoyer({
        destinataire: ancienneAdresse,
        sujet: 'Adresse de votre compte modifiée',
        texte: [
            `Bonjour ${compte.prenom},`,
            '',
            `L'adresse de votre compte Suivi crypto vient d'être changée pour : ${compte.courriel}`,
            '',
            "Si vous n'êtes pas à l'origine de ce changement, prévenez sans attendre",
            "l'administrateur du site.",
        ].join('\r\n'),
    });
}

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
         RETURNING id, courriel, nom, prenom, est_actif, est_admin, devise, autorise_google, est_bloque, mot_de_passe_a_definir, plateforme_defaut, staking_acquisition, cree_le`,
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
        `SELECT id, courriel, nom, prenom, est_actif, est_admin, devise, autorise_google, est_bloque, mot_de_passe_a_definir, plateforme_defaut, staking_acquisition, cree_le,
                (mot_de_passe_hash IS NOT NULL) AS a_mot_de_passe,
                (google_sub IS NOT NULL) AS a_google,
                (SELECT count(*) FROM session s WHERE s.utilisateur_id = u.id AND s.expire_le > now())::int AS sessions_ouvertes,
                (SELECT count(*)::int FROM operation o WHERE o.utilisateur_id = u.id) AS operations
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
         RETURNING id, courriel, nom, prenom, est_actif, est_admin, devise, autorise_google, est_bloque, mot_de_passe_a_definir, plateforme_defaut, staking_acquisition, cree_le`,
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
         RETURNING id, courriel, nom, prenom, est_actif, est_admin, devise, autorise_google, est_bloque, mot_de_passe_a_definir, plateforme_defaut, staking_acquisition, cree_le`,
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
         RETURNING id, courriel, nom, prenom, est_actif, est_admin, devise, autorise_google, est_bloque, mot_de_passe_a_definir, plateforme_defaut, staking_acquisition, cree_le`,
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
         RETURNING id, courriel, nom, prenom, est_actif, est_admin, devise, autorise_google, est_bloque, mot_de_passe_a_definir, plateforme_defaut, staking_acquisition, cree_le`,
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

    // L'unicite est deja garantie par la base ; ce controle sert surtout
    // a rendre le refus lisible plutot que generique.
    const { rows: existant } = await db.requete(
        'SELECT courriel FROM utilisateur WHERE courriel = $1',
        [adresse]
    );
    if (existant.length) {
        throw new ErreurClient(`Un compte existe déjà avec l'adresse ${adresse}.`, 409);
    }

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
                   autorise_google, est_bloque, mot_de_passe_a_definir, plateforme_defaut, staking_acquisition, cree_le`,
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

// Relève d'une période à la demande d'un administrateur : Binance, puis Kraken
// et Bitstamp pour les journées que la source précédente ne cote pas.
route('POST', '/api/crypto/administration/valeurs/relever', async ({ req, corps }) => {
    await exigerAdmin(req);

    const debut = exigerTexte(corps, 'debut');
    const fin = exigerTexte(corps, 'fin');
    const ecraser = corps.ecraser === true;

    // Sans crypto précisée, tout le référentiel. Celles qui n'ont de paire sur
    // aucune plateforme ressortent en erreur dans le bilan plutôt que d'être
    // écartées sans bruit : c'est une lacune du référentiel, pas un cas normal.
    let cibles;
    if (corps.id_crypto) {
        cibles = [String(corps.id_crypto).toUpperCase()];
    } else {
        const { rows } = await db.requete('SELECT id FROM crypto ORDER BY id');
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


// --- Administration : sauvegardes ------------------------------------------
route('GET', '/api/crypto/administration/sauvegardes', async ({ req }) => {
    await exigerAdmin(req);
    return { code: 200, corps: await sauvegarde.lister() };
});

// La copie des sources, l'extraction de la base, l'archive et son envoi tiennent
// dans la requete : l'administrateur doit savoir si le courriel est parti.
route('POST', '/api/crypto/administration/sauvegardes', async ({ req }) => {
    const administrateur = await exigerAdmin(req);

    try {
        return { code: 201, corps: await sauvegarde.creer(administrateur.courriel) };
    } catch (err) {
        // Sauvegarde deja en cours, ou dossier de destination injoignable :
        // dans les deux cas la cause se corrige, elle est renvoyee telle quelle.
        if (err.code === 409 || err.code === 400) throw new ErreurClient(err.message, err.code);
        throw err;
    }
});

route('DELETE', '/api/crypto/administration/sauvegardes/:nom', async ({ req, params }) => {
    await exigerAdmin(req);

    try {
        return { code: 200, corps: await sauvegarde.supprimer(params.nom) };
    } catch (err) {
        if ([400, 404, 409].includes(err.code)) throw new ErreurClient(err.message, err.code);
        throw err;
    }
});


// Suppression d'un compte. Les sessions et les operations partent en cascade
// par le schema ; cascade=1 atteste que l'administrateur en a ete averti.
route('DELETE', '/api/crypto/administration/utilisateurs/:id', async ({ req, params, url }) => {
    const administrateur = await exigerAdmin(req);
    const id = exigerEntier(params.id, 'id');
    const cascade = url.searchParams.get('cascade') === '1';

    // Supprimer son propre compte fermerait la session en cours et pourrait
    // retirer le dernier administrateur : c'est refuse sans condition.
    if (id === administrateur.id) {
        throw new ErreurClient('Vous ne pouvez pas supprimer votre propre compte', 400);
    }

    const { rows: cible } = await db.requete(
        `SELECT u.id, u.courriel, u.est_admin,
                (SELECT count(*)::int FROM operation o WHERE o.utilisateur_id = u.id) AS operations
         FROM utilisateur u WHERE u.id = $1`,
        [id]
    );
    if (!cible.length) throw new ErreurClient('Utilisateur introuvable', 404);

    if (cible[0].operations > 0 && !cascade) {
        throw new ErreurClient(
            `Suppression refusée : ce compte porte ${cible[0].operations} opération(s). `
            + 'Confirmez la suppression en cascade pour les emporter avec lui.',
            409
        );
    }

    // Le dernier administrateur actif ne peut pas disparaitre : plus personne
    // ne pourrait alors administrer l'application depuis l'interface.
    if (cible[0].est_admin) {
        const { rows: restants } = await db.requete(
            'SELECT count(*)::int AS n FROM utilisateur WHERE est_admin AND est_actif AND id <> $1',
            [id]
        );
        if (restants[0].n === 0) {
            throw new ErreurClient('Refus : il doit rester au moins un administrateur actif', 409);
        }
    }

    await db.requete('DELETE FROM utilisateur WHERE id = $1', [id]);

    return {
        code: 200,
        corps: {
            statut: 'compte supprime',
            id,
            courriel: cible[0].courriel,
            operations: cible[0].operations,
        },
    };
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
// En-tetes de protection poses sur toute reponse, API comme fichiers du site.
// Google Identity Services, seul script externe, a besoin de son domaine
// pour le script, sa feuille de style, son cadre et ses appels.
const ENTETES_SECURITE = {
    'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' https://accounts.google.com/gsi/client",
        "style-src 'self' https://accounts.google.com/gsi/style",
        "frame-src https://accounts.google.com/gsi/",
        "connect-src 'self' https://accounts.google.com/gsi/",
        "img-src 'self' data: https:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const serveur = http.createServer(async (req, res) => {
    for (const [nom, valeur] of Object.entries(ENTETES_SECURITE)) res.setHeader(nom, valeur);

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
