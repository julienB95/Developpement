// Prix d'achat moyen et plus-values de cession selon la méthode d'affichage
// choisie dans le profil (utilisateur.methode_calcul) :
//
//   'france' et 'cmp' — coût moyen pondéré (CMP), crypto par crypto, toutes
//       plateformes confondues : un achat ajoute sa quantité et son coût (frais
//       compris) ; une vente retire sa quantité au prix moyen du moment, sans le
//       modifier. 'france' ne diffère de 'cmp' que pour les plus-values de
//       cession, calculées alors par plusvalues.js (article 150 VH bis).
//
//   'fifo' — premier entré, premier sorti, plateforme par plateforme : une vente
//       consomme les achats les plus anciens de SA plateforme, jamais ceux d'une
//       autre (une vente chez Bitstack ne peut pas puiser dans un achat fait chez
//       Trade Republic). C'est la méthode des courtiers allemands.
//
// Ces calculs ne servent qu'à l'affichage. La déclaration fiscale applique
// toujours la méthode française, imposée par la loi, quel que soit le réglage.
//
// Le staking ajoute sa quantité ; son coût suit la convention du compte : nul,
// ou valeur à la réception. Aucun montant ne passe par un flottant : tout est
// calculé par PostgreSQL en NUMERIC et circule en chaîne décimale.
const db = require('../../_commun/api/db');

const METHODES = ['france', 'cmp', 'fifo'];

// Coût d'une entrée et absence de prix, communs aux deux méthodes.
//   $1 utilisateur   $2 crypto (NULL : toutes)   $3 staking compté à sa valeur
const COUT_ENTREE = `
    CASE WHEN o.type = 'achat'
             THEN o.quantite * COALESCE(o.prix_unitaire, 0) + o.frais
         WHEN o.type = 'staking' AND $3
             THEN o.quantite * COALESCE(o.prix_unitaire, 0)
         ELSE 0 END::numeric AS cout,
    (o.prix_unitaire IS NULL AND (o.type = 'achat' OR (o.type = 'staking' AND $3)))::int AS sans_prix`;

// --- Coût moyen pondéré -------------------------------------------------------
// Une opération après l'autre, crypto par crypto : le prix moyen dépend de tout
// ce qui précède, d'où la requête récursive. cout_sorti est le coût retiré par
// une vente ; detenue_avant permet de repérer une vente plus grosse que le stock.
const SUIVI_CMP = `
WITH RECURSIVE ops AS (
    SELECT row_number() OVER (PARTITION BY o.id_crypto ORDER BY o.horodatage, o.id) AS rang,
           o.id, o.id_crypto, o.type, o.quantite::numeric AS quantite,
           ${COUT_ENTREE}
    FROM operation o
    WHERE o.utilisateur_id = $1 AND ($2::text IS NULL OR o.id_crypto = $2)
),
suivi (id_crypto, rang, id, type, quantite, cout, cout_sorti, detenue_avant, vendue, sans_prix) AS (
    SELECT DISTINCT id_crypto, 0::bigint, NULL::bigint, NULL::text, 0::numeric, 0::numeric,
           NULL::numeric, NULL::numeric, NULL::numeric, 0
    FROM ops
    UNION ALL
    SELECT o.id_crypto, o.rang, o.id, o.type,
           CASE WHEN o.type = 'vente' THEN s.quantite - o.quantite ELSE s.quantite + o.quantite END,
           CASE WHEN o.type <> 'vente' THEN s.cout + o.cout
                WHEN s.quantite > 0 THEN s.cout * GREATEST(s.quantite - o.quantite, 0) / s.quantite
                ELSE 0 END,
           CASE WHEN o.type = 'vente'
                THEN CASE WHEN s.quantite > 0
                          THEN s.cout * LEAST(o.quantite, s.quantite) / s.quantite
                          ELSE 0 END
           END,
           s.quantite,
           CASE WHEN o.type = 'vente' THEN o.quantite END,
           s.sans_prix + o.sans_prix
    FROM suivi s
    JOIN ops o ON o.id_crypto = s.id_crypto AND o.rang = s.rang + 1
)`;

