// Import d'operations depuis un fichier tableur.
//
// Deux formats sont acceptes : le classeur .xlsx, lu et ecrit par api/xlsx.js
// sans bibliotheque, et le CSV a point-virgule pour qui prefere. Le modele
// propose au telechargement est un .xlsx, parce que lui seul peut porter des
// listes deroulantes.
//
// Trois tolerances, parce que c'est ce que produit un tableur francais :
//   - la virgule decimale (le separateur de colonne etant le point-virgule,
//     il n'y a aucune ambiguite) ;
//   - les dates en JJ/MM/AAAA aussi bien qu'en AAAA-MM-JJ ;
//   - la notation scientifique, qu'Excel glisse sous les tres petits nombres.
//
// Les heures saisies sont des heures de Paris. La conversion en UTC est faite
// par PostgreSQL (`::timestamp AT TIME ZONE 'Europe/Paris'`), qui connait les
// changements d'heure : aucun decalage n'est calcule ici.
const db = require('../../_commun/api/db');
const xlsx = require('./xlsx');

const SEPARATEUR = ';';
const TAILLE_MAX = 500 * 1024;

// Le staking fait entrer de la crypto comme un achat, mais sans contrepartie
// en argent : ni frais, ni prix d'acquisition a imputer.
const TYPES = ['achat', 'vente', 'staking'];

// Chaque colonne attendue, avec les en-tetes acceptes une fois normalises.
// Le premier alias est celui du modele. L'exemple ne sert qu'au tableau
// affiche a l'ecran : le fichier telecharge, lui, est vide.
const COLONNES = [
    { cle: 'date', alias: ['date', 'date_heure', 'horodatage'], obligatoire: true,
      exemple: '2026-01-15 10:30',
      aide: 'AAAA-MM-JJ HH:MM ou JJ/MM/AAAA HH:MM (heure de Paris). Sans heure : 00:00.' },
    // « sens » reste accepté en en-tête : les fichiers remplis avant que la
    // colonne ne change de nom continuent de passer.
    { cle: 'type', alias: ['type', 'sens'], obligatoire: true,
      exemple: 'achat',
      liste: 'type',
      aide: 'achat, vente ou staking. Liste déroulante dans le modèle.' },
    { cle: 'crypto', alias: ['crypto', 'actif', 'symbole'], obligatoire: true,
      exemple: 'BTC',
      liste: 'crypto',
      aide: 'Code du référentiel : BTC, ETH, SOL… Liste déroulante dans le modèle.' },
    { cle: 'quantite', alias: ['quantite', 'qte'], obligatoire: true,
      exemple: '0,05',
      aide: 'Quantité de crypto, strictement positive. Virgule ou point décimal.' },
    { cle: 'prix_unitaire', alias: ['prix_unitaire', 'prix', 'cours'], obligatoire: false,
      exemple: '62000',
      aide: "Prix d'une unité, en euro. Sans lui, aucune plus-value n'est calculable." },
    { cle: 'frais', alias: ['frais'], obligatoire: false,
      exemple: '5',
      aide: "Frais de l'opération, en euro. Vide vaut 0. Interdits sur un staking." },
    { cle: 'plateforme', alias: ['plateforme', 'exchange'], obligatoire: false,
      exemple: 'Binance',
      liste: 'plateforme',
      aide: 'Liste déroulante dans le modèle. Vide accepté.' },
];

// Largeur de colonne du modele, et colonnes forcees en texte. Une quantite de
// crypto compte jusqu'a dix-huit decimales : en nombre, Excel la ramenerait a
// un flottant et perdrait les derniers chiffres sans rien dire.
const MISE_EN_PAGE = {
    date: { largeur: 20, texte: true },
    type: { largeur: 12 },
    crypto: { largeur: 12 },
    quantite: { largeur: 22, texte: true },
    prix_unitaire: { largeur: 16, texte: true },
    frais: { largeur: 12, texte: true },
    plateforme: { largeur: 20 },
};

