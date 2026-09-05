// Empreintes de mots de passe - scrypt, module natif de Node (aucune dependance)
// Le mot de passe en clair n'est jamais stocke ni journalise.
const crypto = require('crypto');

const SEL_OCTETS = 16;
const CLE_OCTETS = 64;
const COUT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const LONGUEUR_MINIMALE = 12;

// Format stocke : scrypt$N$r$p$sel_base64$cle_base64
function hacher(motDePasse) {
    return new Promise((resoudre, rejeter) => {
        if (typeof motDePasse !== 'string' || motDePasse.length < LONGUEUR_MINIMALE) {
            return rejeter(new Error(`Le mot de passe doit faire au moins ${LONGUEUR_MINIMALE} caracteres`));
        }

        const sel = crypto.randomBytes(SEL_OCTETS);
        crypto.scrypt(motDePasse.normalize('NFKC'), sel, CLE_OCTETS, COUT, (err, cle) => {
            if (err) return rejeter(err);
            resoudre([
                'scrypt',
                COUT.N,
                COUT.r,
                COUT.p,
                sel.toString('base64'),
                cle.toString('base64'),
            ].join('$'));
        });
    });
}

function verifier(motDePasse, empreinte) {
    return new Promise((resoudre, rejeter) => {
        if (typeof motDePasse !== 'string' || typeof empreinte !== 'string') {
            return resoudre(false);
        }

        const parties = empreinte.split('$');
        if (parties.length !== 6 || parties[0] !== 'scrypt') return resoudre(false);

        const cout = {
            N: Number(parties[1]),
            r: Number(parties[2]),
            p: Number(parties[3]),
            maxmem: COUT.maxmem,
        };
        if (!Number.isInteger(cout.N) || !Number.isInteger(cout.r) || !Number.isInteger(cout.p)) {
            return resoudre(false);
        }

        const sel = Buffer.from(parties[4], 'base64');
        const attendue = Buffer.from(parties[5], 'base64');

        crypto.scrypt(motDePasse.normalize('NFKC'), sel, attendue.length, cout, (err, cle) => {
            if (err) return rejeter(err);
            // Comparaison a duree constante : ne renseigne pas sur le nombre de caracteres corrects
            resoudre(cle.length === attendue.length && crypto.timingSafeEqual(cle, attendue));
        });
    });
}

module.exports = { hacher, verifier, LONGUEUR_MINIMALE };
