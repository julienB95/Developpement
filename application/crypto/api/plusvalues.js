// Plus-values de cession d'actifs numeriques — article 150 VH bis du CGI.
//
//   plus-value = prix de cession net de frais
//              − (prix total d'acquisition × prix de cession / valeur globale du portefeuille)
//
// C'est la ligne 224 du formulaire 2086 : 218 − [223 × 217 / 212]. Le prix de
// cession du rapport est celui AVANT frais (ligne 217) ; seule la difference
// porte sur le prix net de frais (ligne 218). Le calcul suit le formulaire a
// la lettre, pour que la declaration se remplisse avec les chiffres affiches.
//
// Trois choses a retenir, parce qu'elles expliquent toute la forme du calcul :
//
//   - le prix total d'acquisition est celui du portefeuille ENTIER, diminue des
//     fractions deja imputees lors des cessions anterieures. Il faut donc
//     parcourir toutes les cessions depuis l'origine, pas seulement celles de
//     l'annee demandee ;
//   - la valeur globale du portefeuille est celle de TOUTES les cryptos
//     detenues au moment de la cession : la crypto cedee a son prix de
//     cession reel, les autres a leur cours d'ouverture du jour (0 h UTC)
//     releve dans crypto_valeur. C'est la convention de Waltio, retenue pour
//     que sa declaration puisse etre recoupee ici. Une crypto detenue mais non
//     valorisee sous-evalue le portefeuille, ce qui gonfle la fraction
//     imputee et minore la plus-value : ce cas est signale, jamais tu ;
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
       CASE WHEN c.prix_unitaire IS NULL THEN NULL
            ELSE (c.quantite * c.prix_unitaire)::text END AS prix_brut,
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
       -- La crypto cedee vaut son prix de cession reel, les autres leur cours
       -- d'ouverture du jour. Une cession sans prix est deja signalee par
       -- ailleurs : sa crypto n'est pas comptee une seconde fois.
       (SELECT COALESCE(SUM(v.quantite * CASE WHEN v.id_crypto = c.id_crypto
                                              THEN c.prix_unitaire
                                              ELSE cv.ouverture END), 0)
          FROM avoirs v
          LEFT JOIN crypto_valeur cv ON cv.id_crypto = v.id_crypto AND cv.date = c.jour
         WHERE v.cession = c.id)::text AS valeur_globale,
       (SELECT count(*)::int
          FROM avoirs v
          LEFT JOIN crypto_valeur cv ON cv.id_crypto = v.id_crypto AND cv.date = c.jour
         WHERE v.cession = c.id AND v.id_crypto <> c.id_crypto AND cv.ouverture IS NULL)
           AS valorisations_manquantes
FROM ops c
JOIN crypto r ON r.id = c.id_crypto
WHERE c.type = 'vente'
ORDER BY c.horodatage, c.id`;

// Une cession, un aller-retour : la fraction de capital initial depend du cumul
// des precedentes, la suite du calcul ne peut donc pas tenir en une requete.
// C'est le prix a payer pour que pas un montant ne touche un flottant.
//   $1 prix total d'acquisition (220)   $2 fractions deja imputees (221)
//   $3 valeur globale (212)             $4 prix net de frais (218)
//   $5 prix avant frais (217)
const IMPUTATION = `
SELECT f.fraction::text AS fraction,
       ($4::numeric - f.fraction)::text AS plus_value,
       ($2::numeric + f.fraction)::text AS cumul,
       ($1::numeric - $2::numeric)::text AS acquisition_nette