// Nombre de lignes couvertes par les listes deroulantes du modele
const LIGNES_MODELE = 2000;

const DIACRITIQUES = /[\u0300-\u036f]/g;
// Espace ordinaire, insecable et insecable fine : un tableur en seme partout
const ESPACES = /[\s\u00a0\u202f]/g;

// --- Modele ----------------------------------------------------------------
// Le classeur modele : une feuille de saisie vide — rien a effacer avant de
// commencer — et une feuille « Listes » d'ou les trois colonnes contraintes
// tirent leur liste deroulante.
//
// Les listes passent par des noms definis plutot que par une reference directe
// a l'autre feuille : c'est la forme qu'acceptent toutes les versions d'Excel,
// y compris les plus anciennes.
async function modele() {
    const referentiel = await listesDeroulantes();

    const hauteur = Math.max(TYPES.length, referentiel.cryptos.length,
        referentiel.plateformes.length);

    const listes = [['type', 'crypto', 'plateforme']];
    for (let rang = 0; rang < hauteur; rang += 1) {
        listes.push([
            TYPES[rang] || '',
            referentiel.cryptos[rang] || '',
            referentiel.plateformes[rang] || '',
        ]);
    }

    const plage = (colonne, nombre) => `Listes!$${colonne}$2:$${colonne}$${nombre + 1}`;

    return xlsx.ecrire({
        feuilles: [
            {
                nom: 'Opérations',
                colonnes: COLONNES.map((c) => MISE_EN_PAGE[c.cle]),
                lignes: [COLONNES.map((c) => c.alias[0])],
                validations: COLONNES
                    .map((colonne, rang) => ({ colonne, rang }))
                    .filter(({ colonne }) => colonne.liste)
                    .map(({ colonne, rang }) => ({
                        plage: `${xlsx.nomColonne(rang)}2:${xlsx.nomColonne(rang)}${LIGNES_MODELE}`,
                        source: 'liste_' + colonne.liste,
                        titre: colonne.alias[0],
                        erreur: 'Choisissez une valeur dans la liste déroulante.',
                    })),
            },
            {
                nom: 'Listes',
                colonnes: [{ largeur: 12 }, { largeur: 16 }, { largeur: 22 }],
                lignes: listes,
            },
        ],
        nomsDefinis: [
            { nom: 'liste_type', formule: plage('A', TYPES.length) },
            { nom: 'liste_crypto', formule: plage('B', referentiel.cryptos.length) },
            { nom: 'liste_plateforme', formule: plage('C', referentiel.plateformes.length) },
        ],
    });
}

// Les valeurs proposees a la saisie : les cryptos suivies et les plateformes
// actives. Les autres restent acceptees a l'import — un historique vient de
// comptes qu'on n'utilise plus — mais n'ont pas a etre proposees.
async function listesDeroulantes() {
    const [cryptos, plateformes] = await Promise.all([
        db.requete('SELECT id FROM crypto WHERE est_suivi ORDER BY id'),
        db.requete('SELECT libelle FROM plateforme WHERE est_actif ORDER BY libelle'),
    ]);
    return {
        cryptos: cryptos.rows.map((l) => l.id),
        plateformes: plateformes.rows.map((l) => l.libelle),
    };
}

// La description des colonnes est servie telle quelle a l'interface : le
// tableau affiche a l'ecran et le fichier telecharge ne peuvent pas diverger.
function description() {
    return COLONNES.map((c) => ({
        colonne: c.alias[0],
        obligatoire: c.obligatoire,
        exemple: c.exemple,
        liste: Boolean(c.liste),
        aide: c.aide,
        alias: c.alias,
    }));
}

