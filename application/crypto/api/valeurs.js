// Valeur moyenne journalière des crypto-actifs, en euro, relevée sur trois
// marchés en euro, dans cet ordre : Binance, Kraken, Bitstamp.
//
// Le VWAP est le quotient du volume échangé en euro par le volume échangé en
// crypto : c'est la cotation moyenne journalière pondérée par les volumes,
// celle que le BOFiP admet pour valoriser un portefeuille au moment d'une cession.
// Binance fournit les deux volumes, le VWAP est calculé ici ; Kraken fournit le
// VWAP lui-même, repris tel quel ; Bitstamp ne donne ni l'un ni l'autre, le VWAP
// est reconstitué à partir de ses 24 bougies horaires.
//
// Le repli se fait journée par journée, pas crypto par crypto : une crypto cotée
// en euro sur une plateforme depuis une date donnée prend la source suivante
// pour les journées antérieures. Chaque valeur enregistrée garde sa provenance.
//
// Les bougies des trois plateformes sont calées sur 00:00 UTC. C'est la
// convention retenue ici, appliquée de la même façon à toutes les lignes :
// mieux vaut une règle uniforme et documentée qu'un découpage approximatif.
//
// Kraken ne sert que ses 720 dernières bougies : une journée plus ancienne n'y
// est plus disponible. Une journée close relevée étant ensuite figée en base,
// il suffit de relever tôt.
//
// La bougie du jour en cours est servie dès la première transaction, mais son
// VWAP ne couvre que les heures écoulées. Elle est donc marquée est_partiel,
// puis reprise après la clôture par completerPartielles() : une valeur retenue
// pour une déclaration doit porter sur une journée entière.
const db = require('../../_commun/api/db');

const URL_KLINES = 'https://api.binance.com/api/v3/klines';
const URL_KRAKEN = 'https://api.kraken.com/0/public/OHLC';
const URL_BITSTAMP = 'https://www.bitstamp.net/api/v2/ohlc';
const DELAI_REPONSE = 8000;
const JOUR_MS = 24 * 60 * 60 * 1000;

// Sans paire sur aucune des trois plateformes, aucune valeur ne peut être
// relevée pour cette crypto : la journée reste sans valorisation, et le bilan
// doit le dire. Écarter ces cryptos sans bruit sous-évaluerait le portefeuille
// au moment de la cession : la fraction du prix d'acquisition imputée à la
// cession en serait gonflée, et la plus-value minorée, sans aucun signal.
const SANS_PAIRE = 'aucune paire Binance, Kraken ni Bitstamp renseignée';

// Les sources d'une crypto, dans l'ordre où elles sont interrogées
function sourcesDe(crypto) {
    const sources = [];
    if (crypto.paire_binance) sources.push({ nom: 'binance', paire: crypto.paire_binance });
    if (crypto.paire_kraken) sources.push({ nom: 'kraken', paire: crypto.paire_kraken });
    if (crypto.paire_bitstamp) sources.push({ nom: 'bitstamp', paire: crypto.paire_bitstamp });
    return sources;
}