FROM (SELECT CASE WHEN $3::numeric > 0
                  THEN ($1::numeric - $2::numeric) * $5::numeric / $3::numeric
                  END AS fraction) f`;

// Seuil d'exoneration : des cessions dont le total n'excede pas 305 euros sur
// l'annee ne sont pas imposables (article 150 VH bis, II).
const SEUIL_EXONERATION = '305';

// Meme une somme est faite par PostgreSQL, a partir du tableau de chaines.
async function somme(valeurs) {
    if (!valeurs.length) return '0';
    const { rows } = await db.requete(
        'SELECT COALESCE(SUM(v), 0)::text AS total FROM unnest($1::numeric[]) AS v',
        [valeurs]
    );
    return rows[0].total;
}

// Plus-value rapportee a ce qu'ont coute les cryptos cedees, en pourcent : la
// fraction de capital imputee, soit le prix net moins la plus-value. Seules
// les cessions calculees y entrent, sans quoi le rapport melangerait des prix
// de cession sans plus-value en face. Nul si rien n'a ete impute.
async function rendement(lignes) {
    const calculees = lignes.filter((l) => l.plus_value !== null && l.prix_cession !== null);
    if (!calculees.length) return null;
    const { rows } = await db.requete(
        `SELECT CASE WHEN SUM(c - p) > 0 THEN (SUM(p) * 100 / SUM(c - p))::text END AS rendement
         FROM unnest($1::numeric[], $2::numeric[]) AS t(c, p)`,
        [calculees.map((l) => l.prix_cession), calculees.map((l) => l.plus_value)]
    );
    return rows[0].rendement;
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
        motifs.push(`${ligne.valorisations_manquantes} crypto(s) détenue(s) sans cours d'ouverture au ${ligne.jour}`);
    }
    return motifs;
}

// Deroule toutes les cessions depuis l'origine pour tenir le cumul des
// fractions a jour. Chaque cession garde tout ce que le formulaire 2086
// reclame : c'est le meme deroule qui sert l'accueil et la declaration, pour
// que les deux ne puissent pas diverger.
async function derouler(utilisateurId) {
    const staking = await conventionStaking(utilisateurId);
    const { rows: lignes } = await db.requete(
        CESSIONS, [utilisateurId, staking.convention === 'valeur_recue']
    );

    let cumul = '0';
    const cessions = [];

    for (const ligne of lignes) {
        let plusValue = null;
        let acquisitionNette = null;
        const cumulAvant = cumul;

        if (ligne.prix_cession !== null) {
            const { rows } = await db.requete(IMPUTATION, [
                ligne.acquisition, cumul, ligne.valeur_globale,
                ligne.prix_cession, ligne.prix_brut,
            ]);
            acquisitionNette = rows[0].acquisition_nette;
            // fraction nulle : valeur globale inconnue ou nulle, rien a imputer.
            // Le cumul ne bouge pas, la cession reste sans plus-value calculable.
            if (rows[0].fraction !== null) {
                plusValue = rows[0].plus_value;
                cumul = rows[0].cumul;
            }
        }

        const motifs = reserves(ligne);
        if (plusValue === null && !motifs.length) {
            motifs.push('valeur globale du portefeuille indisponible');
        }

        cessions.push({
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
            valeur_globale: ligne.valeur_globale,
            acquisition: ligne.acquisition,
            fractions_anterieures: cumulAvant,
            acquisition_nette: acquisitionNette,
            plus_value: plusValue,
            complet: plusValue !== null && motifs.length === 0,
            reserves: motifs,
        });
    }

    return { staking, cessions, cumul };
}

// Ce que le compte detient aujourd'hui, valorise au cours du moment, dans
// l'ordre ou la vente est simulee : la plus grosse ligne d'abord. La valeur
// globale de chaque ligne est celle des lignes non encore vendues, elle
// comprise : c'est la ligne 212 d'une cession qui interviendrait maintenant.
//   $1 utilisateur   $2 identifiants des cryptos cotees   $3 leurs cours en euro
const DETENTIONS_ACTUELLES = `
WITH detention AS (
    SELECT o.id_crypto, c.libelle,
           SUM(CASE WHEN o.type = 'vente' THEN -o.quantite ELSE o.quantite END) AS quantite
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
       (d.quantite * k.prix)::text AS valeur,
       (SUM(d.quantite * k.prix) OVER (
            ORDER BY d.quantite * k.prix DESC NULLS LAST, d.libelle
            ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING))::text AS valeur_globale,
       (now() AT TIME ZONE 'Europe/Paris')::date AS jour
FROM detention d
LEFT JOIN cours k ON k.id_crypto = d.id_crypto
ORDER BY d.quantite * k.prix DESC NULLS LAST, d.libelle`;

