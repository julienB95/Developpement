// Envoi de courriel en SMTP, sans dépendance externe : modules net et tls de Node.
//
// Réglages attendus dans le .env :
//   SMTP_HOTE         serveur d'envoi (ex. smtp.gmail.com)
//   SMTP_PORT         465 pour du TLS direct, 587 pour du STARTTLS (défaut 587)
//   SMTP_UTILISATEUR  identifiant du compte d'envoi
//   SMTP_MOTDEPASSE   mot de passe d'application, jamais le mot de passe du compte
//   SMTP_EXPEDITEUR   adresse affichée en expéditeur (défaut : SMTP_UTILISATEUR)
//
// envoyer({ destinataire, sujet, texte, pieces }) : pieces est facultatif,
// chaque entrée portant { nom, type, contenu }, le contenu étant un Buffer.
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

const DELAI = 15000;

function configuration() {
    const utilisateur = process.env.SMTP_UTILISATEUR || '';
    return {
        hote: process.env.SMTP_HOTE || '',
        port: Number(process.env.SMTP_PORT || 587),
        utilisateur,
        motDePasse: process.env.SMTP_MOTDEPASSE || '',
        expediteur: process.env.SMTP_EXPEDITEUR || utilisateur,
    };
}

function estConfigure() {
    const reglages = configuration();
    return Boolean(reglages.hote && reglages.utilisateur && reglages.motDePasse && reglages.expediteur);
}

// Une réponse SMTP peut tenir sur plusieurs lignes : elle est complète
// quand une ligne commence par trois chiffres suivis d'une espace.
//
// detacher() est indispensable avant de passer en TLS : sans ça, les écouteurs
// continueraient de lire la socket en clair devenue le transport du canal chiffré.
function creerCanal(socket) {
    let tampon = '';
    const attentes = [];
    let echec = null;

    function traiter() {
        while (attentes.length) {
            const lignes = tampon.split('\r\n');
            const index = lignes.findIndex((ligne) => /^\d{3} /.test(ligne));
            if (index < 0) return;

            const reponse = lignes.slice(0, index + 1).join('\r\n');
            tampon = lignes.slice(index + 1).join('\r\n');
            attentes.shift().resoudre(reponse);
        }
    }

    function rompre(erreur) {
        echec = erreur;
        while (attentes.length) attentes.shift().rejeter(erreur);
    }

    const surDonnees = (morceau) => { tampon += morceau; traiter(); };
    const surErreur = (err) => rompre(err);
    const surDelai = () => rompre(new Error('Délai dépassé par le serveur SMTP'));
    const surFermeture = () => rompre(new Error('Connexion SMTP fermée par le serveur'));

    socket.setEncoding('utf-8');
    socket.setTimeout(DELAI);
    socket.on('data', surDonnees);
    socket.on('error', surErreur);
    socket.on('timeout', surDelai);
    socket.on('close', surFermeture);

    return {
        lire() {
            if (echec) return Promise.reject(echec);
            return new Promise((resoudre, rejeter) => {
                attentes.push({ resoudre, rejeter });
                traiter();
            });
        },
        ecrire(ligne) { socket.write(ligne + '\r\n'); },
        detacher() {
            socket.removeListener('data', surDonnees);
            socket.removeListener('error', surErreur);
            socket.removeListener('timeout', surDelai);
            socket.removeListener('close', surFermeture);
        },
    };
}

async function attendre(canal, codes) {
    const reponse = await canal.lire();
    const code = Number(reponse.slice(0, 3));
    if (!codes.includes(code)) {
        throw new Error(`Serveur SMTP : ${reponse.trim()}`);
    }
    return reponse;
}

function connecter(options, securise) {
    return new Promise((resoudre, rejeter) => {
        const socket = securise ? tls.connect(options) : net.connect(options);
        const surErreur = (err) => rejeter(err);
        socket.once('error', surErreur);
        socket.once(securise ? 'secureConnect' : 'connect', () => {
            socket.removeListener('error', surErreur);
            resoudre(socket);
        });
    });
}

function chiffrer(socket, hote) {
    return new Promise((resoudre, rejeter) => {
        const securise = tls.connect({ socket, servername: hote });
        const surErreur = (err) => rejeter(err);
        securise.once('error', surErreur);
        securise.once('secureConnect', () => {
            securise.removeListener('error', surErreur);
            resoudre(securise);
        });
    });
}

function base64(texte) {
    return Buffer.from(texte, 'utf-8').toString('base64');
}

// Un sujet non ASCII doit être encodé, sinon il arrive illisible
function encoderSujet(sujet) {
    return /^[\x20-\x7E]*$/.test(sujet) ? sujet : `=?UTF-8?B?${base64(sujet)}?=`;
}

