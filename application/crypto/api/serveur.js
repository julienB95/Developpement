// API de l'application crypto - Node natif + PostgreSQL (NAS Synology)
const http = require('http');
const db = require('./db');

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

// --- Actifs ----------------------------------------------------------------
route('GET', '/api/crypto/actifs', async () => {
    const { rows } = await db.requete(
        'SELECT id, symbole, nom, decimales, est_actif, cree_le FROM actif ORDER BY symbole'
    );
    return { code: 200, corps: rows };
});

route('GET', '/api/crypto/actifs/:symbole', async ({ params }) => {
    const { rows } = await db.requete(
        'SELECT id, symbole, nom, decimales, est_actif, cree_le FROM actif WHERE symbole = $1',
        [params.symbole.toUpperCase()]
    );
    if (!rows.length) throw new ErreurClient('Actif introuvable', 404);
    return { code: 200, corps: rows[0] };
});

route('POST', '/api/crypto/actifs', async ({ corps }) => {
    const symbole = exigerTexte(corps, 'symbole').toUpperCase();
    const nom = exigerTexte(corps, 'nom');

    let decimales = 8;
    if (corps.decimales !== undefined) {
        decimales = Number(corps.decimales);
        if (!Number.isInteger(decimales) || decimales < 0 || decimales > 18) {
            throw new ErreurClient('Champ decimales : entier entre 0 et 18 attendu');
        }
    }

    const { rows } = await db.requete(
        `INSERT INTO actif (symbole, nom, decimales) VALUES ($1, $2, $3)
         ON CONFLICT (symbole) DO UPDATE SET nom = EXCLUDED.nom, decimales = EXCLUDED.decimales
         RETURNING id, symbole, nom, decimales, est_actif, cree_le`,
        [symbole, nom, decimales]
    );
    return { code: 201, corps: rows[0] };
});

// --- Cours -----------------------------------------------------------------
route('GET', '/api/crypto/cours/dernier', async ({ url }) => {
    const symbole = (url.searchParams.get('symbole') || '').toUpperCase();
    if (!symbole) throw new ErreurClient('Parametre requis : symbole');
    const devise = (url.searchParams.get('devise') || 'EUR').toUpperCase();

    const { rows } = await db.requete(
        `SELECT a.symbole, c.devise, c.prix, c.source, c.horodatage
         FROM cours c JOIN actif a ON a.id = c.actif_id
         WHERE a.symbole = $1 AND c.devise = $2
         ORDER BY c.horodatage DESC LIMIT 1`,
        [symbole, devise]
    );
    if (!rows.length) throw new ErreurClient('Aucun cours enregistre pour cet actif', 404);
    return { code: 200, corps: rows[0] };
});

route('GET', '/api/crypto/cours', async ({ url }) => {
    const symbole = (url.searchParams.get('symbole') || '').toUpperCase();
    if (!symbole) throw new ErreurClient('Parametre requis : symbole');
    const devise = (url.searchParams.get('devise') || 'EUR').toUpperCase();
    const limite = Math.min(Number(url.searchParams.get('limite')) || 100, 1000);

    const { rows } = await db.requete(
        `SELECT c.id, a.symbole, c.devise, c.prix, c.source, c.horodatage
         FROM cours c JOIN actif a ON a.id = c.actif_id
         WHERE a.symbole = $1 AND c.devise = $2
         ORDER BY c.horodatage DESC
         LIMIT $3`,
        [symbole, devise, limite]
    );
    return { code: 200, corps: rows };
});

route('POST', '/api/crypto/cours', async ({ corps }) => {
    const symbole = exigerTexte(corps, 'symbole').toUpperCase();
    const prix = exigerDecimal(corps, 'prix');
    const source = exigerTexte(corps, 'source');
    const devise = (corps.devise || 'EUR').toUpperCase();
    const horodatage = exigerDate(corps.horodatage, 'horodatage');

    const { rows } = await db.requete(
        `INSERT INTO cours (actif_id, devise, prix, source, horodatage)
         SELECT id, $2, $3, $4, $5 FROM actif WHERE symbole = $1
         ON CONFLICT (actif_id, devise, source, horodatage) DO UPDATE SET prix = EXCLUDED.prix
         RETURNING id, devise, prix, source, horodatage`,
        [symbole, devise, prix, source, horodatage]
    );
    if (!rows.length) throw new ErreurClient('Actif introuvable', 404);
    return { code: 201, corps: rows[0] };
});

