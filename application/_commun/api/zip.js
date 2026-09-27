// Archives ZIP : ecriture seule, sans dependance externe, chiffrement facultatif.
//
// Node sait deflater, calculer un CRC32 et chiffrer en AES : le reste tient
// dans les entetes du format. Ce module ne connait aucun type de document, il
// accepte des noms et des tampons et rend l'archive.
const crypto = require('crypto');
const zlib = require('zlib');

// Le format ZIP date les entrees a la mode MS-DOS : deux mots de 16 bits,
// avec une seconde de resolution et 1980 pour origine des annees.
function dateDos(date) {
    const heure = ((date.getUTCHours() << 11)
        | (date.getUTCMinutes() << 5)
        | (date.getUTCSeconds() >> 1)) & 0xffff;
    const jour = (((date.getUTCFullYear() - 1980) << 9)
        | ((date.getUTCMonth() + 1) << 5)
        | date.getUTCDate()) & 0xffff;
    return { heure, jour };
}

function versTampon(contenu) {
    return Buffer.isBuffer(contenu) ? contenu : Buffer.from(String(contenu), 'utf-8');
}

// --- Chiffrement WinZip AES-256 (AE-2) -------------------------------------
// Norme lue par 7-Zip, WinRAR et WinZip. Chaque entree a son propre sel ; la
// cle derive du mot de passe par PBKDF2-SHA1, 1000 tours comme l'impose le
// format. L'integrite est portee par le HMAC, d'ou un CRC nul en AE-2.
const METHODE_AES = 99;
const TAILLE_SEL = 16;
const TAILLE_CLE = 32;
const TAILLE_CODE = 10;

// Le compteur du mode CTR de WinZip est un entier de 128 bits en petit-boutiste,
// qui part de 1 : le mode aes-256-ctr de Node compte en grand-boutiste, le flux
// de cle est donc produit bloc par bloc en ECB.
function chiffrerCtr(cle, donnees) {
    const blocs = Math.ceil(donnees.length / 16);
    const compteurs = Buffer.alloc(blocs * 16);
    for (let rang = 0; rang < blocs; rang += 1) {
        compteurs.writeBigUInt64LE(BigInt(rang + 1), rang * 16);
    }

    const aes = crypto.createCipheriv('aes-256-ecb', cle, null);
    aes.setAutoPadding(false);
    const flux = Buffer.concat([aes.update(compteurs), aes.final()]);

    const sortie = Buffer.alloc(donnees.length);
    for (let rang = 0; rang < donnees.length; rang += 1) sortie[rang] = donnees[rang] ^ flux[rang];
    return sortie;
}

function chiffrerEntree(compresse, motDePasse) {
    const sel = crypto.randomBytes(TAILLE_SEL);
    const derive = crypto.pbkdf2Sync(motDePasse, sel, 1000, 2 * TAILLE_CLE + 2, 'sha1');
    const cleAes = derive.subarray(0, TAILLE_CLE);
    const cleHmac = derive.subarray(TAILLE_CLE, 2 * TAILLE_CLE);
    const verificateur = derive.subarray(2 * TAILLE_CLE);

    const chiffre = chiffrerCtr(cleAes, compresse);
    const code = crypto.createHmac('sha1', cleHmac).update(chiffre).digest().subarray(0, TAILLE_CODE);

    return Buffer.concat([sel, verificateur, chiffre, code]);
}

// Champ supplementaire 0x9901 : version AE-2, fournisseur « AE », force 3
// (AES-256) et methode de compression reelle, ici deflate.
function champAes() {
    const champ = Buffer.alloc(11);
    champ.writeUInt16LE(0x9901, 0);
    champ.writeUInt16LE(7, 2);
    champ.writeUInt16LE(2, 4);
    champ.write('AE', 6, 'latin1');
    champ.writeUInt8(3, 8);
    champ.writeUInt16LE(8, 9);
    return champ;
}