const VENTES_CMP = `${SUIVI_CMP},
couts AS (
    SELECT id, cout_sorti AS cout, detenue_avant < vendue AS survente, sans_prix
    FROM suivi WHERE type = 'vente'
)`;

const POSITIONS_CMP = `${SUIVI_CMP}
SELECT DISTINCT ON (id_crypto)
       id_crypto,
       rang::int AS operations,
       quantite::text AS quantite,
       cout::text AS cout,
       CASE WHEN quantite > 0 THEN (cout / quantite)::text END AS prix_moyen,
       sans_prix,
       FALSE AS ecart
FROM suivi
ORDER BY id_crypto, rang DESC`;

// --- Premier entré, premier sorti, par plateforme ------------------------------
// Chaque entrée (achat ou staking) occupe une tranche [debut, fin) de la file de
// sa plateforme ; chaque vente aussi, dans la file des ventes. Une vente consomme
// exactement les tranches d'entrées qui chevauchent la sienne, acquises avant
// elle. Le reste d'une entrée est ce qui dépasse le total vendu sur la plateforme.
const FILES_FIFO = `
WITH ops AS (
    SELECT o.id, o.horodatage, o.type, o.id_crypto, COALESCE(o.plateforme, '') AS plateforme,
           o.quantite,
           ${COUT_ENTREE}
    FROM operation o
    WHERE o.utilisateur_id = $1 AND ($2::text IS NULL OR o.id_crypto = $2)
),
lots AS (
    SELECT e.*, SUM(e.quantite) OVER w - e.quantite AS debut, SUM(e.quantite) OVER w AS fin
    FROM ops e
    WHERE e.type <> 'vente'
    WINDOW w AS (PARTITION BY e.id_crypto, e.plateforme ORDER BY e.horodatage, e.id)
),
ventes AS (
    SELECT v.*, SUM(v.quantite) OVER w - v.quantite AS debut, SUM(v.quantite) OVER w AS fin
    FROM ops v
    WHERE v.type = 'vente'
    WINDOW w AS (PARTITION BY v.id_crypto, v.plateforme ORDER BY v.horodatage, v.id)
)`;

const VENTES_FIFO = `${FILES_FIFO},
couts AS (
    SELECT v.id,
           COALESCE(SUM(l.cout * (LEAST(l.fin, v.fin) - GREATEST(l.debut, v.debut)) / l.quantite), 0) AS cout,
           COALESCE(SUM(LEAST(l.fin, v.fin) - GREATEST(l.debut, v.debut)), 0) < v.quantite AS survente,
           (count(l.id) FILTER (WHERE l.sans_prix = 1))::int AS sans_prix
    FROM ventes v
    LEFT JOIN lots l
           ON l.id_crypto = v.id_crypto AND l.plateforme = v.plateforme
          AND l.debut < v.fin AND l.fin > v.debut
          AND (l.horodatage, l.id) < (v.horodatage, v.id)
    GROUP BY v.id, v.quantite
)`;

const POSITIONS_FIFO = `${FILES_FIFO},
vendu AS (
    SELECT id_crypto, plateforme, SUM(quantite) AS total FROM ventes GROUP BY id_crypto, plateforme
),
restes AS (
    SELECT l.id_crypto,
           SUM(GREATEST(l.fin - GREATEST(l.debut, COALESCE(t.total, 0)), 0)) AS quantite,
           SUM(l.cout * GREATEST(l.fin - GREATEST(l.debut, COALESCE(t.total, 0)), 0) / l.quantite) AS cout,
           (count(*) FILTER (WHERE l.sans_prix = 1 AND l.fin > COALESCE(t.total, 0)))::int AS sans_prix
    FROM lots l
    LEFT JOIN vendu t ON t.id_crypto = l.id_crypto AND t.plateforme = l.plateforme
    GROUP BY l.id_crypto
),
net AS (
    SELECT id_crypto, count(*)::int AS operations,
           SUM(CASE WHEN type = 'vente' THEN -quantite ELSE quantite END) AS quantite
    FROM ops GROUP BY id_crypto
)
SELECT n.id_crypto,
       n.operations,
       n.quantite::text AS quantite,
       COALESCE(r.cout, 0)::text AS cout,
       CASE WHEN r.quantite > 0 THEN (r.cout / r.quantite)::text END AS prix_moyen,
       COALESCE(r.sans_prix, 0) AS sans_prix,
       COALESCE(r.quantite, 0) <> GREATEST(n.quantite, 0) AS ecart
FROM net n
LEFT JOIN restes r ON r.id_crypto = n.id_crypto`;

