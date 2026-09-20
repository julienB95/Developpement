// Valeur moyenne journalière des crypto-actifs, en euro, relevée chez Binance.
//
// Le VWAP est le quotient du volume échangé en euro par le volume échangé en
// crypto : c'est la cotation moyenne journalière pondérée par les volumes,
// celle que le BOFiP admet pour valoriser un portefeuille au moment d'une cession.
//
// Les bougies quotidiennes de Binance sont calées sur 00:00 UTC. C'est la
// convention retenue ici, appliquée de la même façon à toutes les lignes :
// mieux vaut une règle uniforme et documentée qu'un découpage approximatif.
//
// La bougie du jour en cours est servie dès la première transaction, mais son
// VWAP ne couvre que les heures écoulées. Elle est donc marquée est_partiel,
// puis reprise après la clôture par completerPartielles() : une valeur retenue
// pour une déclaration doit porter sur une journée entière.
const db = require('../../_commun/api/db');

const URL_KLINES = 'https://api.binance.com/api/v3/klines';
const DELAI_REPONSE = 8000;
const JOUR_MS = 24 * 60 * 60 * 1000;

// Sans paire Binance, aucune valeur ne peut être relevée pour cette crypto :
// la journée reste sans valorisation, et le bilan doit le dire. Écarter ces
// cryptos sans bruit sous-évaluerait le portefeuille au moment de la cession,
// et donc surévaluerait la plus-value, sans aucun signal.
const SANS_PAIRE = 'aucune paire Binance renseignée';

// Jour civil français d'un instant donné, au format AAAA-MM-JJ
function jourParis(instant) {
    return new Intl.DateTimeFormat('fr-CA', {
        timeZone: 'Europe/Paris',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(instant);
}

// Une bougie dont l'heure de clôture n'est pas encore passée ne couvre qu'une
// partie de la journée : sa moyenne sera à recalculer.
function estPartielle(finMs) {
    return Number(finMs) >= Date.now();
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

    // [ouverture le, ouverture, haut, bas, cloture, volume, cloture le,
    //  volume en devise de cotation]
    const bougie = lignes[0];
    return {
        ouverture: bougie[1],
        haut: bougie[2],
        bas: bougie[3],
        cloture: bougie[4],
        volume: bougie[5],
        volume_devise: bougie[7],
        partiel: estPartielle(bougie[6]),
    };
}

// Le VWAP est calculé par PostgreSQL en NUMERIC : aucun montant ne transite
// par un flottant JavaScript, même le temps d'une division.
async function enregistrer(idCrypto, paire, jour, bougie) {
    await db.requete(
        `INSERT INTO crypto_valeur
             (id_crypto, date, devise, source, vwap,
              ouverture, haut, bas, cloture, volume, volume_devise, est_partiel)
         VALUES ($1, $2::date, 'EUR', $3,
                 CASE WHEN $8::numeric > 0 THEN $9::numeric / $8::numeric END,
                 $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id_crypto, date) DO UPDATE
             SET source = EXCLUDED.source,
                 vwap = EXCLUDED.vwap,
                 ouverture = EXCLUDED.ouverture,
                 haut = EXCLUDED.haut,
                 bas = EXCLUDED.bas,
                 cloture = EXCLUDED.cloture,
                 volume = EXCLUDED.volume,
                 volume_devise = EXCLUDED.volume_devise,
                 est_partiel = EXCLUDED.est_partiel,
                 releve_le = now()`,
        [
            idCrypto, jour, 'binance:' + paire,
            bougie.ouverture, bougie.haut, bougie.bas, bougie.cloture,
            bougie.volume, bougie.volume_devise, bougie.partiel === true,
        ]
    );
}

// Une journée close déjà relevée ne se rejoue pas : la valeur retenue pour une
// déclaration doit rester celle qui a été retenue. Une ligne partielle, elle,
// reste ouverte à la réécriture tant que sa journée n'est pas terminée.
async function valeurFigee(idCrypto, jour) {
    const { rows } = await db.requete(
        'SELECT est_partiel FROM crypto_valeur WHERE id_crypto = $1 AND date = $2::date',
        [idCrypto, jour]
    );
    return rows.length > 0 && !rows[0].est_partiel;
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
        partiel: estPartielle(bougie[6]),
    }));
}

// Relève une plage de dates pour une crypto donnée. Comme ailleurs, une journée
// close déjà enregistrée n'est pas réécrite, sauf demande explicite ; une
// journée restée partielle, elle, est reprise sans qu'il faille le demander.
async function releverPeriode(idCrypto, debut, fin, ecraser) {
    const { rows } = await db.requete(
        'SELECT id, paire_binance FROM crypto WHERE id = $1',
        [idCrypto]
    );
    if (!rows.length) throw new Error('Crypto inconnue');
    if (!rows[0].paire_binance) throw new Error('Aucune paire Binance renseignée pour cette crypto');

    const bougies = await bougiesPeriode(rows[0].paire_binance, debut, fin);
    const bilan = { id_crypto: idCrypto, releves: 0, ignorees: 0, jours: bougies.length };

    for (const bougie of bougies) {
        if (!ecraser && await valeurFigee(idCrypto, bougie.jour)) {
            bilan.ignorees += 1;
            continue;
        }
        await enregistrer(idCrypto, rows[0].paire_binance, bougie.jour, bougie);
        bilan.releves += 1;
    }

    return bilan;
}