// --- Portefeuilles ---------------------------------------------------------
route('GET', '/api/crypto/portefeuilles', async () => {
    const { rows } = await db.requete(
        'SELECT id, nom, devise_reference, cree_le FROM portefeuille ORDER BY nom'
    );
    return { code: 200, corps: rows };
});

route('POST', '/api/crypto/portefeuilles', async ({ corps }) => {
    const nom = exigerTexte(corps, 'nom');
    const devise = (corps.devise_reference || 'EUR').toUpperCase();

    const { rows } = await db.requete(
        `INSERT INTO portefeuille (nom, devise_reference) VALUES ($1, $2)
         RETURNING id, nom, devise_reference, cree_le`,
        [nom, devise]
    );
    return { code: 201, corps: rows[0] };
});

route('GET', '/api/crypto/portefeuilles/:id/positions', async ({ params }) => {
    const id = exigerEntier(params.id, 'id');
    const { rows } = await db.requete(
        `SELECT symbole, quantite, cout_total, devise
         FROM position
         WHERE portefeuille_id = $1 AND quantite <> 0
         ORDER BY symbole`,
        [id]
    );
    return { code: 200, corps: rows };
});

// --- Operations ------------------------------------------------------------
route('GET', '/api/crypto/operations', async ({ url }) => {
    const portefeuilleId = exigerEntier(url.searchParams.get('portefeuille_id'), 'portefeuille_id');
    const limite = Math.min(Number(url.searchParams.get('limite')) || 200, 1000);

    const { rows } = await db.requete(
        `SELECT o.id, a.symbole, o.sens, o.quantite, o.prix_unitaire, o.devise,
                o.frais, o.horodatage, o.note
         FROM operation o JOIN actif a ON a.id = o.actif_id
         WHERE o.portefeuille_id = $1
         ORDER BY o.horodatage DESC
         LIMIT $2`,
        [portefeuilleId, limite]
    );
    return { code: 200, corps: rows };
});

route('POST', '/api/crypto/operations', async ({ corps }) => {
    const portefeuilleId = exigerEntier(corps.portefeuille_id, 'portefeuille_id');
    const symbole = exigerTexte(corps, 'symbole').toUpperCase();
    const sens = exigerTexte(corps, 'sens').toLowerCase();
    if (sens !== 'achat' && sens !== 'vente') {
        throw new ErreurClient('Champ sens : achat ou vente attendu');
    }

    const quantite = exigerDecimal(corps, 'quantite');
    const prixUnitaire = exigerDecimal(corps, 'prix_unitaire');
    const frais = exigerDecimal(corps, 'frais', false) || '0';
    const devise = (corps.devise || 'EUR').toUpperCase();
    const horodatage = exigerDate(corps.horodatage, 'horodatage');

    const { rows } = await db.requete(
        `INSERT INTO operation
             (portefeuille_id, actif_id, sens, quantite, prix_unitaire, devise, frais, horodatage, note)
         SELECT $1, id, $3, $4, $5, $6, $7, $8, $9 FROM actif WHERE symbole = $2
         RETURNING id, sens, quantite, prix_unitaire, devise, frais, horodatage, note`,
        [portefeuilleId, symbole, sens, quantite, prixUnitaire, devise, frais, horodatage,
         corps.note || null]
    );
    if (!rows.length) throw new ErreurClient('Actif introuvable', 404);
    return { code: 201, corps: rows[0] };
});

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
        return repondre(res, correspondances.length ? 405 : 404, { erreur: 'Route inconnue' });
    }

    try {
        const params = {};
        trouvee.r.noms.forEach((nom, i) => { params[nom] = decodeURIComponent(trouvee.m[i + 1]); });

        const corps = (req.method === 'POST' || req.method === 'PUT') ? await lireCorps(req) : {};
        const resultat = await trouvee.r.gestionnaire({ params, corps, url, req });
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

function arreter() {
    serveur.close(() => db.fermer());
}
process.on('SIGTERM', arreter);
process.on('SIGINT', arreter);

module.exports = serveur;
