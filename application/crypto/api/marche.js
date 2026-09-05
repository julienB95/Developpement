// Cours des crypto-actifs, via l'offre gratuite de CoinGecko (aucune cle d'API).
// Un cache en memoire evite de depasser le quota et de rappeler la source a chaque visiteur.
const db = require('../../_commun/api/db');

const URL_MARCHES = 'https://api.coingecko.com/api/v3/coins/markets';

const ACTIFS_PAR_DEFAUT = [
    'bitcoin', 'ethereum', 'solana', 'ripple', 'cardano',
    'binancecoin', 'dogecoin', 'chainlink',
];

const DEVISES_ACCEPTEES = ['eur', 'usd'];
const DUREE_CACHE = 120 * 1000;
// Un rafraichissement demande par un visiteur raccourcit le cache sans le supprimer :
// la source est protegee meme si le bouton est actionne en rafale.
const DUREE_CACHE_FORCE = 30 * 1000;
const DELAI_REPONSE = 8000;

const cache = new Map();

// La liste suivie vient du referentiel : c'est la table crypto qui fait foi.
// Renvoie null si la base est injoignable, pour que l'appelant sache qu'il ne
// peut pas filtrer et se rabatte sur la liste par defaut.
async function referentiel() {
    try {
        const { rows } = await db.requete(
            `SELECT id, libelle, identifiant_coingecko FROM crypto
             WHERE est_suivi AND identifiant_coingecko IS NOT NULL
             ORDER BY id`
        );
        if (rows.length) return rows;
    } catch (err) {
        console.error('Référentiel des cryptos illisible :', err.message);
    }
    return null;
}

// Le referentiel est vide ou modifie : le cache devient faux et doit partir.
function viderCache() {
    cache.clear();
}

// Les prix sont transmis en chaine : aucun arrondi ni perte de precision en route
function normaliser(ligne) {
    return {
        id: ligne.id,
        symbole: String(ligne.symbol || '').toUpperCase(),
        nom: ligne.name,
        image: ligne.image || null,
        prix: ligne.current_price === null || ligne.current_price === undefined
            ? null
            : String(ligne.current_price),
        variation_24h: ligne.price_change_percentage_24h === null
            || ligne.price_change_percentage_24h === undefined
            ? null
            : Number(ligne.price_change_percentage_24h.toFixed(2)),
        capitalisation: ligne.market_cap === null || ligne.market_cap === undefined
            ? null
            : String(ligne.market_cap),
        mis_a_jour_le: ligne.last_updated || null,
    };
}

async function cours(deviseDemandee, forcer) {
    const devise = DEVISES_ACCEPTEES.includes(String(deviseDemandee || '').toLowerCase())
        ? String(deviseDemandee).toLowerCase()
        : 'eur';

    const enCache = cache.get(devise);
    const duree = forcer ? DUREE_CACHE_FORCE : DUREE_CACHE;
    if (enCache && Date.now() - enCache.horodatage < duree) {
        return { ...enCache.donnees, provenance: 'cache' };
    }

    const suivies = await referentiel();
    const identifiants = suivies
        ? suivies.map((ligne) => ligne.identifiant_coingecko)
        : ACTIFS_PAR_DEFAUT;

    const url = new URL(URL_MARCHES);
    url.searchParams.set('vs_currency', devise);
    url.searchParams.set('ids', identifiants.join(','));
    url.searchParams.set('order', 'market_cap_desc');
    url.searchParams.set('price_change_percentage', '24h');
    url.searchParams.set('sparkline', 'false');

    let reponse;
    try {
        reponse = await fetch(url, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(DELAI_REPONSE),
        });
    } catch (err) {
        // Source injoignable : on sert la derniere valeur connue plutot que rien
        if (enCache) return { ...enCache.donnees, provenance: 'cache_perime' };
        throw new Error('Source des cours injoignable');
    }

    if (!reponse.ok) {
        if (enCache) return { ...enCache.donnees, provenance: 'cache_perime' };
        throw new Error(`Source des cours indisponible (HTTP ${reponse.status})`);
    }

    const brut = await reponse.json();
    if (!Array.isArray(brut)) {
        if (enCache) return { ...enCache.donnees, provenance: 'cache_perime' };
        throw new Error('Reponse inattendue de la source des cours');
    }

    let actifs = brut.map(normaliser);

    // Le referentiel fait foi : une crypto absente de la table n'est pas affichee,
    // et ce sont son symbole et son libelle qui sont retenus, pas ceux de la source.
    // Sans ce filtre, la liste par defaut ou un cache anterieur pourraient laisser
    // passer une crypto qui n'existe plus dans la table.
    if (suivies) {
        const parIdentifiant = new Map(
            suivies.map((ligne) => [ligne.identifiant_coingecko, ligne])
        );
        actifs = actifs
            .filter((actif) => parIdentifiant.has(actif.id))
            .map((actif) => {
                const reference = parIdentifiant.get(actif.id);
                return { ...actif, symbole: reference.id, nom: reference.libelle };
            });
    }

    const donnees = {
        devise: devise.toUpperCase(),
        releve_le: new Date().toISOString(),
        source: 'CoinGecko',
        actifs,
    };

    cache.set(devise, { horodatage: Date.now(), donnees });
    return { ...donnees, provenance: 'source' };
}

// Les 100 plus grosses capitalisations, pour alimenter la saisie d'une nouvelle
// crypto dans l'administration. Le classement bouge lentement : une heure de
// cache suffit largement, et menage le quota de la source.
const DUREE_CACHE_CATALOGUE = 60 * 60 * 1000;
let cacheCatalogue = null;

async function catalogue() {
    if (cacheCatalogue && Date.now() - cacheCatalogue.horodatage < DUREE_CACHE_CATALOGUE) {
        return cacheCatalogue.donnees;
    }

    const url = new URL(URL_MARCHES);
    url.searchParams.set('vs_currency', 'eur');
    url.searchParams.set('order', 'market_cap_desc');
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', '1');
    url.searchParams.set('sparkline', 'false');

    let reponse;
    try {
        reponse = await fetch(url, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(DELAI_REPONSE),
        });
    } catch (err) {
        if (cacheCatalogue) return cacheCatalogue.donnees;
        throw new Error('Catalogue des cryptos injoignable');
    }

    if (!reponse.ok) {
        if (cacheCatalogue) return cacheCatalogue.donnees;
        throw new Error(`Catalogue des cryptos indisponible (HTTP ${reponse.status})`);
    }

    const brut = await reponse.json();
    if (!Array.isArray(brut)) {
        if (cacheCatalogue) return cacheCatalogue.donnees;
        throw new Error('Reponse inattendue de la source');
    }

    const donnees = brut.map((ligne, rang) => ({
        rang: rang + 1,
        identifiant_coingecko: ligne.id,
        symbole: String(ligne.symbol || '').toUpperCase(),
        libelle: ligne.name,
        logo_url: ligne.image || null,
    }));

    cacheCatalogue = { horodatage: Date.now(), donnees };
    return donnees;
}

// URL du logo d un actif, telle que fournie par la source. Le fichier lui-meme
// est servi par l API : le navigateur ne contacte jamais CoinGecko directement.
async function logoActif(identifiant) {
    const donnees = await cours('eur');
    const actif = donnees.actifs.find((a) => a.id === identifiant);
    return actif ? actif.image : null;
}

module.exports = { cours, catalogue, logoActif, viderCache, DEVISES_ACCEPTEES };
