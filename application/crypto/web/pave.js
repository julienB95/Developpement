// Pavé numérique d'aide à la saisie, ouvert à droite du champ actif.
// Le champ reste saisissable au clavier : le pavé n'est qu'un second moyen,
// pour les montants qu'on préfère composer à la souris.
(function () {
    'use strict';

    var TOUCHES = [
        ['7', '8', '9'],
        ['4', '5', '6'],
        ['1', '2', '3'],
        ['0', ',', '⌫'],
    ];

    var pave = null;
    var champActif = null;

    // Une boîte ouverte avec showModal() vit dans la couche supérieure du
    // navigateur : tout ce qui reste dans le document passe derrière elle,
    // quel que soit son z-index. Le pavé doit donc être posé dans la boîte.
    function accueil(champ) {
        return champ.closest('dialog') || document.body;
    }

    function construire() {
        pave = document.createElement('div');
        pave.className = 'pave';
        pave.hidden = true;
        pave.setAttribute('role', 'group');
        pave.setAttribute('aria-label', 'Pavé numérique');

        var grille = document.createElement('div');
        grille.className = 'pave-grille';

        TOUCHES.forEach(function (rangee) {
            rangee.forEach(function (touche) {
                grille.appendChild(bouton(touche, function () { frapper(touche); }));
            });
        });

        pave.appendChild(grille);

        var bas = document.createElement('div');
        bas.className = 'pave-bas';
        bas.appendChild(bouton('Effacer', vider, 'pave-large'));
        bas.appendChild(bouton('Fermer', fermer, 'pave-large'));
        pave.appendChild(bas);
    }

    function bouton(libelle, action, classe) {
        var element = document.createElement('button');
        element.type = 'button';
        element.className = 'pave-touche' + (classe ? ' ' + classe : '');
        element.textContent = libelle;

        // mousedown est annulé pour que le champ garde le focus :
        // sans ça, le premier clic sur une touche fermerait le pavé.
        element.addEventListener('mousedown', function (evenement) { evenement.preventDefault(); });
        element.addEventListener('click', action);
        return element;
    }

    // Le champ attend un décimal à point ; la virgule est proposée
    // parce que c'est ce qu'on tape en français.
    function frapper(touche) {
        if (!champActif) return;

        if (touche === '⌫') {
            champActif.value = champActif.value.slice(0, -1);
        } else if (touche === ',') {
            if (champActif.value.indexOf('.') < 0) {
                champActif.value = (champActif.value || '0') + '.';
            }
        } else {
            champActif.value += touche;
        }

        champActif.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function vider() {
        if (!champActif) return;
        champActif.value = '';
        champActif.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function fermer() {
        if (pave) pave.hidden = true;
        champActif = null;
    }

    // Le pavé suit le champ : placé à sa droite, ou dessous s'il n'y a
    // pas la place, pour ne jamais sortir de l'écran. Les coordonnées sont
    // celles de la fenêtre, sans décalage de défilement : le pavé est en
    // position fixe, pour rester valable dans une boîte modale.
    function placer(champ) {
        var conteneur = accueil(champ);
        if (pave.parentNode !== conteneur) conteneur.appendChild(pave);

        var cadre = champ.getBoundingClientRect();
        var marge = 10;

        pave.hidden = false;
        var largeur = pave.offsetWidth;
        var hauteur = pave.offsetHeight;

        var gauche = cadre.right + marge;
        var haut = cadre.top;

        if (gauche + largeur > window.innerWidth - marge) {
            gauche = Math.max(marge, cadre.left);
            haut = cadre.bottom + marge;
        }
        if (haut + hauteur > window.innerHeight - marge) {
            haut = Math.max(marge, window.innerHeight - hauteur - marge);
        }

        pave.style.left = Math.round(gauche) + 'px';
        pave.style.top = Math.round(haut) + 'px';
    }

    function attacher(champ) {
        if (!pave) construire();

        champ.addEventListener('focus', function () {
            champActif = champ;
            placer(champ);
        });

        champ.addEventListener('blur', function () {
            // Le clic sur une touche ne doit pas fermer le pavé : mousedown
            // est déjà annulé, mais un clic ailleurs doit bien le refermer.
            window.setTimeout(function () {
                if (champActif === champ && document.activeElement !== champ) fermer();
            }, 0);
        });
    }

    window.Pave = { attacher: attacher, fermer: fermer };
})();