// Relève et stocke la valeur du jour indiqué pour toutes les cryptos sur
// lesquelles l'utilisateur a une opération.
//
// Une journée close déjà relevée n'est jamais réécrite : la valeur retenue pour
// une déclaration doit rester celle qui a été retenue. La journée en cours est
// marquée partielle et reste rafraîchie, jusqu'à ce que completerPartielles()
// la termine une fois la clôture passée.
async function releverPourUtilisateur(utilisateurId, jour) {
    // Toutes les cryptos du compte, paire Binance ou non : celles qui n'en ont
    // pas ressortent en échec plutôt que d'être écartées de la liste.
    const { rows: cryptos } = await db.requete(
        `SELECT DISTINCT c.id, c.paire_binance
         FROM operation o
         JOIN crypto c ON c.id = o.id_crypto
         WHERE o.utilisateur_id = $1
         ORDER BY c.id`,
        [utilisateurId]
    );

    const bilan = { jour, releves: [], deja: [], echecs: [] };

    for (const crypto of cryptos) {
        if (await valeurFigee(crypto.id, jour)) {
            bilan.deja.push(crypto.id);
            continue;
        }

        if (!crypto.paire_binance) {
            bilan.echecs.push({ id_crypto: crypto.id, raison: SANS_PAIRE });
            continue;
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

// Reprise des journées restées incomplètes. Une vente enregistrée dans la
// journée fige une bougie encore ouverte, et rien ne revenait la terminer ; une
// vente passée entre minuit et 2 h heure de Paris ne relevait même rien, la
// journée UTC correspondante n'ayant pas encore commencé.
//
// Sont reprises les journées de vente de l'utilisateur dont la valeur est
// absente ou partielle, et dont la journée UTC est maintenant close.
async function completerPartielles(utilisateurId) {
    const { rows } = await db.requete(
        `SELECT a.id, a.paire_binance, to_char(j.jour, 'YYYY-MM-DD') AS jour
         FROM (SELECT DISTINCT (o.horodatage AT TIME ZONE 'Europe/Paris')::date AS jour
               FROM operation o
               WHERE o.utilisateur_id = $1 AND o.type = 'vente') j
         CROSS JOIN (SELECT DISTINCT c.id, c.paire_binance
                     FROM operation o
                     JOIN crypto c ON c.id = o.id_crypto
                     WHERE o.utilisateur_id = $1) a
         LEFT JOIN crypto_valeur v ON v.id_crypto = a.id AND v.date = j.jour
         WHERE (v.id_crypto IS NULL OR v.est_partiel)
           AND j.jour < (now() AT TIME ZONE 'UTC')::date
         ORDER BY a.id, j.jour`,
        [utilisateurId]
    );

    // Une seule requête sortante par crypto couvre toute sa plage de journées.
    // Binance plafonne à 1000 bougies par réponse : au-delà, les journées non
    // couvertes restent à reprendre et le passage suivant repartira d'elles.
    const parCrypto = new Map();
    const sansPaire = new Map();
    for (const ligne of rows) {
        if (!ligne.paire_binance) {
            sansPaire.set(ligne.id, (sansPaire.get(ligne.id) || 0) + 1);
            continue;
        }
        if (!parCrypto.has(ligne.id)) {
            parCrypto.set(ligne.id, { paire: ligne.paire_binance, jours: [] });
        }
        parCrypto.get(ligne.id).jours.push(ligne.jour);
    }

    const bilan = { completees: [], echecs: [] };

    // Un échec par crypto, pas par journée : le bilan resterait illisible pour
    // un compte qui compte des dizaines de journées de vente.
    for (const [idCrypto, jours] of sansPaire) {
        bilan.echecs.push({
            id_crypto: idCrypto,
            raison: `${SANS_PAIRE} (${jours} journée${jours > 1 ? 's' : ''} sans valorisation)`,
        });
    }

    for (const [idCrypto, cible] of parCrypto) {
        let bougies;
        try {
            bougies = await bougiesPeriode(
                cible.paire, cible.jours[0], cible.jours[cible.jours.length - 1]
            );
        } catch (err) {
            bilan.echecs.push({ id_crypto: idCrypto, raison: err.message });
            continue;
        }

        const parJour = new Map(bougies.map((bougie) => [bougie.jour, bougie]));

        for (const jour of cible.jours) {
            const bougie = parJour.get(jour);
            // Aucune cotation ce jour-là, ou bougie encore ouverte : on repassera
            if (!bougie || bougie.partiel) continue;

            try {
                await enregistrer(idCrypto, cible.paire, jour, bougie);
                bilan.completees.push({ id_crypto: idCrypto, jour });
            } catch (err) {
                bilan.echecs.push({ id_crypto: idCrypto, jour, raison: err.message });
            }
        }
    }

    return bilan;
}

module.exports = {
    jourParis,
    bougieQuotidienne,
    bougiesPeriode,
    releverPeriode,
    releverPourUtilisateur,
    completerPartielles,
};