// Prix total d'acquisition du portefeuille a ce jour, selon la meme regle que
// pour une cession reelle.   $1 utilisateur   $2 staking compte a sa valeur
const ACQUISITION_ACTUELLE = `
SELECT COALESCE(SUM(o.quantite * o.prix_unitaire + o.frais)
                FILTER (WHERE o.prix_unitaire IS NOT NULL), 0)::text AS acquisition,
       (count(*) FILTER (WHERE o.prix_unitaire IS NULL))::int AS achats_sans_prix
FROM operation o
WHERE o.utilisateur_id = $1
  AND (o.type = 'achat' OR (o.type = 'staking' AND $2))`;

// Vente simulee de tout ce qui est detenu, au cours du moment et sans frais,
// a la suite des cessions reelles : le cumul des fractions reprend la ou elles
// l'ont laisse. Ce n'est qu'une estimation — les cours bougent, et d'autres
// operations peuvent intervenir d'ici la fin de l'annee.
async function simuler(utilisateurId, staking, cumulDepart, cotees) {
    const { rows: detentions } = await db.requete(DETENTIONS_ACTUELLES, [
        utilisateurId, cotees.map((actif) => actif.symbole), cotees.map((actif) => actif.prix),
    ]);
    const { rows: [acquis] } = await db.requete(
        ACQUISITION_ACTUELLE, [utilisateurId, staking.convention === 'valeur_recue']
    );

    // Une crypto sans cours ne peut pas etre vendue en simulation, et fausse
    // la valeur globale des autres : la reserve le dit sur chaque ligne.
    const nonCotees = detentions.filter((d) => d.valeur === null).length;
    const horodatage = new Date().toISOString();

    let cumul = cumulDepart;
    const lignes = [];

    for (const detention of detentions) {
        if (detention.valeur === null) continue;

        const { rows } = await db.requete(IMPUTATION, [
            acquis.acquisition, cumul, detention.valeur_globale,
            detention.valeur, detention.valeur,
        ]);

        const motifs = [];
        if (acquis.achats_sans_prix > 0) {
            motifs.push(`${acquis.achats_sans_prix} ligne(s) sans prix d'acquisition`);
        }
        if (nonCotees > 0) {
            motifs.push(`${nonCotees} crypto(s) détenue(s) sans cours actuel`);
        }

        let plusValue = null;
        if (rows[0].fraction !== null) {
            plusValue = rows[0].plus_value;
            cumul = rows[0].cumul;
        } else if (!motifs.length) {
            motifs.push('valeur globale du portefeuille indisponible');
        }

        lignes.push({
            id: null,
            horodatage,
            jour: detention.jour,
            id_crypto: detention.id_crypto,
            libelle: detention.libelle,
            quantite: detention.quantite,
            prix_cession: detention.valeur,
            valeur_globale: detention.valeur_globale,
            plus_value: plusValue,
            complet: plusValue !== null && motifs.length === 0,
            reserves: motifs,
            simulee: true,
        });
    }

    return lignes;
}

