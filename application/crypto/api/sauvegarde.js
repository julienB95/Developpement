// Sauvegarde du site : les sources d'un côté, la base de l'autre, dans un
// dossier horodaté placé hors du dépôt.
//
//   <racine>/AAAA-MM-JJ_HH-MM-SS/source/          copie des sources
//                               /bdd/schema.sql   structure
//                               /bdd/donnees.sql  contenu, en INSERT
//                               /sauvegarde.json  manifeste
//                               /sauvegarde.zip   le tout, envoyé par courriel
//
// Réglages attendus dans le .env :
//   SAUVEGARDE_CHEMIN             dossier racine des sauvegardes
//                                 (défaut : dossier Sauvegarde à côté du dépôt)
//   SAUVEGARDE_COURRIEL           destinataire de l'archive
//   SAUVEGARDE_TAILLE_COURRIEL_MO taille maximale de la pièce jointe (défaut 15)
const fs = require('fs');
const path = require('path');
const db = require('../../_commun/api/db');
const courriel = require('../../_commun/api/courriel');
const zip = require('../../_commun/api/zip');

const RACINE_DEPOT = path.resolve(__dirname, '..', '..', '..');
const DESTINATAIRE_DEFAUT = 'julien@boesel.fr';
const NOM_ARCHIVE = 'sauvegarde.zip';
const NOM_MANIFESTE = 'sauvegarde.json';

// Un nom de dossier de sauvegarde, et rien d'autre : le reste du répertoire
// racine est ignoré à la lecture.
const MOTIF_DOSSIER = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(-\d+)?$/;

// L'historique Git et les dépendances ne sont pas des sources : le dépôt vit
// sur GitHub et node_modules se réinstalle. Le .env n'est jamais copié : la
// sauvegarde part par courriel, aucun secret n'a à la suivre.
const DOSSIERS_EXCLUS = new Set(['.git', 'node_modules']);

function estFichierExclu(nom) {
    return nom === '.env' || nom.endsWith('.db');
}

function racine() {
    return process.env.SAUVEGARDE_CHEMIN
        ? path.resolve(process.env.SAUVEGARDE_CHEMIN)
        : path.resolve(RACINE_DEPOT, '..', 'Sauvegarde');
}

function destinataire() {
    return process.env.SAUVEGARDE_COURRIEL || DESTINATAIRE_DEFAUT;
}

function tailleMaximaleCourriel() {
    return Number(process.env.SAUVEGARDE_TAILLE_COURRIEL_MO || 15) * 1024 * 1024;
}

// Nom de dossier lisible, à l'heure locale du serveur : c'est celle que
// l'administrateur a sous les yeux. L'heure UTC reste dans le manifeste.
function nomDossier(date) {
    const deux = (valeur) => String(valeur).padStart(2, '0');
    return `${date.getFullYear()}-${deux(date.getMonth() + 1)}-${deux(date.getDate())}`
        + `_${deux(date.getHours())}-${deux(date.getMinutes())}-${deux(date.getSeconds())}`;
}

// --- Copie des sources -----------------------------------------------------
async function copierSources(destination) {
    const dossierSauvegardes = racine();
    let fichiers = 0;
    let octets = 0;

    async function parcourir(source, cible) {
        const entrees = await fs.promises.readdir(source, { withFileTypes: true });

        for (const entree of entrees) {
            const chemin = path.join(source, entree.name);

            // Le dossier des sauvegardes peut avoir été placé dans le dépôt :
            // sans cette garde, la copie se recopierait sans fin.
            if (path.resolve(chemin) === dossierSauvegardes) continue;

            if (entree.isDirectory()) {
                if (DOSSIERS_EXCLUS.has(entree.name)) continue;
                await parcourir(chemin, path.join(cible, entree.name));
                continue;
            }

            if (!entree.isFile() || estFichierExclu(entree.name)) continue;

            await fs.promises.mkdir(cible, { recursive: true });
            await fs.promises.copyFile(chemin, path.join(cible, entree.name));
            octets += (await fs.promises.stat(chemin)).size;
            fichiers += 1;
        }
    }

    await fs.promises.mkdir(destination, { recursive: true });
    await parcourir(RACINE_DEPOT, destination);
    return { fichiers, octets };
}