// --- Lecture du fichier ----------------------------------------------------
// Decoupage conforme au CSV usuel : guillemets, guillemets doubles a
// l'interieur, et fins de ligne indifferemment LF ou CRLF.
function decouper(contenu) {
    const texte = String(contenu).replace(/^\uFEFF/, '');
    const lignes = [];
    let ligne = [];
    let champ = '';
    let entreGuillemets = false;

    for (let rang = 0; rang < texte.length; rang += 1) {
        const caractere = texte[rang];

        if (entreGuillemets) {
            if (caractere !== '"') { champ += caractere; continue; }
            if (texte[rang + 1] === '"') { champ += '"'; rang += 1; continue; }
            entreGuillemets = false;
            continue;
        }

        if (caractere === '"') { entreGuillemets = true; continue; }
        if (caractere === SEPARATEUR) { ligne.push(champ); champ = ''; continue; }

        if (caractere === '\n' || caractere === '\r') {
            if (caractere === '\r' && texte[rang + 1] === '\n') rang += 1;
            ligne.push(champ);
            lignes.push(ligne);
            ligne = [];
            champ = '';
            continue;
        }

        champ += caractere;
    }

    if (champ !== '' || ligne.length) {
        ligne.push(champ);
        lignes.push(ligne);
    }

    return lignes;
}

