// Plus-values de cession d'actifs numeriques — article 150 VH bis du CGI.
//
//   plus-value = prix de cession
//              − (prix total d'acquisition × prix de cession / valeur globale du portefeuille)
//
// Trois choses a retenir, parce qu'elles expliquent toute la forme du calcul :
//
//   - le prix total d'acquisition est celui du portefeuille ENTIER, diminue des
//     fractions deja imputees lors des cessions anterieures. Il faut donc
//     parcourir toutes les cessions depuis l'origine, pas seulement celles de
//     l'annee demandee ;
//   - la valeur globale du portefeuille est celle de TOUTES les cryptos
//     detenues au moment de la cession, au VWAP du jour releve dans
//     crypto_valeur. Une crypto detenue mais non valorisee la sous-evalue,
//     donc surevalue la plus-value : ce cas est signale, jamais tu ;
//   - le prix de cession et le prix d'acquisition sont les montants reellement
//     encaisses et payes, jamais un cours de marche.
//
// Le cas des recompenses de staking n'est pas tranche : rien n'a ete acquitte
// en monnaie, mais leur valeur a la reception a pu etre imposee en revenu. Les
// deux lectures se defendent et donnent des plus-values differentes, aussi la
// convention est-elle portee par le compte (utilisateur.staking_acquisition)
// et rappelee dans le resultat, jamais choisie ici.
//
// Aucun montant ne passe par un flottant JavaScript : toute l'arithmetique est
// faite par PostgreSQL en NUMERIC, les montants circulent en chaine decimale et
// l'arrondi n'a lieu qu'a l'affichage.
const db = require('../../_commun/api/db');

// Une cession par ligne, dans l'ordre chronologique, avec tout ce que la
// formule reclame sauf le cumul des fractions — qui, lui, se construit cession
// apres cession et ne peut pas sortir d'une seule passe.
const CESSIONS = `
WITH ops AS (
    SELECT o.id, o.horodatage, o.type, o.id_crypto, o.quantite,
           o.prix_unitaire, o.frais,
           (o.horodatage AT TIME ZONE 'Europe/Paris')::date AS jour
    FROM operation o
    WHERE o.utilisateur_id = $1
),
avoirs AS (
    -- Quantite detenue de chaque crypto juste avant chaque cession : c'est
    -- elle qui est valorisee, la cession n'etant pas encore intervenue.
    SELECT c.id AS cession, d.id_crypto,
           SUM(CASE WHEN d.type = 'vente' THEN -d.quantite ELSE d.quantite END) AS quantite
    FROM ops c
    JOIN ops d ON (d.horodatage, d.id) < (c.horodatage, c.id)
    WHERE c.type = 'vente'
    GROUP BY c.id, d.id_crypto
    HAVING SUM(CASE WHEN d.type = 'vente' THEN -d.quantite ELSE d.quantite END) > 0
)
SELECT c.id,
       c.horodatage,
       c.jour,
       EXTRACT(YEAR FROM c.jour)::int AS annee,
       c.id_crypto,
       r.libelle,
       c.quantite::text AS quantite,
       c.prix_unitaire::text AS prix_unitaire,
       c.frais::text AS frais,
       CASE WHEN c.prix_unitaire IS NULL THEN NULL
            ELSE (c.quantite * c.prix_unitaire - c.frais)::text END AS prix_cession,
       -- $2 : les récompenses de staking comptent-elles dans le prix
       -- d'acquisition ? Faux, elles n'ont rien coûté et pèsent zéro ; vrai,
       -- leur valeur à la réception est retenue comme prix payé.
       (SELECT COALESCE(SUM(a.quantite * a.prix_unitaire + a.frais), 0)
          FROM ops a
         WHERE (a.type = 'achat' OR (a.type = 'staking' AND $2))
           AND a.prix_unitaire IS NOT NULL
           AND (a.horodatage, a.id) <= (c.horodatage, c.id))::text AS acquisition,
       (SELECT count(*)::int
          FROM ops a
         WHERE (a.type = 'achat' OR (a.type = 'staking' AND $2))
           AND a.prix_unitaire IS NULL
           AND (a.horodatage, a.id) <= (c.horodatage, c.id)) AS achats_sans_prix,
       (SELECT COALESCE(SUM(v.quantite * cv.vwap), 0)
          FROM avoirs v
          JOIN crypto_valeur cv ON cv.id_crypto = v.id_crypto AND cv.date = c.jour
         WHERE v.cession = c.id AND cv.vwap IS NOT NULL)::text AS valeur_globale,
       (SELECT count(*)::int
          FROM avoirs v
          LEFT JOIN crypto_valeur cv ON cv.id_crypto = v.id_crypto AND cv.date = c.jour
         WHERE v.cession = c.id AND (cv.id_crypto IS NULL OR cv.vwap IS NULL))
           AS valorisations_manquantes
FROM ops c
JOIN crypto r ON r.id = c.id_crypto
WHERE c.type = 'vente'
ORDER BY c.horodatage, c.id`;