// entrees : [{ nom, contenu }], le contenu etant un Buffer ou une chaine UTF-8.
// options.horodatage : date portee par toutes les entrees. Une date figee rend
// l'archive reproductible.
// options.motDePasse : chiffre chaque entree en AES-256 ; absent, l'archive
// est ecrite en clair, comme avant.
function ecrire(entrees, options = {}) {
    const { heure, jour } = dateDos(options.horodatage || new Date());
    const motDePasse = options.motDePasse || null;

    const morceaux = [];
    const catalogue = [];
    let position = 0;

    entrees.forEach(({ nom, contenu }) => {
        const brut = versTampon(contenu);

        // Un fichier vide n'a rien a proteger : comme WinZip, il est range
        // tel quel, les lecteurs refusant une entree vide chiffree.
        const chiffre = Boolean(motDePasse) && brut.length > 0;
        const compresse = zlib.deflateRawSync(brut, { level: 9 });
        const donnees = chiffre ? chiffrerEntree(compresse, motDePasse) : compresse;
        const empreinte = chiffre ? 0 : zlib.crc32(brut);
        const extra = chiffre ? champAes() : Buffer.alloc(0);
        const methode = chiffre ? METHODE_AES : 8;
        const version = chiffre ? 51 : 20;
        const nomBinaire = Buffer.from(nom, 'utf-8');

        // Bit 11 : le nom est en UTF-8. Sans lui, un nom accentue ressort
        // illisible pour les outils qui supposent l'ancienne page de codes.
        // Bit 0 : l'entree est chiffree.
        const drapeaux = (nomBinaire.length === nom.length ? 0 : 0x0800) | (chiffre ? 0x0001 : 0);

        const entete = Buffer.alloc(30);
        entete.writeUInt32LE(0x04034b50, 0);
        entete.writeUInt16LE(version, 4);       // version minimale
        entete.writeUInt16LE(drapeaux, 6);
        entete.writeUInt16LE(methode, 8);
        entete.writeUInt16LE(heure, 10);
        entete.writeUInt16LE(jour, 12);
        entete.writeUInt32LE(empreinte, 14);
        entete.writeUInt32LE(donnees.length, 18);
        entete.writeUInt32LE(brut.length, 22);
        entete.writeUInt16LE(nomBinaire.length, 26);
        entete.writeUInt16LE(extra.length, 28);

        catalogue.push({
            nom: nomBinaire, drapeaux, empreinte, compresse: donnees.length,
            brut: brut.length, position, extra, methode, version,
        });

        morceaux.push(entete, nomBinaire, extra, donnees);
        position += entete.length + nomBinaire.length + extra.length + donnees.length;
    });

    const debutCatalogue = position;
    catalogue.forEach((entree) => {
        const entete = Buffer.alloc(46);
        entete.writeUInt32LE(0x02014b50, 0);
        entete.writeUInt16LE(entree.version, 4); // version d'ecriture
        entete.writeUInt16LE(entree.version, 6); // version minimale
        entete.writeUInt16LE(entree.drapeaux, 8);
        entete.writeUInt16LE(entree.methode, 10);
        entete.writeUInt16LE(heure, 12);
        entete.writeUInt16LE(jour, 14);
        entete.writeUInt32LE(entree.empreinte, 16);
        entete.writeUInt32LE(entree.compresse, 20);
        entete.writeUInt32LE(entree.brut, 24);
        entete.writeUInt16LE(entree.nom.length, 28);
        entete.writeUInt16LE(entree.extra.length, 30);
        entete.writeUInt16LE(0, 32);            // commentaire
        entete.writeUInt16LE(0, 34);            // disque
        entete.writeUInt16LE(0, 36);            // attributs internes
        entete.writeUInt32LE(0, 38);            // attributs externes
        entete.writeUInt32LE(entree.position, 42);

        morceaux.push(entete, entree.nom, entree.extra);
        position += entete.length + entree.nom.length + entree.extra.length;
    });

    const fin = Buffer.alloc(22);
    fin.writeUInt32LE(0x06054b50, 0);
    fin.writeUInt16LE(0, 4);
    fin.writeUInt16LE(0, 6);
    fin.writeUInt16LE(catalogue.length, 8);
    fin.writeUInt16LE(catalogue.length, 10);
    fin.writeUInt32LE(position - debutCatalogue, 12);
    fin.writeUInt32LE(debutCatalogue, 16);
    fin.writeUInt16LE(0, 20);
    morceaux.push(fin);

    return Buffer.concat(morceaux);
}

module.exports = { ecrire };
