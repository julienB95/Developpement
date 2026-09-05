// Actualites crypto agregees depuis des flux RSS publics.
// Lecture et analyse avec les modules natifs : le RSS est du XML simple.
const FLUX_PAR_DEFAUT = [
    { nom: 'Journal du Coin', url: 'https://journalducoin.com/feed/', langue: 'fr' },
    { nom: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', langue: 'en' },
    { nom: 'Cointelegraph', url: 'https://cointelegraph.com/rss', langue: 'en' },
];

const DUREE_CACHE = 10 * 60 * 1000;
// Rafraichissement demande : cache raccourci, jamais supprime
const DUREE_CACHE_FORCE = 60 * 1000;
const DELAI_REPONSE = 8000;
const LIMITE_MAXIMALE = 30;

let cache = null;

const ENTITES = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
    '&#39;': "'", '&nbsp;': ' ', '&#8217;': '’', '&#8216;': '‘',
};

function nettoyer(texte) {
    if (!texte) return '';
    return texte
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<[^>]*>/g, '')
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&[a-z]+;|&#\d+;/gi, (entite) => ENTITES[entite.toLowerCase()] || entite)
        .replace(/\s+/g, ' ')
        .trim();
}

function extraire(bloc, balise) {
    const trouve = new RegExp(`<${balise}[^>]*>([\\s\\S]*?)</${balise}>`, 'i').exec(bloc);
    return trouve ? nettoyer(trouve[1]) : '';
}

function analyser(xml, flux) {
    const articles = [];
    const blocs = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];

    for (const bloc of blocs) {
        const titre = extraire(bloc, 'title');
        const lien = extraire(bloc, 'link');
        if (!titre || !lien) continue;

        const date = new Date(extraire(bloc, 'pubDate') || extraire(bloc, 'dc:date'));

        articles.push({
            titre: titre,
            lien: lien,
            source: flux.nom,
            langue: flux.langue,
            publie_le: isNaN(date.getTime()) ? null : date.toISOString(),
        });
    }

    return articles;
}

async function lireFlux(flux) {
    try {
        const reponse = await fetch(flux.url, {
            headers: {
                Accept: 'application/rss+xml, application/xml, text/xml',
                // Certains flux refusent une requete sans navigateur declare
                'User-Agent': 'Mozilla/5.0 (compatible; SuiviCrypto/1.0)',
            },
            signal: AbortSignal.timeout(DELAI_REPONSE),
        });
        if (!reponse.ok) {
            console.error('Flux %s indisponible : HTTP %s', flux.nom, reponse.status);
            return [];
        }
        return analyser(await reponse.text(), flux);
    } catch (err) {
        // Un flux en echec ne doit pas priver le site des autres sources
        console.error('Flux %s injoignable : %s', flux.nom, err.message);
        return [];
    }
}

async function articles(limiteDemandee, forcer) {
    const limite = Math.min(Math.max(Number(limiteDemandee) || 8, 1), LIMITE_MAXIMALE);

    if (cache && Date.now() - cache.horodatage < (forcer ? DUREE_CACHE_FORCE : DUREE_CACHE)) {
        return { ...cache.donnees, articles: cache.donnees.articles.slice(0, limite), provenance: 'cache' };
    }

    const resultats = await Promise.all(FLUX_PAR_DEFAUT.map(lireFlux));
    const tous = resultats.flat();

    if (!tous.length) {
        if (cache) {
            return { ...cache.donnees, articles: cache.donnees.articles.slice(0, limite), provenance: 'cache_perime' };
        }
        throw new Error('Aucune source d actualites disponible');
    }

    tous.sort((a, b) => {
        if (!a.publie_le) return 1;
        if (!b.publie_le) return -1;
        return b.publie_le.localeCompare(a.publie_le);
    });

    const donnees = {
        releve_le: new Date().toISOString(),
        sources: FLUX_PAR_DEFAUT.map((f) => f.nom),
        articles: tous.slice(0, LIMITE_MAXIMALE),
    };

    cache = { horodatage: Date.now(), donnees };
    return { ...donnees, articles: donnees.articles.slice(0, limite), provenance: 'source' };
}

module.exports = { articles };