// Une cession, un aller-retour : la fraction de capital initial depend du cumul
// des precedentes, la suite du calcul ne peut donc pas tenir en une requete.
// C'est le prix a payer pour que pas un montant ne touche un flottant.
const IMPUTATION = `
SELECT f.fraction::text AS fraction,
       ($4::numeric - f.fraction)::text AS plus_value,
       ($2::numeric + f.fraction)::text AS cumul
FROM (SELECT CASE WHEN $3::numeric > 0
                  THEN ($1::numeric - $2::numeric) * $4::numeric / $3::numeric
                  END AS fraction) f`;

// Meme une somme est faite par PostgreSQL, a partir du tableau de chaines.
async function somme(valeurs) {
    if (!valeurs.length) return '0';
    const { rows } = await db.requete(
        'SELECT COALESCE(SUM(v), 0)::text AS total FROM unnest($1::numeric[]) AS v',
        [valeurs]
    );
    return rows[0].total;
}

// Ce qui empeche de tenir une cession pour calculee. La liste est renvoyee
// telle quelle a l'interface : mieux vaut un chiffre accompagne de sa reserve
// qu'un chiffre presente comme sur alors qu'il ne l'est pas.
function reserves(ligne) {
    const motifs = [];
    if (ligne.prix_cession === null) {
        motifs.push("prix de vente non renseigné");
    }
    if (ligne.achats_sans_prix > 0) {
        motifs.push(`${ligne.achats_sans_prix} ligne(s) sans prix d'acquisition`);
    }
    if (ligne.valorisations_manquantes > 0) {
        motifs.push(`${ligne.valorisations_manquantes} crypto(s) détenue(s) sans valeur au ${ligne.jour}`);
    }
    return motifs;
}

// Deroule toutes les cessions depuis l'origine pour tenir le cumul des
// fractions a jour, et ne retient que celles de l'annee demandee.
async function parAnnee(utilisateurId, annee) {
    const staking = await conventionStaking(utilisateurId);
    const { rows: lignes } = await db.requete(
        CESSIONS, [utilisateurId, staking.convention === 'valeur_recue']
    );

    let cumul = '0';
    const retenues = [];

    for (const ligne of lignes) {
        let plusValue = null;

        if (ligne.prix_cession !== null) {
            const { rows } = await db.requete(IMPUTATION, [
                ligne.acquisition, cumul, ligne.valeur_globale, ligne.prix_cession,
            ]);
            // fraction nulle : valeur globale inconnue ou nulle, rien a imputer.
            // Le cumul ne bouge pas, la cession reste sans plus-value calculable.
            if (rows[0].fraction !== null) {
                plusValue = rows[0].plus_value;
                cumul = rows[0].cumul;
            }
        }

        if (ligne.annee !== annee) continue;

        const motifs = reserves(ligne);
        if (plusValue === null && !motifs.length) {
            motifs.push('valeur globale du portefeuille indisponible');
        }

        retenues.push({
            id: ligne.id,
            horodatage: ligne.horodatage,
            jour: ligne.jour,
            id_crypto: ligne.id_crypto,
            libelle: ligne.libelle,
            quantite: ligne.quantite,
            prix_cession: ligne.prix_cession,
            valeur_globale: ligne.valeur_globale,
            plus_value: plusValue,
            complet: plusValue !== null && motifs.length === 0,
            reserves: motifs,
        });
    }

    const resultat = await regrouper(annee, retenues, await bornes(utilisateurId));
    resultat.staking = staking;
    return resultat;
}

