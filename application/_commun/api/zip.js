// Archives ZIP : ecriture seule, sans dependance externe.
//
// Node sait deflater et calculer un CRC32 : le reste tient dans les
// entetes du format. Ce module ne connait aucun type de document, il rend et
// accepte des noms et des tampons.
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

// entrees : [{ nom, contenu }], le contenu etant un Buffer ou une chaine UTF-8.
// options.horodatage : date portee par toutes les entrees. Une date figee rend
// l'archive reproductible.
function ecrire(entrees, options = {}) {
    const { heure, jour } = dateDos(options.horodatage || new Date());
    const morceaux = [];
    const catalogue = [];
    let position = 0;

    entrees.forEach(({ nom, contenu }) => {
        const brut = versTampon(contenu);
        const compresse = zlib.deflateRawSync(brut, { level: 9 });
        const empreinte = zlib.crc32(brut);
        const nomBinaire = Buffer.from(nom, 'utf-8');

        // Bit 11 : le nom est en UTF-8. Sans lui, un nom accentue ressort
        // illisible pour les outils qui supposent l'ancienne page de codes.
        const drapeaux = nomBinaire.length === nom.length ? 0 : 0x0800;

        const entete = Buffer.alloc(30);
        entete.writeUInt32LE(0x04034b50, 0);
        entete.writeUInt16LE(20, 4);            // version minimale
        entete.writeUInt16LE(drapeaux, 6);
        entete.writeUInt16LE(8, 8);             // deflate
        entete.writeUInt16LE(heure, 10);
        entete.writeUInt16LE(jour, 12);
        entete.writeUInt32LE(empreinte, 14);
        entete.writeUInt32LE(compresse.length, 18);
        entete.writeUInt32LE(brut.length, 22);
        entete.writeUInt16LE(nomBinaire.length, 26);
        entete.writeUInt16LE(0, 28);            // pas de champ supplementaire

        catalogue.push({
            nom: nomBinaire, drapeaux, empreinte, compresse: compresse.length,
            brut: brut.length, position,
        });

        morceaux.push(entete, nomBinaire, compresse);
        position += entete.length + nomBinaire.length + compresse.length;
    });

    const debutCatalogue = position;
    catalogue.forEach((entree) => {
        const entete = Buffer.alloc(46);
        entete.writeUInt32LE(0x02014b50, 0);
        entete.writeUInt16LE(20, 4);            // version d'ecriture
        entete.writeUInt16LE(20, 6);            // version minimale
        entete.writeUInt16LE(entree.drapeaux, 8);
        entete.writeUInt16LE(8, 10);
        entete.writeUInt16LE(heure, 12);
        entete.writeUInt16LE(jour, 14);
        entete.writeUInt32LE(entree.empreinte, 16);
        entete.writeUInt32LE(entree.compresse, 20);
        entete.writeUInt32LE(entree.brut, 24);
        entete.writeUInt16LE(entree.nom.length, 28);
        entete.writeUInt16LE(0, 30);            // extra
        entete.writeUInt16LE(0, 32);            // commentaire
        entete.writeUInt16LE(0, 34);            // disque
        entete.writeUInt16LE(0, 36);            // attributs internes
        entete.writeUInt32LE(0, 38);            // attributs externes
        entete.writeUInt32LE(entree.position, 42);

        morceaux.push(entete, entree.nom);
        position += entete.length + entree.nom.length;
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