// Les cessions de l'annee demandee, regroupees par crypto. Pour l'annee en
// cours, `simulation` porte les cours du moment ({ cotees, releve_le, source }) :
// ce qui est encore detenu est alors compte comme vendu aujourd'hui, et le
// resultat est une estimation. Sans cours, `simulation.cours_indisponible`
// en donne la raison et seules les cessions reelles sont retenues.
async function parAnnee(utilisateurId, annee, simulation) {
    const { staking, cessions, cumul } = await derouler(utilisateurId);
    const retenues = cessions
        .filter((c) => c.annee === annee)
        .map((c) => ({
            id: c.id,
            horodatage: c.horodatage,
            jour: c.jour,
            id_crypto: c.id_crypto,
            libelle: c.libelle,
            quantite: c.quantite,
            prix_cession: c.prix_cession,
            valeur_globale: c.valeur_globale,
            plus_value: c.plus_value,
            complet: c.complet,
            reserves: c.reserves,
            simulee: false,
        }));

    if (simulation && simulation.cotees) {
        retenues.push(...await simuler(utilisateurId, staking, cumul, simulation.cotees));
    }

    const resultat = await regrouper(annee, retenues, await bornes(utilisateurId));
    resultat.staking = staking;
    resultat.estimation = simulation
        ? {
            source: simulation.source || null,
            releve_le: simulation.releve_le || null,
            cours_indisponible: simulation.cours_indisponible || null,
        }
        : null;
    return resultat;
}

// Le formulaire en ligne recalcule lui-meme ses lignes 215, 217, 218, 223 et
// 224 a partir des montants saisis, arrondis a l'euro, et ces cases ne se
// modifient pas : ce sont ses chiffres qui partent en case 3AN ou 3BN. La
// declaration les reproduit a l'identique ; seules les lignes saisies (212 a
// 214, 220 et 221) viennent du calcul exact. ROUND arrondit a l'euro le plus
// proche, la moitie s'eloignant de zero. Sans soulte, 216 et 222 valent zero.
const FORMULAIRE = `
SELECT f.rang,
       f.l212::text AS l212,
       f.l213::text AS l213,
       f.l214::text AS l214,
       (f.l213 - f.l214)::text AS l215,
       f.l213::text AS l217,
       (f.l213 - f.l214)::text AS l218,
       f.l220::text AS l220,
       f.l221::text AS l221,
       (f.l220 - f.l221)::text AS l223,
       CASE WHEN f.l212 > 0
            THEN round((f.l213 - f.l214) - (f.l220 - f.l221) * f.l213 / f.l212)::text
       END AS l224
FROM (SELECT x.rang, round(x.l212) AS l212, round(x.l213) AS l213, round(x.l214) AS l214,
             round(x.l220) AS l220, round(x.l221) AS l221
        FROM unnest($1::int[], $2::numeric[], $3::numeric[], $4::numeric[],
                    $5::numeric[], $6::numeric[]) AS x(rang, l212, l213, l214, l220, l221)) f
ORDER BY f.rang`;

// Les cases du 2086 d'une serie de cessions, telles que le formulaire les calcule
async function formulaire(cessions) {
    if (!cessions.length) return [];
    const { rows } = await db.requete(FORMULAIRE, [
        cessions.map((c, rang) => rang),
        cessions.map((c) => c.valeur_globale),
        cessions.map((c) => c.prix_brut),
        cessions.map((c) => c.frais),
        cessions.map((c) => c.acquisition),
        cessions.map((c) => c.fractions_anterieures),
    ]);
    return rows;
}

// Une ligne par annee de cession, de la plus recente a la plus ancienne. La
// plus-value est celle du formulaire, comme dans la declaration de l'annee.
async function parAnnees(utilisateurId) {
    const { staking, cessions } = await derouler(utilisateurId);

    const annees = [...new Set(cessions.map((c) => c.annee))].sort((a, b) => b - a);
    const resultat = [];
    for (const annee of annees) {
        const lignes = cessions.filter((c) => c.annee === annee);
        const calculees = (await formulaire(lignes)).filter((l) => l.l224 !== null);
        resultat.push({
            annee,
            cessions: lignes.length,
            prix_cession: await somme(lignes.map((c) => c.prix_brut).filter(Boolean)),
            plus_value: calculees.length ? await somme(calculees.map((l) => l.l224)) : null,
            complet: lignes.every((c) => c.complet),
        });
    }

    return { staking, annees: resultat };
}