// --- Sauvegarde de la base -------------------------------------------------
// Les tables sont écrites après celles qu'elles référencent : une restauration
// dans l'ordre alphabétique buterait sur les clés étrangères.
async function ordreDesTables() {
    const { rows: tables } = await db.requete(
        `SELECT c.relname AS nom
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
          ORDER BY c.relname`
    );

    const { rows: liens } = await db.requete(
        `SELECT source.relname AS source, cible.relname AS cible
           FROM pg_constraint k
           JOIN pg_class source ON source.oid = k.conrelid
           JOIN pg_class cible ON cible.oid = k.confrelid
           JOIN pg_namespace n ON n.oid = source.relnamespace
          WHERE k.contype = 'f' AND n.nspname = 'public'`
    );

    const dependances = new Map(tables.map((table) => [table.nom, new Set()]));
    for (const lien of liens) {
        // Une table qui se référence elle-même ne dépend de personne d'autre
        if (lien.source === lien.cible) continue;
        if (dependances.has(lien.source) && dependances.has(lien.cible)) {
            dependances.get(lien.source).add(lien.cible);
        }
    }

    const ordonnees = [];
    const placees = new Set();

    while (ordonnees.length < tables.length) {
        const avant = ordonnees.length;

        for (const table of tables) {
            if (placees.has(table.nom)) continue;
            const attend = [...dependances.get(table.nom)].some((autre) => !placees.has(autre));
            if (attend) continue;
            placees.add(table.nom);
            ordonnees.push(table.nom);
        }

        // Un cycle de clés étrangères ne se démêle pas : le reste sort dans
        // l'ordre alphabétique, la restauration demandera alors un ajustement.
        if (ordonnees.length === avant) {
            for (const table of tables) {
                if (placees.has(table.nom)) continue;
                placees.add(table.nom);
                ordonnees.push(table.nom);
            }
        }
    }

    return ordonnees;
}

// Le contenu d'une table, déjà mis en forme de littéraux SQL.
//
// Une requête ne peut pas recevoir un nom de table en paramètre lié : c'est
// PostgreSQL lui-même qui compose la requête de lecture, avec format() et ses
// spécificateurs %I et %L, donc avec l'échappement des identifiants. Les
// valeurs, elles, ressortent par quote_nullable : littéraux prêts à relire,
// quel que soit leur type, y compris les tableaux et les octets.
async function contenuTable(nom) {
    const { rows: plan } = await db.requete(
        `WITH colonnes AS (
             SELECT column_name,
                    ordinal_position,
                    row_number() OVER (ORDER BY ordinal_position) AS rang
               FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = $1
                AND is_generated = 'NEVER'
         ), cle AS (
             SELECT a.attname, k.rang
               FROM pg_index i
               JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(colonne, rang) ON TRUE
               JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.colonne
              WHERE i.indrelid = format('%I.%I', 'public', $1)::regclass
                AND i.indisprimary
         )
         SELECT (SELECT count(*)::int FROM colonnes) AS nombre,
                (SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
                   FROM colonnes) AS colonnes,
                format(
                    'SELECT %s FROM %I.%I %s',
                    (SELECT string_agg(
                                format('quote_nullable(%I::text) AS %I', column_name, 'c' || rang),
                                ', ' ORDER BY ordinal_position)
                       FROM colonnes),
                    'public', $1,
                    COALESCE((SELECT 'ORDER BY ' || string_agg(quote_ident(attname), ', ' ORDER BY rang)
                                FROM cle), '')
                ) AS lecture`,
        [nom]
    );

    if (!plan.length || !plan[0].nombre) return { colonnes: null, lignes: [] };

    const { rows } = await db.requete(plan[0].lecture);
    const lignes = rows.map((ligne) => {
        const valeurs = [];
        for (let rang = 1; rang <= plan[0].nombre; rang += 1) valeurs.push(ligne['c' + rang]);
        return valeurs;
    });

    return { colonnes: plan[0].colonnes, lignes };
}

// Les compteurs des colonnes SERIAL : sans eux, la première insertion après
// restauration réutiliserait un identifiant déjà pris.
async function instructionsSequences() {
    const { rows } = await db.requete(
        `SELECT format('SELECT setval(%L, %s, true);',
                       format('%I.%I', schemaname, sequencename),
                       last_value) AS instruction
           FROM pg_sequences
          WHERE schemaname = 'public' AND last_value IS NOT NULL
          ORDER BY sequencename`
    );
    return rows.map((ligne) => ligne.instruction);
}

// Au-delà, l'instruction INSERT devient illisible et pèse sur la mémoire
const LIGNES_PAR_INSERT = 100;

