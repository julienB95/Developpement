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
// Repli sur la liste par defaut si la base est injoignable, pour que la page
// publique reste servie meme sans PostgreSQL.
async function actifsSuivis() {
    try {
        const { rows } = await db.requete(
            `SELECT identifiant_coingecko FROM crypto
             WHERE est_suivi AND identifiant_coingecko IS NOT NULL
             ORDER BY id`
        );
        if (rows.length) return rows.map((ligne) => ligne.identifiant_coingecko);
    } catch (err) {
        console.error('Référentiel des cryptos illisible :', err.message);
    }
    return ACTIFS_PAR_DEFAUT;
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

    const url = new URL(URL_MARCHES);
    url.searchParams.set('vs_currency', devise);
    url.searchParams.set('ids', (await actifsSuivis()).join(','));
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

    const donnees = {
        devise: devise.toUpperCase(),
        releve_le: new Date().toISOString(),
        source: 'CoinGecko',
        actifs: brut.map(normaliser),
    };

    cache.set(devise, { horodatage: Date.now(), donnees });
    return { ...donnees, provenance: 'source' };
}

// URL du logo d un actif, telle que fournie par la source. Le fichier lui-meme
// est servi par l API : le navigateur ne contacte jamais CoinGecko directement.
async function logoActif(identifiant) {
    const donnees = await cours('eur');
    const actif = donnees.actifs.find((a) => a.id === identifiant);
    return actif ? actif.image : null;
}

module.exports = { cours, logoActif, DEVISES_ACCEPTEES };