// Accents, majuscules et ponctuation d'en-tete ne doivent pas faire echouer la
// reconnaissance d'une colonne : « Prix unitaire » vaut « prix_unitaire ».
function normaliser(texte) {
    return String(texte || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(DIACRITIQUES, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function reconnaitreColonnes(entete) {
    const position = {};
    const ignorees = [];

    entete.forEach((brut, rang) => {
        const nom = normaliser(brut);
        if (!nom) return;
        const colonne = COLONNES.find((c) => c.alias.indexOf(nom) !== -1);
        if (colonne && position[colonne.cle] === undefined) position[colonne.cle] = rang;
        else ignorees.push(String(brut).trim());
    });

    const manquantes = COLONNES
        .filter((c) => c.obligatoire && position[c.cle] === undefined)
        .map((c) => c.alias[0]);

    return { position, ignorees, manquantes };
}

// --- Lecture des valeurs ---------------------------------------------------
// Excel ecrit volontiers 1.5E-9 sous un tres petit nombre. La virgule est
// deplacee a la main, sans jamais passer par un flottant qui perdrait les
// derniers chiffres — c'est tout l'enjeu sur une quantite de crypto.
function developperExposant(texte) {
    const forme = texte.match(/^(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
    if (!forme) return texte;

    const chiffres = forme[1] + (forme[2] || '');
    const virgule = forme[1].length + Number(forme[3]);

    if (virgule <= 0) return '0.' + '0'.repeat(-virgule) + chiffres;
    if (virgule >= chiffres.length) return chiffres + '0'.repeat(virgule - chiffres.length);
    return chiffres.slice(0, virgule) + '.' + chiffres.slice(virgule);
}

function lireDecimal(texte) {
    const brut = developperExposant(
        String(texte === null || texte === undefined ? '' : texte)
            .replace(ESPACES, '').replace(',', '.')
    );
    if (!brut) return { vide: true };
    if (!/^\d+(\.\d+)?$/.test(brut)) return { erreur: true };
    return { valeur: brut };
}

// Renvoie l'horodatage naif « AAAA-MM-JJ HH:MM:SS », que la requete
// interpretera comme une heure de Paris.
function lireDate(texte) {
    const brut = String(texte || '').trim().replace(/\s+/g, ' ');
    if (!brut) return null;

    const forme = brut.match(
        /^(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})\/(\d{1,2})\/(\d{4}))(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
    );
    if (!forme) return null;

    const annee = Number(forme[1] || forme[6]);
    const mois = Number(forme[2] || forme[5]);
    const jour = Number(forme[3] || forme[4]);
    const heure = Number(forme[7] || 0);
    const minute = Number(forme[8] || 0);
    const seconde = Number(forme[9] || 0);

    // Le 31 février se lit sans peine : seule la reconstruction le démasque.
    const controle = new Date(Date.UTC(annee, mois - 1, jour));
    if (controle.getUTCFullYear() !== annee
        || controle.getUTCMonth() !== mois - 1
        || controle.getUTCDate() !== jour) return null;

    if (heure > 23 || minute > 59 || seconde > 59) return null;

    const deux = (n) => String(n).padStart(2, '0');
    return `${annee}-${deux(mois)}-${deux(jour)} ${deux(heure)}:${deux(minute)}:${deux(seconde)}`;
}

// --- Validation d'une ligne ------------------------------------------------
function validerLigne(cellules, position, referentiel) {
    const champ = (cle) => (position[cle] === undefined ? '' : (cellules[position[cle]] || '').trim());
    const motifs = [];

    const horodatage = lireDate(champ('date'));
    if (!horodatage) motifs.push(`date illisible : « ${champ('date')} »`);

    const type = normaliser(champ('type'));
    if (TYPES.indexOf(type) === -1) {
        motifs.push(`type attendu ${TYPES.map((t) => `« ${t} »`).join(', ')}, `
            + `reçu « ${champ('type')} »`);
    }

    const crypto = champ('crypto').toUpperCase();
    if (!crypto) motifs.push('crypto non renseignée');
    else if (!referentiel.cryptos.has(crypto)) motifs.push(`crypto inconnue : « ${crypto} »`);

    const quantite = lireDecimal(champ('quantite'));
    if (quantite.vide) motifs.push('quantité non renseignée');
    else if (quantite.erreur) motifs.push(`quantité illisible : « ${champ('quantite')} »`);
    else if (Number(quantite.valeur) <= 0) motifs.push('quantité nulle');

    const prix = lireDecimal(champ('prix_unitaire'));
    if (prix.erreur) motifs.push(`prix unitaire illisible : « ${champ('prix_unitaire')} »`);

    const frais = lireDecimal(champ('frais'));
    if (frais.erreur) motifs.push(`frais illisibles : « ${champ('frais')} »`);
    // Une recompense de staking ne s'achete pas : des frais dessus ne veulent
    // rien dire. Signales plutot que ramenes a zero en silence.
    else if (type === 'staking' && !frais.vide && Number(frais.valeur) !== 0) {
        motifs.push('une opération de staking ne porte pas de frais');
    }

    // La plateforme est une cle etrangere : une valeur inconnue serait refusee
    // par la base, autant le dire ici avec le nom fautif.
    let plateforme = champ('plateforme');
    if (plateforme) {
        const connue = referentiel.plateformes.get(plateforme.toLowerCase());
        if (!connue) motifs.push(`plateforme inconnue : « ${plateforme} »`);
        else plateforme = connue;
    }

    if (motifs.length) return { motifs };

    return {
        motifs: [],
        operation: {
            horodatage,
            type,
            id_crypto: crypto,
            quantite: quantite.valeur,
            prix_unitaire: prix.vide ? null : prix.valeur,
            frais: frais.vide ? '0' : frais.valeur,
            plateforme: plateforme || null,
        },
    };
}

// Les plateformes desactivees sont acceptees : elles ne sont plus proposees a
// la saisie, mais un historique importe vient justement de comptes qu'on
// n'utilise plus. Le referentiel des cryptos, lui, n'a pas cette nuance : une
// crypto absente de la table ne peut pas etre rattachee a une operation.
async function referentiels() {
    const [cryptos, plateformes] = await Promise.all([
        db.requete('SELECT id FROM crypto'),
        db.requete('SELECT libelle FROM plateforme'),
    ]);
    return {
        cryptos: new Set(cryptos.rows.map((l) => l.id)),
        // Indexees en minuscules : « binance » doit retrouver « Binance »
        plateformes: new Map(plateformes.rows.map((l) => [l.libelle.toLowerCase(), l.libelle])),
    };
}

// --- Analyse ---------------------------------------------------------------
function erreurImport(message) {
    const err = new Error(message);
    err.code = 400;
    return err;
}

// Un tableur francais enregistre volontiers un CSV en ANSI plutot qu'en UTF-8.
// Le caractere de remplacement trahit ce cas : les octets sont alors relus
// dans l'encodage herite, faute de quoi les accents seraient perdus.
function texteDepuisOctets(tampon) {
    const utf8 = tampon.toString('utf-8');
    if (utf8.indexOf('�') === -1) return utf8;
    try {
        return new TextDecoder('windows-1252').decode(tampon);
    } catch (err) {
        // Encodage inconnu de cette installation : le latin-1 en est proche
        return tampon.toString('latin1');
    }
}

// La signature du fichier tranche : une archive ZIP est un classeur, le reste
// est du texte. L'extension annoncee par le navigateur ne prouve rien.
function feuillesDepuisFichier(tampon) {
    if (xlsx.estClasseur(tampon)) return xlsx.lire(tampon);
    return [{ nom: 'CSV', lignes: decouper(texteDepuisOctets(tampon)) }];
}

// Une entree par ligne du fichier, dans l'ordre, y compris pour les lignes qui
// passent : le rapport doit pouvoir se lire en regard du tableur, sans quoi
// corriger puis relancer devient un jeu de piste.
function analyser(tampon, referentiel) {
    if (tampon.length > TAILLE_MAX) {
        throw erreurImport(`Fichier trop volumineux (maximum ${Math.round(TAILLE_MAX / 1024)} Ko)`);
    }

    let classeur;
    try {
        classeur = feuillesDepuisFichier(tampon);
    } catch (err) {
        throw erreurImport('Fichier illisible : ' + err.message);
    }

    // La feuille de saisie est celle dont l'en-tete porte les colonnes
    // attendues. Le classeur modele en compte deux : « Listes » est ainsi
    // ecartee d'elle-meme, sans avoir a la nommer.
    let choisie = null;
    let manquantes = null;

    for (const feuille of classeur) {
        const rangEntete = feuille.lignes.findIndex((l) => l.some((c) => String(c).trim() !== ''));
        if (rangEntete === -1) continue;

        const reconnues = reconnaitreColonnes(feuille.lignes[rangEntete]);
        if (!reconnues.manquantes.length) {
            choisie = { feuille, rangEntete, reconnues };
            break;
        }
        if (!manquantes) manquantes = reconnues.manquantes;
    }

    if (!choisie) {
        if (!manquantes) throw erreurImport('Fichier vide');
        throw erreurImport(`Colonnes obligatoires absentes : ${manquantes.join(', ')}. `
            + 'Partez du modèle proposé sur la page « Modèle ».');
    }

    const { position, ignorees } = choisie.reconnues;
    const lignes = [];

    choisie.feuille.lignes.slice(choisie.rangEntete + 1).forEach((cellules, rang) => {
        const textes = cellules.map((c) => String(c === null || c === undefined ? '' : c));

        // Une ligne entierement vide n'est pas une erreur : le tableur en
        // laisse volontiers trainer en fin de feuille.
        if (!textes.some((c) => c.trim() !== '')) return;

        const resultat = validerLigne(textes, position, referentiel);
        lignes.push({
            // Le numero est celui du tableur, en-tete comprise
            ligne: choisie.rangEntete + rang + 2,
            statut: resultat.motifs.length ? 'rejetee' : 'valide',
            motifs: resultat.motifs,
            contenu: textes.join(SEPARATEUR),
            operation: resultat.operation || null,
        });
    });

    return {
        feuille: choisie.feuille.nom,
        colonnes_reconnues: Object.keys(position),
        colonnes_ignorees: ignorees,
        lignes,
    };
}

// --- Doublons --------------------------------------------------------------
// Corriger un fichier puis le relancer en entier est le geste naturel. Sans ce
// controle, chaque relance recreerait les lignes deja passees, et l'import
// deviendrait un piege plutot qu'une aide.
function signature(operation) {
    return [operation.horodatage, operation.type, operation.id_crypto,
        Number(operation.quantite), Number(operation.prix_unitaire),
        Number(operation.frais), operation.plateforme].join('|');
}

async function existeDeja(utilisateurId, operation) {
    const { rows } = await db.requete(
        `SELECT 1 FROM operation
          WHERE utilisateur_id = $1
            AND horodatage = ($2::timestamp AT TIME ZONE 'Europe/Paris')
            AND type = $3
            AND id_crypto = $4
            AND quantite = $5::numeric
            AND prix_unitaire IS NOT DISTINCT FROM $6::numeric
            AND frais = $7::numeric
            AND plateforme IS NOT DISTINCT FROM $8
          LIMIT 1`,
        [utilisateurId, operation.horodatage, operation.type, operation.id_crypto,
         operation.quantite, operation.prix_unitaire, operation.frais, operation.plateforme]
    );
    return rows.length > 0;
}

async function marquerDoublons(utilisateurId, lignes) {
    const vues = new Set();

    for (const ligne of lignes) {
        if (ligne.statut !== 'valide') continue;

        const cle = signature(ligne.operation);
        if (vues.has(cle)) {
            ligne.statut = 'doublon';
            ligne.motifs = ['ligne identique déjà présente plus haut dans le fichier'];
            continue;
        }
        vues.add(cle);

        if (await existeDeja(utilisateurId, ligne.operation)) {
            ligne.statut = 'doublon';
            ligne.motifs = ['opération déjà enregistrée : ligne ignorée, aucun doublon créé'];
        }
    }
}

// --- Import ----------------------------------------------------------------
// simuler : le fichier est controle et le rapport rendu sans rien ecrire.
// L'interface ne s'en sert pas — son bouton « Traitement » importe — mais le
// controle a blanc reste utile pour verifier un fichier douteux.
async function importer(utilisateurId, tampon, simuler) {
    const analyse = analyser(tampon, await referentiels());
    await marquerDoublons(utilisateurId, analyse.lignes);

    const aInserer = analyse.lignes.filter((l) => l.statut === 'valide');

    if (!simuler && aInserer.length) {
        // Tout ou rien : un echec en cours de route laisserait un import a
        // moitie fait, dont plus personne ne saurait ce qui est passe.
        await db.transaction(async (client) => {
            for (const { operation } of aInserer) {
                await client.query(
                    `INSERT INTO operation
                         (utilisateur_id, horodatage, type, id_crypto, quantite, plateforme,
                          prix_unitaire, frais)
                     VALUES ($1, ($2::timestamp AT TIME ZONE 'Europe/Paris'), $3, $4, $5, $6, $7, $8)`,
                    [utilisateurId, operation.horodatage, operation.type, operation.id_crypto,
                     operation.quantite, operation.plateforme, operation.prix_unitaire,
                     operation.frais]
                );
            }
        });
        aInserer.forEach((ligne) => { ligne.statut = 'importee'; });
    }

    return {
        simulation: simuler === true,
        feuille: analyse.feuille,
        total_lignes: analyse.lignes.length,
        valides: aInserer.length,
        importees: simuler ? 0 : aInserer.length,
        doublons: analyse.lignes.filter((l) => l.statut === 'doublon').length,
        rejetees: analyse.lignes.filter((l) => l.statut === 'rejetee').length,
        colonnes_reconnues: analyse.colonnes_reconnues,
        colonnes_ignorees: analyse.colonnes_ignorees,
        jours_de_vente: simuler ? [] : joursDeVente(aInserer),
        lignes: analyse.lignes,
    };
}

// Les journees a valoriser apres coup : une vente importee est une cession,
// elle reclame la valeur du portefeuille au jour ou elle a eu lieu.
function joursDeVente(lignes) {
    const jours = [];
    lignes.forEach(({ operation }) => {
        if (!operation || operation.type !== 'vente') return;
        const jour = operation.horodatage.slice(0, 10);
        if (jours.indexOf(jour) === -1) jours.push(jour);
    });
    return jours.sort();
}

module.exports = { modele, description, importer, TAILLE_MAX };