// Les journées d'une période, bornes comprises, au format AAAA-MM-JJ
function joursEntre(debut, fin) {
    const depuis = Date.parse(debut + 'T00:00:00Z');
    const jusqua = Date.parse(fin + 'T00:00:00Z');
    if (Number.isNaN(depuis) || Number.isNaN(jusqua)) throw new Error('Dates invalides');
    if (jusqua < depuis) throw new Error('La date de fin précède la date de début');

    const jours = [];
    for (let instant = depuis; instant <= jusqua; instant += JOUR_MS) {
        jours.push(new Date(instant).toISOString().slice(0, 10));
    }
    return jours;
}

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
// par un flottant JavaScript, même le temps d'une division. Quand la source
// le fournit déjà (Kraken), il est repris tel quel et le volume en euro en est
// déduit, pour que la ligne garde la même forme quelle que soit sa provenance.
async function enregistrer(idCrypto, source, jour, bougie) {
    await db.requete(
        `INSERT INTO crypto_valeur
             (id_crypto, date, devise, source, vwap,
              ouverture, haut, bas, cloture, volume, volume_devise, est_partiel)
         VALUES ($1, $2::date, 'EUR', $3,
                 CASE WHEN $8::numeric > 0
                      THEN COALESCE($11::numeric, $9::numeric / $8::numeric) END,
                 $4, $5, $6, $7, $8,
                 COALESCE($9::numeric, $11::numeric * $8::numeric), $10)
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
            idCrypto, jour, source.nom + ':' + source.paire,
            bougie.ouverture, bougie.haut, bougie.bas, bougie.cloture,
            bougie.volume, bougie.volume_devise || null, bougie.partiel === true,
            bougie.vwap || null,
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

// Bougies quotidiennes Kraken d'une période, en une requête : Kraken renvoie
// d'un coup tout ce qu'il a depuis la date demandée, dans la limite de ses
// 720 dernières bougies. Les journées hors de cette fenêtre sont simplement
// absentes du résultat, comme une journée sans cotation.
async function bougiesKraken(paire, debut, fin) {
    const depuis = Date.parse(debut + 'T00:00:00Z');
    const jusqua = Date.parse(fin + 'T00:00:00Z');
    if (Number.isNaN(depuis) || Number.isNaN(jusqua)) {
        throw new Error('Dates invalides');
    }
    if (jusqua < depuis) throw new Error('La date de fin précède la date de début');

    const url = new URL(URL_KRAKEN);
    url.searchParams.set('pair', paire);
    url.searchParams.set('interval', '1440');
    // Une seconde avant minuit : la bougie du jour de début est incluse
    url.searchParams.set('since', String(depuis / 1000 - 1));

    const reponse = await fetch(url, { signal: AbortSignal.timeout(DELAI_REPONSE) });
    if (!reponse.ok) throw new Error(`Kraken a répondu ${reponse.status}`);

    const corps = await reponse.json();
    if (Array.isArray(corps.error) && corps.error.length) {
        throw new Error('Kraken : ' + corps.error.join(', '));
    }

    // La clé du résultat est le nom interne de la paire (XETCZEUR pour
    // ETCEUR) : seule compte celle qui n'est pas le curseur « last ».
    const cle = Object.keys(corps.result || {}).find((nom) => nom !== 'last');
    if (!cle || !Array.isArray(corps.result[cle])) {
        throw new Error('Réponse inattendue de Kraken');
    }

    // [ouverture le (s), ouverture, haut, bas, cloture, vwap, volume, nombre]
    return corps.result[cle]
        .filter((bougie) => bougie[0] * 1000 >= depuis && bougie[0] * 1000 <= jusqua)
        .map((bougie) => ({
            jour: new Date(bougie[0] * 1000).toISOString().slice(0, 10),
            ouverture: bougie[1],
            haut: bougie[2],
            bas: bougie[3],
            cloture: bougie[4],
            vwap: bougie[5],
            volume: bougie[6],
            partiel: estPartielle(bougie[0] * 1000 + JOUR_MS - 1),
        }));
}

// Bitstamp ne publie pas de VWAP, ni de volume en euro. La journée est donc
// reconstituée à partir de ses 24 bougies horaires : chaque heure pèse son
// volume au prix typique de l'heure, (haut + bas + clôture) / 3. Le résultat
// reste compris entre le plus bas et le plus haut de la journée. Toute
// l'agrégation est faite par PostgreSQL, en NUMERIC.
async function bougieBitstamp(paire, jour) {
    const debut = Date.parse(jour + 'T00:00:00Z');
    if (Number.isNaN(debut)) throw new Error(`Date invalide : ${jour}`);

    const url = new URL(`${URL_BITSTAMP}/${encodeURIComponent(paire)}/`);
    url.searchParams.set('step', '3600');
    url.searchParams.set('limit', '24');
    url.searchParams.set('start', String(debut / 1000));
    url.searchParams.set('end', String((debut + JOUR_MS) / 1000 - 1));

    const reponse = await fetch(url, { signal: AbortSignal.timeout(DELAI_REPONSE) });
    if (!reponse.ok) throw new Error(`Bitstamp a répondu ${reponse.status}`);

    const corps = await reponse.json();
    if (!corps.data || !Array.isArray(corps.data.ohlc)) {
        throw new Error('Réponse inattendue de Bitstamp');
    }

    const heures = corps.data.ohlc.filter((heure) => {
        const instant = Number(heure.timestamp) * 1000;
        return instant >= debut && instant < debut + JOUR_MS;
    });
    if (!heures.length) return null;

    const { rows } = await db.requete(
        `SELECT (array_agg(o ORDER BY t))[1]::text AS ouverture,
                max(h)::text AS haut,
                min(l)::text AS bas,
                (array_agg(c ORDER BY t DESC))[1]::text AS cloture,
                sum(v)::text AS volume,
                sum((h + l + c) / 3 * v)::text AS volume_devise
         FROM unnest($1::bigint[], $2::numeric[], $3::numeric[], $4::numeric[],
                     $5::numeric[], $6::numeric[]) AS x(t, o, h, l, c, v)`,
        [
            heures.map((heure) => heure.timestamp),
            heures.map((heure) => heure.open),
            heures.map((heure) => heure.high),
            heures.map((heure) => heure.low),
            heures.map((heure) => heure.close),
            heures.map((heure) => heure.volume),
        ]
    );

    return { ...rows[0], partiel: estPartielle(debut + JOUR_MS - 1) };
}

// Une journée : même interface quelle que soit la source
async function bougieDuJour(source, jour) {
    if (source.nom === 'kraken') return (await bougiesKraken(source.paire, jour, jour))[0] || null;
    if (source.nom === 'bitstamp') return bougieBitstamp(source.paire, jour);
    return bougieQuotidienne(source.paire, jour);
}

// Plusieurs journées, rendues par date. Binance et Kraken servent toute la
// plage en une requête ; Bitstamp, dont la journée se reconstitue heure par
// heure, est interrogé journée par journée — seulement pour celles que les
// sources précédentes n'ont pas couvertes.
async function bougiesPourJours(source, jours) {
    if (source.nom === 'bitstamp') {
        const parJour = new Map();
        for (const jour of jours) {
            const bougie = await bougieBitstamp(source.paire, jour);
            if (bougie) parJour.set(jour, bougie);
        }
        return parJour;
    }

    const debut = jours[0];
    const fin = jours[jours.length - 1];
    const bougies = source.nom === 'kraken'
        ? await bougiesKraken(source.paire, debut, fin)
        : await bougiesPeriode(source.paire, debut, fin);
    return new Map(bougies.map((bougie) => [bougie.jour, bougie]));
}

// Relève une plage de dates pour une crypto donnée. Comme ailleurs, une journée
// close déjà enregistrée n'est pas réécrite, sauf demande explicite ; une
// journée restée partielle, elle, est reprise sans qu'il faille le demander.
async function releverPeriode(idCrypto, debut, fin, ecraser) {
    const { rows } = await db.requete(
        'SELECT id, paire_binance, paire_kraken, paire_bitstamp FROM crypto WHERE id = $1',
        [idCrypto]
    );
    if (!rows.length) throw new Error('Crypto inconnue');
    const sources = sourcesDe(rows[0]);
    if (!sources.length) throw new Error(SANS_PAIRE[0].toUpperCase() + SANS_PAIRE.slice(1));

    const bilan = { id_crypto: idCrypto, releves: 0, ignorees: 0, jours: 0 };

    // Les journées figées sont écartées d'emblée : inutile d'interroger une
    // source pour une valeur qui ne sera pas réécrite.
    let restants = [];
    for (const jour of joursEntre(debut, fin)) {
        if (!ecraser && await valeurFigee(idCrypto, jour)) bilan.ignorees += 1;
        else restants.push(jour);
    }

    const erreurs = [];
    for (const source of sources) {
        if (!restants.length) break;

        let parJour;
        try {
            parJour = await bougiesPourJours(source, restants);
        } catch (err) {
            // Une source en panne ne prive pas des suivantes
            erreurs.push(`${source.nom} : ${err.message}`);
            continue;
        }

        const encore = [];
        for (const jour of restants) {
            const bougie = parJour.get(jour);
            if (!bougie) { encore.push(jour); continue; }
            await enregistrer(idCrypto, source, jour, bougie);
            bilan.releves += 1;
        }
        restants = encore;
    }

    if (!bilan.releves && erreurs.length) throw new Error(erreurs.join(' ; '));

    bilan.jours = bilan.releves + bilan.ignorees;
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
    // Toutes les cryptos du compte, paire ou non : celles qui n'en ont aucune
    // ressortent en échec plutôt que d'être écartées de la liste.
    const { rows: cryptos } = await db.requete(
        `SELECT DISTINCT c.id, c.paire_binance, c.paire_kraken, c.paire_bitstamp
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

        const sources = sourcesDe(crypto);
        if (!sources.length) {
            bilan.echecs.push({ id_crypto: crypto.id, raison: SANS_PAIRE });
            continue;
        }

        // Première source qui cote la journée ; les raisons des autres ne
        // servent qu'à expliquer un échec complet.
        const raisons = [];
        let retenue = null;
        for (const source of sources) {
            try {
                const bougie = await bougieDuJour(source, jour);
                if (bougie) { retenue = { source, bougie }; break; }
                raisons.push(`${source.nom} : aucune cotation ce jour-là`);
            } catch (err) {
                raisons.push(`${source.nom} : ${err.message}`);
            }
        }

        if (!retenue) {
            bilan.echecs.push({ id_crypto: crypto.id, raison: raisons.join(' ; ') });
            continue;
        }

        try {
            await enregistrer(crypto.id, retenue.source, jour, retenue.bougie);
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
        `SELECT a.id, a.paire_binance, a.paire_kraken, a.paire_bitstamp,
                to_char(j.jour, 'YYYY-MM-DD') AS jour
         FROM (SELECT DISTINCT (o.horodatage AT TIME ZONE 'Europe/Paris')::date AS jour
               FROM operation o
               WHERE o.utilisateur_id = $1 AND o.type = 'vente') j
         CROSS JOIN (SELECT DISTINCT c.id, c.paire_binance, c.paire_kraken, c.paire_bitstamp
                     FROM operation o
                     JOIN crypto c ON c.id = o.id_crypto
                     WHERE o.utilisateur_id = $1) a
         LEFT JOIN crypto_valeur v ON v.id_crypto = a.id AND v.date = j.jour
         WHERE (v.id_crypto IS NULL OR v.est_partiel)
           AND j.jour < (now() AT TIME ZONE 'UTC')::date
         ORDER BY a.id, j.jour`,
        [utilisateurId]
    );

    // Chaque source couvre en une passe toutes les journées encore à relever ;
    // celles qu'elle ne cote pas passent à la suivante. Binance plafonne à
    // 1000 bougies par réponse, Kraken ne remonte pas au-delà de 720 : ce
    // qu'aucune source ne couvre reste à reprendre au passage suivant.
    const parCrypto = new Map();
    const sansPaire = new Map();
    for (const ligne of rows) {
        const sources = sourcesDe(ligne);
        if (!sources.length) {
            sansPaire.set(ligne.id, (sansPaire.get(ligne.id) || 0) + 1);
            continue;
        }
        if (!parCrypto.has(ligne.id)) {
            parCrypto.set(ligne.id, { sources, jours: [] });
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
        let restants = cible.jours;

        for (const source of cible.sources) {
            if (!restants.length) break;

            let parJour;
            try {
                parJour = await bougiesPourJours(source, restants);
            } catch (err) {
                // Une source en panne ne prive pas des suivantes
                bilan.echecs.push({ id_crypto: idCrypto, raison: `${source.nom} : ${err.message}` });
                continue;
            }

            const encore = [];
            for (const jour of restants) {
                const bougie = parJour.get(jour);
                // Pas de cotation ici : la source suivante est interrogée
                if (!bougie) { encore.push(jour); continue; }
                // Bougie encore ouverte : on repassera, sans changer de source
                if (bougie.partiel) continue;

                try {
                    await enregistrer(idCrypto, source, jour, bougie);
                    bilan.completees.push({ id_crypto: idCrypto, jour });
                } catch (err) {
                    bilan.echecs.push({ id_crypto: idCrypto, jour, raison: err.message });
                }
            }
            restants = encore;
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