async function sauvegarderBase(destination) {
    await fs.promises.mkdir(destination, { recursive: true });

    // La structure est déjà décrite par le fichier de migration : le même
    // fichier rejoué recrée la base, il n'y a pas à la redécrire ici.
    await fs.promises.copyFile(
        path.join(__dirname, 'schema.sql'),
        path.join(destination, 'schema.sql')
    );

    const base = process.env.PGDATABASE || 'crypto';
    const tables = await ordreDesTables();
    const morceaux = [
        `-- Contenu de la base ${base}, sauvegardé le ${new Date().toISOString()}`,
        '--',
        '-- Restauration : la structure d\'abord, le contenu ensuite.',
        '--   psql -f schema.sql && psql -f donnees.sql',
        '--',
        '-- Tout tient dans une seule transaction : en cas d\'erreur, la base',
        '-- reste telle qu\'elle était.',
        '',
        'BEGIN;',
        '',
        // schema.sql installe deja un referentiel de cryptos et de plateformes :
        // sans ce vidage, la recharge buterait sur les cles primaires. L'ordre
        // est l'inverse de celui des insertions, pour ne pas casser les
        // references en cours de route.
        '-- Les tables sont vidées avant d\'être rechargées : ce fichier remplace',
        '-- le contenu de la base, il ne s\'y ajoute pas.',
        ...[...tables].reverse().map((table) => `DELETE FROM public."${table}";`),
        '',
    ];

    let total = 0;

    for (const table of tables) {
        const { colonnes, lignes } = await contenuTable(table);
        morceaux.push(`-- ${table} : ${lignes.length} ligne(s)`);

        if (!colonnes || !lignes.length) {
            morceaux.push('');
            continue;
        }

        for (let debut = 0; debut < lignes.length; debut += LIGNES_PAR_INSERT) {
            const paquet = lignes.slice(debut, debut + LIGNES_PAR_INSERT);
            const valeurs = paquet.map((ligne) => `    (${ligne.join(', ')})`).join(',\n');
            morceaux.push(`INSERT INTO public."${table}" (${colonnes}) VALUES\n${valeurs};`);
        }

        morceaux.push('');
        total += lignes.length;
    }

    const sequences = await instructionsSequences();
    if (sequences.length) {
        morceaux.push('-- Compteurs des colonnes auto-incrémentées');
        morceaux.push(...sequences);
        morceaux.push('');
    }

    morceaux.push('COMMIT;', '');

    const contenu = Buffer.from(morceaux.join('\n'), 'utf-8');
    await fs.promises.writeFile(path.join(destination, 'donnees.sql'), contenu);

    return { base, tables: tables.length, lignes: total, octets: contenu.length };
}

// --- Archive ---------------------------------------------------------------
// L'archive reprend le dossier tel qu'il vient d'être écrit : une seule source
// de vérité, ce qui est sur le disque est ce qui part par courriel.
async function entreesArchive(dossier, prefixe = '') {
    const entrees = [];

    for (const entree of await fs.promises.readdir(dossier, { withFileTypes: true })) {
        if (entree.name === NOM_ARCHIVE) continue;
        const chemin = path.join(dossier, entree.name);

        if (entree.isDirectory()) {
            entrees.push(...await entreesArchive(chemin, `${prefixe}${entree.name}/`));
        } else if (entree.isFile()) {
            entrees.push({ nom: prefixe + entree.name, contenu: await fs.promises.readFile(chemin) });
        }
    }

    return entrees;
}

// --- Courriel --------------------------------------------------------------
function formaterOctets(octets) {
    if (octets < 1024) return `${octets} o`;
    if (octets < 1024 * 1024) return `${(octets / 1024).toFixed(1)} Ko`;
    return `${(octets / (1024 * 1024)).toFixed(1)} Mo`;
}

function corpsCourriel(manifeste, dossier, jointe) {
    const lignes = [
        `Sauvegarde du site crypto : ${manifeste.dossier}`,
        '',
        `Sources : ${manifeste.source.fichiers} fichier(s), ${formaterOctets(manifeste.source.octets)}`,
        `Base ${manifeste.bdd.base} : ${manifeste.bdd.tables} table(s), `
            + `${manifeste.bdd.lignes} ligne(s), ${formaterOctets(manifeste.bdd.octets)}`,
        `Archive : ${formaterOctets(manifeste.archive.octets)}`,
        '',
        `Dossier sur le serveur : ${dossier}`,
    ];

    if (!jointe) {
        lignes.push(
            '',
            `L'archive dépasse ${formaterOctets(tailleMaximaleCourriel())} : elle n'est pas jointe`,
            'à ce message et reste disponible dans le dossier ci-dessus.'
        );
    }

    return lignes.join('\n');
}

// Un courriel qui ne part pas ne remet pas la sauvegarde en cause : elle est
// déjà sur le disque. L'échec est consigné dans le manifeste, et affiché.
async function prevenir(manifeste, dossier, archive) {
    const adresse = destinataire();
    const jointe = archive.length <= tailleMaximaleCourriel();

    const resultat = { destinataire: adresse, envoye: false, piece_jointe: false, erreur: null };

    if (!courriel.estConfigure()) {
        resultat.erreur = 'Envoi de courriel non configuré : renseignez les variables SMTP_ du .env';
        return resultat;
    }

    try {
        await courriel.envoyer({
            destinataire: adresse,
            sujet: `Sauvegarde du site crypto du ${manifeste.dossier}`,
            texte: corpsCourriel(manifeste, dossier, jointe),
            pieces: jointe
                ? [{ nom: `${manifeste.dossier}.zip`, type: 'application/zip', contenu: archive }]
                : [],
        });
        resultat.envoye = true;
        resultat.piece_jointe = jointe;
    } catch (err) {
        resultat.erreur = err.message;
        console.error('Envoi de la sauvegarde par courriel :', err.message);
    }

    return resultat;
}