// Ce qu'il faut reporter sur la declaration de l'annee : le detail du
// formulaire 2086, cession par cession, tel que le formulaire le calcule, et
// le total a porter sur la 2042-C. Il n'y a ni echange entre cryptos ni soulte
// ici : les lignes 216 et 222 valent zero, et la ligne 217 reprend la 213.
async function declaration(utilisateurId, annee) {
    const { staking, cessions } = await derouler(utilisateurId);
    const retenues = cessions.filter((c) => c.annee === annee);
    const cases = await formulaire(retenues);

    const lignes = retenues.map((c, rang) => ({
        numero: rang + 1,
        id_crypto: c.id_crypto,
        libelle: c.libelle,
        quantite: c.quantite,
        horodatage: c.horodatage,
        l211: c.jour,
        l212: cases[rang].l212,
        l213: cases[rang].l213,
        l214: cases[rang].l214,
        l215: cases[rang].l215,
        l216: '0',
        l217: cases[rang].l217,
        l218: cases[rang].l218,
        l220: cases[rang].l220,
        l221: cases[rang].l221,
        l222: '0',
        l223: cases[rang].l223,
        l224: cases[rang].l224,
        complet: c.complet,
        reserves: c.reserves,
    }));

    const calculees = lignes.filter((l) => l.l224 !== null);
    const plusValue = calculees.length ? await somme(calculees.map((l) => l.l224)) : null;
    // Le meme total sans les arrondis du formulaire, pour memoire
    const exactes = retenues.filter((c) => c.plus_value !== null);
    const plusValueExacte = exactes.length ? await somme(exactes.map((c) => c.plus_value)) : null;
    // Le seuil d'exoneration se juge sur les montants reels, pas arrondis
    const prixCession = await somme(retenues.map((c) => c.prix_brut).filter(Boolean));

    const { rows } = await db.requete(
        'SELECT $1::numeric <= $2::numeric AS exoneree', [prixCession, SEUIL_EXONERATION]
    );

    // Plus-value en 3AN, moins-value en 3BN, toujours en montant positif
    let caseDeclaration = null;
    let montantCase = null;
    if (plusValue !== null) {
        const negative = plusValue.charAt(0) === '-';
        caseDeclaration = negative ? '3BN' : '3AN';
        montantCase = negative ? plusValue.slice(1) : plusValue;
    }

    const motifs = [];
    lignes.forEach((l) => l.reserves.forEach((m) => { if (motifs.indexOf(m) === -1) motifs.push(m); }));

    return {
        annee,
        staking,
        cessions: lignes,
        total: {
            cessions: lignes.length,
            prix_cession: prixCession,
            frais: await somme(retenues.map((c) => c.frais).filter(Boolean)),
            plus_value: plusValue,
            plus_value_exacte: plusValueExacte,
            case: caseDeclaration,
            montant_case: montantCase,
            exoneree: lignes.length > 0 && rows[0].exoneree,
            seuil_exoneration: SEUIL_EXONERATION,
        },
        complet: lignes.every((l) => l.complet),
        reserves: motifs,
    };
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
            cessions: groupe.lignes.filter((l) => !l.simulee).length,
            vente_simulee: groupe.lignes.some((l) => l.simulee),
            prix_cession: await somme(groupe.lignes.map((l) => l.prix_cession).filter(Boolean)),
            plus_value: calculees.length ? await somme(calculees.map((l) => l.plus_value)) : null,
            rendement: await rendement(groupe.lignes),
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
            cessions: retenues.filter((l) => !l.simulee).length,
            ventes_simulees: retenues.filter((l) => l.simulee).length,
            prix_cession: await somme(retenues.map((l) => l.prix_cession).filter(Boolean)),
            plus_value: calculees.length ? await somme(calculees.map((l) => l.plus_value)) : null,
            rendement: await rendement(retenues),
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

module.exports = { parAnnee, parAnnees, declaration };