// Les ventes et leur plus-value, une fois le coût de chacune connu (CTE couts)
const CESSIONS = `
SELECT o.id,
       o.horodatage,
       (o.horodatage AT TIME ZONE 'Europe/Paris')::date AS jour,
       EXTRACT(YEAR FROM (o.horodatage AT TIME ZONE 'Europe/Paris'))::int AS annee,
       o.id_crypto,
       r.libelle,
       o.plateforme,
       o.quantite::text AS quantite,
       o.frais::text AS frais,
       CASE WHEN o.prix_unitaire IS NULL THEN NULL
            ELSE (o.quantite * o.prix_unitaire)::text END AS prix_brut,
       CASE WHEN o.prix_unitaire IS NULL THEN NULL
            ELSE (o.quantite * o.prix_unitaire - o.frais)::text END AS prix_cession,
       k.cout::text AS cout,
       CASE WHEN o.prix_unitaire IS NULL THEN NULL
            ELSE (o.quantite * o.prix_unitaire - o.frais - k.cout)::text END AS plus_value,
       k.survente,
       k.sans_prix
FROM couts k
JOIN operation o ON o.id = k.id
JOIN crypto r ON r.id = o.id_crypto
ORDER BY o.horodatage, o.id`;

function verifierMethode(methode) {
    if (!METHODES.includes(methode)) throw new Error(`Méthode de calcul inconnue : ${methode}`);
}

// Position restante de chaque crypto du compte (ou d'une seule) : quantité
// détenue, coût de ce qui reste selon la méthode, prix d'achat moyen. `ecart`
// signale qu'en FIFO les files par plateforme ne retombent pas sur la quantité
// détenue (une vente plus grosse que le stock de sa plateforme, par exemple
// après un transfert non saisi).
async function positions(utilisateurId, methode, stakingValorise, idCrypto = null) {
    verifierMethode(methode);
    const { rows } = await db.requete(
        methode === 'fifo' ? POSITIONS_FIFO : POSITIONS_CMP,
        [utilisateurId, idCrypto, stakingValorise]
    );
    return rows;
}

// Toutes les ventes du compte avec leur coût et leur plus-value selon la
// méthode, et ce qui empêche de tenir le chiffre pour sûr.
async function cessions(utilisateurId, methode, stakingValorise) {
    verifierMethode(methode);
    const { rows } = await db.requete(
        `${methode === 'fifo' ? VENTES_FIFO : VENTES_CMP}${CESSIONS}`,
        [utilisateurId, null, stakingValorise]
    );

    return rows.map((ligne) => {
        const reserves = [];
        if (ligne.prix_cession === null) reserves.push('prix de vente non renseigné');
        if (ligne.sans_prix > 0) reserves.push(`${ligne.sans_prix} ligne(s) sans prix d'acquisition`);
        if (ligne.survente) {
            reserves.push(methode === 'fifo'
                ? `quantité vendue supérieure à la quantité détenue sur ${ligne.plateforme || 'la plateforme'}`
                : 'quantité vendue supérieure à la quantité détenue');
        }
        return {
            id: ligne.id,
            annee: ligne.annee,
            horodatage: ligne.horodatage,
            jour: ligne.jour,
            id_crypto: ligne.id_crypto,
            libelle: ligne.libelle,
            quantite: ligne.quantite,
            frais: ligne.frais,
            prix_brut: ligne.prix_brut,
            prix_cession: ligne.prix_cession,
            cout: ligne.cout,
            plus_value: ligne.plus_value,
            complet: ligne.plus_value !== null && reserves.length === 0,
            reserves,
        };
    });
}

module.exports = { METHODES, positions, cessions };