// --- Création --------------------------------------------------------------
// Deux sauvegardes en même temps écriraient dans le même dossier et se
// gêneraient à la lecture de la base : la seconde demande est refusée.
let enCours = false;

function ecrireManifeste(chemin, manifeste) {
    return fs.promises.writeFile(
        path.join(chemin, NOM_MANIFESTE),
        JSON.stringify(manifeste, null, 4) + '\n'
    );
}

async function dossierLibre(date) {
    const base = nomDossier(date);
    let nom = base;

    for (let suffixe = 2; suffixe < 100; suffixe += 1) {
        const chemin = path.join(racine(), nom);
        if (!fs.existsSync(chemin)) return { nom, chemin };
        nom = `${base}-${suffixe}`;
    }

    throw new Error('Trop de sauvegardes portant le même horodatage');
}

async function creer(demandeur) {
    if (enCours) {
        const err = new Error('Une sauvegarde est déjà en cours');
        err.code = 409;
        throw err;
    }
    enCours = true;

    try {
        const debut = new Date();

        // Le dossier peut être sur un partage réseau : hors ligne ou non
        // authentifié, l'erreur système seule n'aiderait pas.
        try {
            await fs.promises.mkdir(racine(), { recursive: true });
        } catch (err) {
            const echec = new Error(
                `Dossier de sauvegarde inaccessible : ${racine()} (${err.code || err.message})`
            );
            echec.code = 400;
            throw echec;
        }

        const { nom, chemin } = await dossierLibre(debut);
        await fs.promises.mkdir(chemin);

        const source = await copierSources(path.join(chemin, 'source'));
        const bdd = await sauvegarderBase(path.join(chemin, 'bdd'));

        const manifeste = {
            dossier: nom,
            horodatage: debut.toISOString(),
            duree_ms: null,
            demandee_par: demandeur || null,
            statut: 'en_cours',
            source,
            bdd,
            archive: { nom: NOM_ARCHIVE, octets: 0 },
            courriel: null,
        };

        // Le manifeste est écrit avant l'archive pour y figurer : l'archive
        // se décrit ainsi elle-même. Le statut reste 'en_cours' jusqu'au bout,
        // pour qu'une sauvegarde interrompue se reconnaisse.
        await ecrireManifeste(chemin, manifeste);

        const archive = zip.ecrire(await entreesArchive(chemin), { horodatage: debut });
        await fs.promises.writeFile(path.join(chemin, NOM_ARCHIVE), archive);
        manifeste.archive.octets = archive.length;

        manifeste.courriel = await prevenir(manifeste, chemin, archive);
        manifeste.statut = 'terminee';
        manifeste.duree_ms = Date.now() - debut.getTime();
        await ecrireManifeste(chemin, manifeste);

        return manifeste;
    } finally {
        enCours = false;
    }
}

// --- Lecture ---------------------------------------------------------------
// Une sauvegarde interrompue laisse un dossier sans manifeste : elle est
// listée quand même, marquée incomplète, pour qu'on puisse la supprimer.
async function lire(nom) {
    const chemin = path.join(racine(), nom);

    try {
        const brut = await fs.promises.readFile(path.join(chemin, NOM_MANIFESTE), 'utf-8');
        const manifeste = JSON.parse(brut);
        manifeste.dossier = nom;
        manifeste.statut = manifeste.statut || 'terminee';
        return manifeste;
    } catch (err) {
        if (err.code !== 'ENOENT' && !(err instanceof SyntaxError)) throw err;

        const etat = await fs.promises.stat(chemin);
        return {
            dossier: nom,
            horodatage: etat.mtime.toISOString(),
            statut: 'incomplete',
            source: null,
            bdd: null,
            archive: null,
            courriel: null,
        };
    }
}

async function lister() {
    const dossier = racine();

    let entrees;
    try {
        entrees = await fs.promises.readdir(dossier, { withFileTypes: true });
    } catch (err) {
        // Aucune sauvegarde n'a encore été faite : le dossier n'existe pas
        if (err.code === 'ENOENT') return { racine: dossier, sauvegardes: [] };
        throw err;
    }

    const noms = entrees
        .filter((entree) => entree.isDirectory() && MOTIF_DOSSIER.test(entree.name))
        .map((entree) => entree.name)
        .sort()
        .reverse();

    const sauvegardes = [];
    for (const nom of noms) sauvegardes.push(await lire(nom));

    return { racine: dossier, sauvegardes };
}

module.exports = { creer, lister, racine };