// La convention retenue par le compte, et de quoi savoir si elle change
// quelque chose : sans aucune recompense de staking, elle n'a aucun effet et
// l'interface n'a pas a l'afficher.
async function conventionStaking(utilisateurId) {
    const { rows } = await db.requete(
        `SELECT u.staking_acquisition AS convention,
                (SELECT count(*)::int FROM operation o
                  WHERE o.utilisateur_id = u.id AND o.type = 'staking') AS operations
         FROM utilisateur u WHERE u.id = $1`,
        [utilisateurId]
    );
    return rows.length
        ? { convention: rows[0].convention, operations: rows[0].operations }
        : { convention: 'nulle', operations: 0 };
}

// Regroupement par crypto : la formule, elle, reste portefeuille entier.
// Additionner les cessions d'une meme crypto ne change donc aucun resultat,
// c'est une presentation, pas un calcul a part.
async function regrouper(annee, retenues, encadrement) {
    const parCrypto = new Map();

    for (const cession of retenues) {
        if (!parCrypto.has(cession.id_crypto)) {
            parCrypto.set(cession.id_crypto, {
                id_crypto: cession.id_crypto,
                libelle: cession.libelle,
                lignes: [],
            });
        }
        parCrypto.get(cession.id_crypto).lignes.push(cession);
    }

    const cryptos = [];
    for (const groupe of parCrypto.values()) {
        const calculees = groupe.lignes.filter((l) => l.plus_value !== null);
        cryptos.push({
            id_crypto: groupe.id_crypto,
            libelle: groupe.libelle,
            cessions: groupe.lignes.length,
            prix_cession: await somme(groupe.lignes.map((l) => l.prix_cession).filter(Boolean)),
            plus_value: calculees.length ? await somme(calculees.map((l) => l.plus_value)) : null,
            complet: groupe.lignes.every((l) => l.complet),
            lignes: groupe.lignes,
        });
    }

    cryptos.sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr'));

    const calculees = retenues.filter((l) => l.plus_value !== null);

    return {
        annee,
        devise: 'EUR',
        cryptos,
        total: {
            cessions: retenues.length,
            prix_cession: await somme(retenues.map((l) => l.prix_cession).filter(Boolean)),
            plus_value: calculees.length ? await somme(calculees.map((l) => l.plus_value)) : null,
        },
        complet: retenues.every((l) => l.complet),
        premiere_annee: encadrement.premiere,
        derniere_annee: encadrement.derniere,
    };
}

// De quoi borner les fleches de l'interface : inutile de proposer une annee
// ou le compte n'avait aucune operation.
async function bornes(utilisateurId) {
    const { rows } = await db.requete(
        `SELECT EXTRACT(YEAR FROM (MIN(o.horodatage) AT TIME ZONE 'Europe/Paris'))::int AS premiere,
                EXTRACT(YEAR FROM (MAX(o.horodatage) AT TIME ZONE 'Europe/Paris'))::int AS derniere
         FROM operation o
         WHERE o.utilisateur_id = $1`,
        [utilisateurId]
    );
    return { premiere: rows[0].premiere, derniere: rows[0].derniere };
}

module.exports = { parAnnee };
