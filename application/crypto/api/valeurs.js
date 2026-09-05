// Valeur moyenne journalière des crypto-actifs, en euro, relevée chez Binance.
//
// Le VWAP est le quotient du volume échangé en euro par le volume échangé en
// crypto : c'est la cotation moyenne journalière pondérée par les volumes,
// celle que le BOFiP admet pour valoriser un portefeuille au moment d'une cession.
//
// Les bougies quotidiennes de Binance sont calées sur 00:00 UTC. C'est la
// convention retenue ici, appliquée de la même façon à toutes les lignes :
// mieux vaut une règle uniforme et documentée qu'un découpage approximatif.
const db = require('../../_commun/api/db');

const URL_KLINES = 'https://api.binance.com/api/v3/klines';
const DELAI_REPONSE = 8000;
const JOUR_MS = 24 * 60 * 60 * 1000;

// Jour civil français d'un instant donné, au format AAAA-MM-JJ
function jourParis(instant) {
    return new Intl.DateTimeFormat('fr-CA', {
        timeZone: 'Europe/Paris',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(instant);
}

async function bougieQuotidienne(paire, jour) {
    const debut = Date.parse(jour + 'T00:00:00Z');
    if (Number.isNaN(debut)) throw new Error(`Date invalide : ${jour}`);

    const url = new URL(URL_KLINES);
    url.searchParams.set('symbol', paire);
    url.searchParams.set('interval', '1d');
    url.searchParams.set('startTime', String(debut));
    url.searchParams.set('endTime', String(debut + JOUR_MS - 1));
    url.searchParams.set('limit', '1');

    const reponse = await fetch(url, { signal: AbortSignal.timeout(DELAI_REPONSE) });
    if (!reponse.ok) throw new Error(`Binance a répondu ${reponse.status}`);

    const lignes = await reponse.json();
    if (!Array.isArray(lignes) || !lignes.length) return null;

    // [ouverture, haut, bas, cloture, volume, ..., volume en devise de cotation]
    const bougie = lignes[0];
    return {
        ouverture: bougie[1],
        haut: bougie[2],
        bas: bougie[3],
        cloture: bougie[4],
        volume: bougie[5],
        volume_devise: bougie[7],
    };
}

// Le VWAP est calculé par PostgreSQL en NUMERIC : aucun montant ne transite
// par un flottant JavaScript, même le temps d'une division.
async function enregistrer(idCrypto, paire, jour, bougie) {
    await db.requete(
        `INSERT INTO crypto_valeur
             (id_crypto, date, devise, source, vwap,
              ouverture, haut, bas, cloture, volume, volume_devise)
         VALUES ($1, $2::date, 'EUR', $3,
                 CASE WHEN $8::numeric > 0 THEN $9::numeric / $8::numeric END,
                 $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id_crypto, date) DO UPDATE
             SET source = EXCLUDED.source,
                 vwap = EXCLUDED.vwap,
                 ouverture = EXCLUDED.ouverture,
                 haut = EXCLUDED.haut,
                 bas = EXCLUDED.bas,
                 cloture = EXCLUDED.cloture,
                 volume = EXCLUDED.volume,
                 volume_devise = EXCLUDED.volume_devise,
                 releve_le = now()`,
        [
            idCrypto, jour, 'binance:' + paire,
            bougie.ouverture, bougie.haut, bougie.bas, bougie.cloture,
            bougie.volume, bougie.volume_devise,
        ]
    );
}

// Relève une période entière en une seule requête : Binance renvoie jusqu'à
// 1000 bougies par appel, inutile d'en faire une par jour.
async function bougiesPeriode(paire, debut, fin) {
    const depuis = Date.parse(debut + 'T00:00:00Z');
    const jusqua = Date.parse(fin + 'T00:00:00Z');
    if (Number.isNaN(depuis) || Number.isNaN(jusqua)) {
        throw new Error('Dates invalides');
    }
    if (jusqua < depuis) throw new Error('La date de fin précède la date de début');

    const url = new URL(URL_KLINES);
    url.searchParams.set('symbol', paire);
    url.searchParams.set('interval', '1d');
    url.searchParams.set('startTime', String(depuis));
    url.searchParams.set('endTime', String(jusqua + JOUR_MS - 1));
    url.searchParams.set('limit', '1000');

    const reponse = await fetch(url, { signal: AbortSignal.timeout(DELAI_REPONSE) });
    if (!reponse.ok) throw new Error(`Binance a répondu ${reponse.status}`);

    const lignes = await reponse.json();
    if (!Array.isArray(lignes)) throw new Error('Réponse inattendue de Binance');

    return lignes.map((bougie) => ({
        jour: new Date(bougie[0]).toISOString().slice(0, 10),
        ouverture: bougie[1],
        haut: bougie[2],
        bas: bougie[3],
        cloture: bougie[4],
        volume: bougie[5],
        volume_devise: bougie[7],
    }));
}

// Relève une plage de dates pour une crypto donnée. Comme ailleurs, une journée
// close déjà enregistrée n'est pas réécrite, sauf demande explicite.
async function releverPeriode(idCrypto, debut, fin, ecraser) {
    const { rows } = await db.requete(
        'SELECT id, paire_binance FROM crypto WHERE id = $1',
        [idCrypto]
    );
    if (!rows.length) throw new Error('Crypto inconnue');
    if (!rows[0].paire_binance) throw new Error('Aucune paire Binance renseignée pour cette crypto');

    const bougies = await bougiesPeriode(rows[0].paire_binance, debut, fin);
    const aujourdhui = jourParis(new Date());
    const bilan = { id_crypto: idCrypto, releves: 0, ignorees: 0, jours: bougies.length };

    for (const bougie of bougies) {
        if (!ecraser && bougie.jour < aujourdhui) {
            const { rows: presente } = await db.requete(
                'SELECT 1 FROM crypto_valeur WHERE id_crypto = $1 AND date = $2::date',
                [idCrypto, bougie.jour]
            );
            if (presente.length) {
                bilan.ignorees += 1;
                continue;
            }
        }
        await enregistrer(idCrypto, rows[0].paire_binance, bougie.jour, bougie);
        bilan.releves += 1;
    }

    return bilan;
}

// Relève et stocke la valeur du jour indiqué pour toutes les cryptos sur
// lesquelles l'utilisateur a une opération.
//
// Une journée close déjà enregistrée n'est jamais réécrite : la valeur retenue
// pour une déclaration doit rester celle qui a été retenue. La journée en cours,
// elle, est rafraîchie tant qu'elle n'est pas terminée — sa bougie est partielle.
async function releverPourUtilisateur(utilisateurId, jour) {
    const { rows: cryptos } = await db.requete(
        `SELECT DISTINCT c.id, c.paire_binance
         FROM operation o
         JOIN crypto c ON c.id = o.id_crypto
         WHERE o.utilisateur_id = $1 AND c.paire_binance IS NOT NULL
         ORDER BY c.id`,
        [utilisateurId]
    );

    const aujourdhui = jourParis(new Date());
    const bilan = { jour, releves: [], deja: [], echecs: [] };

    for (const crypto of cryptos) {
        if (jour < aujourdhui) {
            const { rows } = await db.requete(
                'SELECT 1 FROM crypto_valeur WHERE id_crypto = $1 AND date = $2::date',
                [crypto.id, jour]
            );
            if (rows.length) {
                bilan.deja.push(crypto.id);
                continue;
            }
        }

        let bougie;
        try {
            bougie = await bougieQuotidienne(crypto.paire_binance, jour);
        } catch (err) {
            bilan.echecs.push({ id_crypto: crypto.id, raison: err.message });
            continue;
        }

        if (!bougie) {
            bilan.echecs.push({ id_crypto: crypto.id, raison: 'aucune cotation ce jour-là' });
            continue;
        }

        try {
            await enregistrer(crypto.id, crypto.paire_binance, jour, bougie);
            bilan.releves.push(crypto.id);
        } catch (err) {
            bilan.echecs.push({ id_crypto: crypto.id, raison: err.message });
        }
    }

    return bilan;
}

module.exports = { jourParis, bougieQuotidienne, bougiesPeriode, releverPeriode, releverPourUtilisateur };