// Le corps part en base64 : plus de problème de longueur de ligne, ni de point
// en début de ligne, qui terminerait le message avant l'heure.
function corpsEncode(contenu) {
    const brut = Buffer.isBuffer(contenu) ? contenu : Buffer.from(String(contenu), 'utf-8');
    return brut.toString('base64').replace(/(.{76})/g, '$1\r\n');
}

// Un nom de fichier non ASCII passe par la forme RFC 5987, comprise des clients
// courants ; la forme simplifiée reste là pour les plus anciens.
function enteteNom(nom) {
    const simplifie = nom.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
    if (simplifie === nom) return `filename="${simplifie}"`;
    return `filename="${simplifie}"; filename*=UTF-8''${encodeURIComponent(nom)}`;
}

// Sans pièce jointe, le message reste un simple text/plain : la forme multipart
// n'apparaît que lorsqu'il y a quelque chose à joindre.
function composer(reglages, message) {
    const communs = [
        `From: ${reglages.expediteur}`,
        `To: ${message.destinataire}`,
        `Subject: ${encoderSujet(message.sujet)}`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
    ];

    const pieces = message.pieces || [];
    if (!pieces.length) {
        const entetes = communs.concat([
            'Content-Type: text/plain; charset=utf-8',
            'Content-Transfer-Encoding: base64',
        ]);
        return `${entetes.join('\r\n')}\r\n\r\n${corpsEncode(message.texte)}`;
    }

    // La frontière sépare les parties : tirée au hasard, elle ne peut pas
    // apparaître dans le base64 qu'elle encadre.
    const frontiere = `_${crypto.randomBytes(16).toString('hex')}_`;
    const entetes = communs.concat([`Content-Type: multipart/mixed; boundary="${frontiere}"`]);

    const parties = [[
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: base64',
        '',
        corpsEncode(message.texte),
    ].join('\r\n')];

    for (const piece of pieces) {
        parties.push([
            `Content-Type: ${piece.type || 'application/octet-stream'}`,
            'Content-Transfer-Encoding: base64',
            `Content-Disposition: attachment; ${enteteNom(piece.nom)}`,
            '',
            corpsEncode(piece.contenu),
        ].join('\r\n'));
    }

    const corps = parties.map((partie) => `--${frontiere}\r\n${partie}`).join('\r\n')
        + `\r\n--${frontiere}--`;

    return `${entetes.join('\r\n')}\r\n\r\n${corps}`;
}

// Une ligne réduite à un point termine le message : toute ligne commençant
// par un point est doublée avant l'envoi.
function protegerPoints(donnees) {
    return donnees.replace(/^\./gm, '..');
}

async function remettre(canal, reglages, message) {
    canal.ecrire('AUTH LOGIN');
    await attendre(canal, [334]);
    canal.ecrire(base64(reglages.utilisateur));
    await attendre(canal, [334]);
    canal.ecrire(base64(reglages.motDePasse));
    await attendre(canal, [235]);

    canal.ecrire(`MAIL FROM:<${reglages.expediteur}>`);
    await attendre(canal, [250]);
    canal.ecrire(`RCPT TO:<${message.destinataire}>`);
    await attendre(canal, [250, 251]);

    canal.ecrire('DATA');
    await attendre(canal, [354]);

    canal.ecrire(`${protegerPoints(composer(reglages, message))}\r\n.`);
    await attendre(canal, [250]);

    canal.ecrire('QUIT');
}

async function envoyer(message) {
    if (!estConfigure()) {
        throw new Error("Envoi de courriel non configuré : renseignez les variables SMTP_ du .env");
    }

    const reglages = configuration();
    const tlsDirect = reglages.port === 465;

    let socket = await connecter(
        { host: reglages.hote, port: reglages.port, servername: reglages.hote },
        tlsDirect
    );
    let canal = creerCanal(socket);

    try {
        await attendre(canal, [220]);
        canal.ecrire(`EHLO ${reglages.hote}`);
        await attendre(canal, [250]);

        if (!tlsDirect) {
            canal.ecrire('STARTTLS');
            await attendre(canal, [220]);

            canal.detacher();
            socket = await chiffrer(socket, reglages.hote);
            canal = creerCanal(socket);

            canal.ecrire(`EHLO ${reglages.hote}`);
            await attendre(canal, [250]);
        }

        await remettre(canal, reglages, message);
        socket.end();
        return true;
    } catch (err) {
        socket.destroy();
        throw err;
    }
}

module.exports = { envoyer, estConfigure };
