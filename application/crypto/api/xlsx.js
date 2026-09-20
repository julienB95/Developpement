// Lecture et ecriture de classeurs .xlsx, sans bibliotheque.
//
// Un .xlsx est une archive ZIP de fichiers XML : l'archive est confiee a
// _commun/api/zip.js, ne reste ici qu'un sous-ensemble volontairement etroit
// de SpreadsheetML.
//
// Ce module ne connait aucune regle metier. Il rend des feuilles de chaines et
// accepte des feuilles de chaines : c'est a l'appelant d'interpreter.
const zip = require('../../_commun/api/zip');

// Horodatage fige : deux appels identiques donnent le meme fichier, ce qui
// rend le resultat comparable d'un test a l'autre.
const HORODATAGE = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));

// --- XML -------------------------------------------------------------------
function echapperXml(valeur) {
    return String(valeur === null || valeur === undefined ? '' : valeur)
        // Les caracteres de controle ne sont pas representables en XML 1.0
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function decoderXml(valeur) {
    return String(valeur)
        .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        // L'esperluette en dernier : sinon &amp;lt; deviendrait <
        .replace(/&amp;/g, '&');
}

function attribut(balise, nom) {
    const trouve = balise.match(new RegExp('\\b' + nom + '="([^"]*)"'));
    return trouve ? decoderXml(trouve[1]) : null;
}

// A -> 0, Z -> 25, AA -> 26
function indiceColonne(reference) {
    const lettres = String(reference || '').match(/^([A-Z]+)/);
    if (!lettres) return null;
    let indice = 0;
    for (const lettre of lettres[1]) indice = indice * 26 + (lettre.charCodeAt(0) - 64);
    return indice - 1;
}

function nomColonne(indice) {
    let reste = indice + 1;
    let nom = '';
    while (reste > 0) {
        const modulo = (reste - 1) % 26;
        nom = String.fromCharCode(65 + modulo) + nom;
        reste = Math.floor((reste - 1) / 26);
    }
    return nom;
}

// --- Ecriture d'un classeur ------------------------------------------------
const ENTETE_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// Style 0 : normal. Style 1 : en-tete. Style 2 : texte force.
//
// Le style « texte » n'est pas cosmetique : une quantite de crypto compte
// jusqu'a dix-huit decimales, qu'un nombre Excel — un flottant — perdrait en
// silence. Les colonnes de montants sont donc du texte, de bout en bout.
const STYLE_NORMAL = 0;
const STYLE_ENTETE = 1;
const STYLE_TEXTE = 2;

const STYLES = `${ENTETE_XML}
<styleSheet xmlns="${NS}">
<fonts count="2">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE7F2EF"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// Les valeurs sont ecrites en chaines litterales (inlineStr) : pas de table de
// chaines partagees a tenir, et aucune valeur numerique donc aucun arrondi.
function cellule(indiceColonneCellule, ligne, valeur, style) {
    const reference = nomColonne(indiceColonneCellule) + ligne;
    const attributStyle = style ? ` s="${style}"` : '';
    if (valeur === null || valeur === undefined || valeur === '') {
        return `<c r="${reference}"${attributStyle}/>`;
    }
    return `<c r="${reference}"${attributStyle} t="inlineStr">`
        + `<is><t xml:space="preserve">${echapperXml(valeur)}</t></is></c>`;
}

// feuille : { nom, lignes, colonnes: [{ largeur, texte }], validations }
function feuilleXml(feuille) {
    const colonnes = feuille.colonnes || [];

    const declarations = colonnes.length
        ? '<cols>' + colonnes.map((colonne, rang) => {
            // Le style porte sur la colonne entiere : il s'applique aussi aux
            // cellules encore vides, donc a la saisie a venir.
            const style = colonne.texte ? ` style="${STYLE_TEXTE}"` : '';
            return `<col min="${rang + 1}" max="${rang + 1}" width="${colonne.largeur || 16}"`
                + `${style} customWidth="1"/>`;
        }).join('') + '</cols>'
        : '';

    const donnees = feuille.lignes.map((cellules, rang) => {
        const numero = rang + 1;
        const style = rang === 0 ? STYLE_ENTETE : STYLE_NORMAL;
        const contenu = cellules
            .map((valeur, colonne) => cellule(colonne, numero, valeur, style))
            .join('');
        return `<row r="${numero}">${contenu}</row>`;
    }).join('');

    // L'ordre des elements est impose par le schema : cols, sheetData, puis
    // dataValidations. Excel refuse d'ouvrir un classeur qui s'en ecarte.
    const validations = (feuille.validations || []).length
        ? `<dataValidations count="${feuille.validations.length}">`
            + feuille.validations.map((validation) => '<dataValidation type="list"'
                + ' allowBlank="1" showInputMessage="1" showErrorMessage="1"'
                + ` errorTitle="${echapperXml(validation.titre || 'Valeur attendue')}"`
                + ` error="${echapperXml(validation.erreur || 'Choisissez une valeur de la liste.')}"`
                + ` sqref="${validation.plage}">`
                + `<formula1>${echapperXml(validation.source)}</formula1>`
                + '</dataValidation>').join('')
            + '</dataValidations>'
        : '';

    return `${ENTETE_XML}
<worksheet xmlns="${NS}">${declarations}<sheetData>${donnees}</sheetData>${validations}</worksheet>`;
}

// classeur : { feuilles: [...], nomsDefinis: [{ nom, formule }] }
function ecrire(classeur) {
    const feuilles = classeur.feuilles;

    const contentTypes = `${ENTETE_XML}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${feuilles.map((_, rang) => `<Override PartName="/xl/worksheets/sheet${rang + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`;

    const relsRacine = `${ENTETE_XML}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

    const nomsDefinis = (classeur.nomsDefinis || []).length
        ? '<definedNames>' + classeur.nomsDefinis.map((nom) =>
            `<definedName name="${echapperXml(nom.nom)}">${echapperXml(nom.formule)}</definedName>`
        ).join('') + '</definedNames>'
        : '';

    const workbook = `${ENTETE_XML}
<workbook xmlns="${NS}" xmlns:r="${NS_REL}">
<sheets>${feuilles.map((feuille, rang) =>
        `<sheet name="${echapperXml(feuille.nom)}" sheetId="${rang + 1}" r:id="rId${rang + 1}"/>`
    ).join('')}</sheets>${nomsDefinis}
</workbook>`;

    const relsClasseur = `${ENTETE_XML}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${feuilles.map((_, rang) => `<Relationship Id="rId${rang + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${rang + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${feuilles.length + 1}" Type="${NS_REL}/styles" Target="styles.xml"/>
</Relationships>`;

    const entrees = [
        { nom: '[Content_Types].xml', contenu: contentTypes },
        { nom: '_rels/.rels', contenu: relsRacine },
        { nom: 'xl/workbook.xml', contenu: workbook },
        { nom: 'xl/_rels/workbook.xml.rels', contenu: relsClasseur },
        { nom: 'xl/styles.xml', contenu: STYLES },
    ];
    feuilles.forEach((feuille, rang) => {
        entrees.push({ nom: `xl/worksheets/sheet${rang + 1}.xml`, contenu: feuilleXml(feuille) });
    });

    return zip.ecrire(entrees, { horodatage: HORODATAGE });
}

// --- Lecture d'un classeur -------------------------------------------------
// Formats de date integres a Excel, plus ceux definis dans le classeur dont le
// code contient un jour, un mois ou une heure : une cellule numerique portant
// l'un d'eux est une date, pas un nombre.
const FORMATS_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function formatsDeDate(stylesXml) {
    const dates = new Set(FORMATS_DATE);
    if (!stylesXml) return { dates, parXf: [] };

    const personnalises = stylesXml.match(/<numFmt\b[^>]*\/>/g) || [];
    personnalises.forEach((balise) => {
        const identifiant = Number(attribut(balise, 'numFmtId'));
        const code = attribut(balise, 'formatCode') || '';
        // Le texte entre guillemets ne compte pas : « "jour" 0 » n'est pas une date
        const hors = code.replace(/"[^"]*"/g, '');
        if (/[ymdhs]/i.test(hors)) dates.add(identifiant);
    });

    const bloc = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
    const parXf = bloc
        ? (bloc[1].match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g) || [])
            .map((balise) => Number(attribut(balise, 'numFmtId') || 0))
        : [];

    return { dates, parXf };
}

// Excel compte les jours depuis le 30/12/1899 (l'annee 1900 y est bissextile
// a tort, ce qui ne concerne que janvier et fevrier 1900). Un classeur venu du
// Mac ancien compte depuis 1904 : le classeur le declare.
function depuisSerie(serie, base1904) {
    const origine = base1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    const instant = new Date(origine + Math.round(serie * 86400000));
    if (isNaN(instant.getTime())) return String(serie);

    const deux = (n) => String(n).padStart(2, '0');
    const date = `${instant.getUTCFullYear()}-${deux(instant.getUTCMonth() + 1)}-${deux(instant.getUTCDate())}`;
    const heure = `${deux(instant.getUTCHours())}:${deux(instant.getUTCMinutes())}`;
    return heure === '00:00' ? date : `${date} ${heure}`;
}

function chainesPartagees(xml) {
    if (!xml) return [];
    const entrees = xml.match(/<si\b[^>]*>[\s\S]*?<\/si>|<si\b[^>]*\/>/g) || [];
    return entrees.map((entree) => {
        // Une chaine enrichie est decoupee en fragments : ils se recollent
        const fragments = entree.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) || [];
        return fragments
            .map((fragment) => decoderXml(fragment.replace(/^<t\b[^>]*>/, '').replace(/<\/t>$/, '')))
            .join('');
    });
}

function feuilleDepuisXml(xml, contexte) {
    const lignes = [];
    const cellules = xml.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || [];

    cellules.forEach((brut) => {
        const balise = brut.match(/^<c\b[^>]*>/)[0];
        const reference = attribut(balise, 'r');
        const colonne = indiceColonne(reference);
        const numero = Number(String(reference || '').replace(/^[A-Z]+/, ''));
        if (colonne === null || !numero) return;

        const type = attribut(balise, 't');
        let valeur = '';

        if (type === 'inlineStr') {
            const fragments = brut.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) || [];
            valeur = fragments
                .map((f) => decoderXml(f.replace(/^<t\b[^>]*>/, '').replace(/<\/t>$/, '')))
                .join('');
        } else {
            const contenu = brut.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
            const texte = contenu ? decoderXml(contenu[1]) : '';

            if (type === 's') {
                valeur = contexte.chaines[Number(texte)] || '';
            } else if (type === 'b') {
                valeur = texte === '1' ? 'VRAI' : 'FAUX';
            } else if (texte !== '' && (type === null || type === 'n')) {
                // Une cellule numerique dont le format est une date porte un
                // nombre de jours, pas une valeur lisible.
                const style = Number(attribut(balise, 's') || 0);
                const format = contexte.styles.parXf[style];
                valeur = contexte.styles.dates.has(format)
                    ? depuisSerie(Number(texte), contexte.base1904)
                    : texte;
            } else {
                valeur = texte;
            }
        }

        const rang = numero - 1;
        if (!lignes[rang]) lignes[rang] = [];
        lignes[rang][colonne] = valeur;
    });

    // Les trous laisses par les cellules absentes deviennent des chaines vides
    return lignes.map((ligne) => {
        if (!ligne) return [];
        for (let rang = 0; rang < ligne.length; rang += 1) {
            if (ligne[rang] === undefined) ligne[rang] = '';
        }
        return ligne;
    });
}

// Renvoie [{ nom, lignes }] dans l'ordre du classeur.
function lire(tampon) {
    const fichiers = zip.lire(tampon);

    const texte = (nom) => {
        const contenu = fichiers.get(nom);
        return contenu ? contenu.toString('utf-8') : null;
    };

    const workbook = texte('xl/workbook.xml');
    if (!workbook) throw new Error('Classeur illisible : xl/workbook.xml absent');

    const rels = texte('xl/_rels/workbook.xml.rels') || '';
    const cibles = new Map();
    (rels.match(/<Relationship\b[^>]*\/>/g) || []).forEach((balise) => {
        cibles.set(attribut(balise, 'Id'), attribut(balise, 'Target'));
    });

    const contexte = {
        chaines: chainesPartagees(texte('xl/sharedStrings.xml')),
        styles: formatsDeDate(texte('xl/styles.xml')),
        base1904: /date1904="(1|true)"/.test(workbook),
    };

    const feuilles = [];
    (workbook.match(/<sheet\b[^>]*\/>/g) || []).forEach((balise, rang) => {
        const identifiant = attribut(balise, 'r:id') || attribut(balise, 'id');
        let cible = cibles.get(identifiant) || `worksheets/sheet${rang + 1}.xml`;
        cible = cible.replace(/^\//, '');

        const xml = texte('xl/' + cible) || texte(cible);
        if (!xml) return;

        feuilles.push({
            nom: attribut(balise, 'name') || `Feuille${rang + 1}`,
            lignes: feuilleDepuisXml(xml, contexte),
        });
    });

    if (!feuilles.length) throw new Error('Classeur illisible : aucune feuille exploitable');
    return feuilles;
}

// Un .xlsx est une archive ZIP : sa signature suffit a le distinguer d'un CSV.
// Un classeur est une archive ZIP : la signature suffit a le distinguer
// du texte delimite, seul autre format accepte a l'import.
function estClasseur(tampon) {
    return zip.estArchive(tampon);
}

module.exports = { ecrire, lire, estClasseur, nomColonne };
