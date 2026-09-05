// Cours et actualites : blocs defilants de la page quand personne n'est connecte,
// bandeau de cours dans l'en-tete a cote du bloc utilisateur quand on l'est.
(function () {
    'use strict';

    var C = window.Crypto;
    var RAFRAICHISSEMENT = 2 * 60 * 1000;
    var NOMBRE_ACTUS = 12;

    var donnees = { cours: null, actus: null };
    var minuterie = null;
    var defilements = null;
    var estConnecte = false;

    // --- Mise en forme ----------------------------------------------------
    var formaterPrix = C.formaterMontant;

    function formaterVariation(valeur) {
        if (valeur === null || valeur === undefined) return '—';
        return (valeur > 0 ? '+' : '') + valeur.toFixed(2).replace('.', ',') + ' %';
    }

    function classeVariation(valeur) {
        if (valeur === null || valeur === undefined) return 'variation';
        if (valeur > 0) return 'variation variation-hausse';
        if (valeur < 0) return 'variation variation-baisse';
        return 'variation';
    }

    function ilYA(iso) {
        if (!iso) return '';
        var minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
        if (isNaN(minutes) || minutes < 0) return '';
        if (minutes < 1) return "à l'instant";
        if (minutes < 60) return 'il y a ' + minutes + ' min';
        var heures = Math.round(minutes / 60);
        if (heures < 24) return 'il y a ' + heures + ' h';
        var jours = Math.round(heures / 24);
        return 'il y a ' + jours + (jours > 1 ? ' jours' : ' jour');
    }

    // --- Defilement horizontal --------------------------------------------
    // Les fleches font avancer la piste d'un ecran complet de cartes.
    function brancherDefilement(idPiste, idPrecedent, idSuivant) {
        var piste = document.getElementById(idPiste);
        var precedent = document.getElementById(idPrecedent);
        var suivant = document.getElementById(idSuivant);
        if (!piste || !precedent || !suivant) return function () { /* piste absente de la page */ };

        function pas() {
            var premiere = piste.firstElementChild;
            if (!premiere) return piste.clientWidth;

            var ecart = 0;
            if (piste.children.length > 1) {
                ecart = piste.children[1].getBoundingClientRect().left
                    - piste.children[0].getBoundingClientRect().right;
            }

            var largeur = premiere.getBoundingClientRect().width + Math.max(0, ecart);
            if (largeur <= 0) return piste.clientWidth;

            var visibles = Math.max(1, Math.floor(piste.clientWidth / largeur));
            return largeur * visibles;
        }

        function actualiser() {
            var debordement = piste.scrollWidth - piste.clientWidth;
            var defilable = debordement > 2;
            precedent.disabled = !defilable || piste.scrollLeft <= 1;
            suivant.disabled = !defilable || piste.scrollLeft >= debordement - 1;
        }

        precedent.addEventListener('click', function () {
            piste.scrollBy({ left: -pas(), behavior: 'smooth' });
        });
        suivant.addEventListener('click', function () {
            piste.scrollBy({ left: pas(), behavior: 'smooth' });
        });
        piste.addEventListener('scroll', actualiser);
        window.addEventListener('resize', actualiser);

        return actualiser;
    }

    function preparerDefilements() {
        if (defilements) return defilements;
        defilements = {
            cours: brancherDefilement('piste-cours', 'marche-precedent', 'marche-suivant'),
            actus: brancherDefilement('piste-actus', 'actus-precedent', 'actus-suivant'),
        };
        return defilements;
    }

    // --- Rendu ------------------------------------------------------------
    function carteCours(actif, devise) {
        var carte = document.createElement('article');
        carte.className = 'carte-cours';

        var haut = document.createElement('div');
        haut.className = 'carte-cours-haut';

        // Le logo est servi par l'API a partir du symbole, qui est aussi
        // l'identifiant de la crypto dans le referentiel.
        var identite = document.createElement('span');
        identite.className = 'carte-identite';
        identite.appendChild(C.logoCrypto(actif.symbole, 22));

        var symbole = document.createElement('span');
        symbole.className = 'carte-symbole';
        symbole.textContent = actif.symbole;
        identite.appendChild(symbole);

        var variation = document.createElement('span');
        variation.className = classeVariation(actif.variation_24h);
        variation.textContent = formaterVariation(actif.variation_24h);

        haut.appendChild(identite);
        haut.appendChild(variation);

        var nom = document.createElement('p');
        nom.className = 'carte-nom';
        nom.textContent = actif.nom;

        var prix = document.createElement('p');
        prix.className = 'carte-prix';
        prix.textContent = formaterPrix(actif.prix, devise);

        carte.appendChild(haut);
        carte.appendChild(nom);
        carte.appendChild(prix);
        return carte;
    }

    function carteActualite(article) {
        var carte = document.createElement('article');
        carte.className = 'carte-actu';

        var lien = document.createElement('a');
        lien.className = 'carte-actu-titre';
        lien.href = article.lien;
        lien.target = '_blank';
        lien.rel = 'noopener noreferrer';
        lien.textContent = article.titre;

        var meta = document.createElement('p');
        meta.className = 'actu-meta';
        var age = ilYA(article.publie_le);
        meta.textContent = article.source + (age ? ' · ' + age : '');

        carte.appendChild(lien);
        carte.appendChild(meta);
        return carte;
    }

    function messageVide(texte) {
        var element = document.createElement('p');
        element.className = 'piste-vide';
        element.textContent = texte;
        return element;
    }

    function rendreSections() {
        var pisteCours = document.getElementById('piste-cours');
        var pisteActus = document.getElementById('piste-actus');
        var horodatage = document.getElementById('marche-horodatage');
        if (!pisteCours || !pisteActus) return;

        var boutons = preparerDefilements();

        C.vider(pisteCours);
        if (donnees.cours) {
            donnees.cours.actifs.forEach(function (actif) {
                pisteCours.appendChild(carteCours(actif, donnees.cours.devise));
            });
            if (horodatage) {
                horodatage.textContent = 'Source ' + donnees.cours.source
                    + ' · relevé ' + ilYA(donnees.cours.releve_le);
            }
        } else {
            pisteCours.appendChild(messageVide('Cours momentanément indisponibles.'));
            if (horodatage) horodatage.textContent = '';
        }

        C.vider(pisteActus);
        if (donnees.actus) {
            donnees.actus.articles.forEach(function (article) {
                pisteActus.appendChild(carteActualite(article));
            });
        } else {
            pisteActus.appendChild(messageVide('Actualités momentanément indisponibles.'));
        }

        boutons.cours();
        boutons.actus();
    }

    function rendreEncart() {
        var encart = document.getElementById('encart-marche');
        if (!encart) return;
        C.vider(encart);
        if (!donnees.cours) return;

        var ticker = document.createElement('div');
        ticker.className = 'ticker';

        donnees.cours.actifs.slice(0, 2).forEach(function (actif) {
            var bloc = document.createElement('span');
            bloc.className = 'ticker-actif';

            var symbole = document.createElement('span');
            symbole.className = 'ticker-symbole';
            symbole.textContent = actif.symbole;

            var prix = document.createElement('span');
            prix.className = 'ticker-prix';
            prix.textContent = formaterPrix(actif.prix, donnees.cours.devise);

            var variation = document.createElement('span');
            variation.className = classeVariation(actif.variation_24h);
            variation.textContent = formaterVariation(actif.variation_24h);

            bloc.appendChild(symbole);
            bloc.appendChild(prix);
            bloc.appendChild(variation);
            ticker.appendChild(bloc);
        });

        encart.appendChild(ticker);
    }

    // --- Chargement -------------------------------------------------------
    // Les cours sont demandes dans la devise choisie par l'utilisateur :
    // la conversion est faite par la source, jamais dans le navigateur.
    // forcer : rafraichissement demande par le visiteur. L'API raccourcit alors
    // son cache sans le supprimer, ce qui protege la source d'un clic en rafale.
    function chargerCours(forcer) {
        return C.appeler('/marche/cours?devise=' + C.devise().toLowerCase() + (forcer ? '&forcer=1' : ''))
            .then(function (resultat) { donnees.cours = resultat; })
            .catch(function () { /* la derniere valeur connue reste affichee */ });
    }

    function chargerActus(forcer) {
        return C.appeler('/actualites?limite=' + NOMBRE_ACTUS + (forcer ? '&forcer=1' : ''))
            .then(function (resultat) { donnees.actus = resultat; })
            .catch(function () { /* la derniere valeur connue reste affichee */ });
    }

    function charger(forcer) {
        return Promise.all([chargerCours(forcer), chargerActus(forcer)]);
    }

    function brancherRafraichir(identifiant, chargement) {
        var bouton = document.getElementById(identifiant);
        if (!bouton) return;

        bouton.addEventListener('click', function () {
            bouton.disabled = true;
            bouton.classList.add('fleche-tourne');
            chargement(true)
                .then(rendre)
                .finally(function () {
                    bouton.disabled = false;
                    bouton.classList.remove('fleche-tourne');
                });
        });
    }

    function rendre() {
        if (estConnecte) rendreEncart();
        else rendreSections();
    }

    // connecte === true : bandeau dans l'en-tete. Sinon : blocs defilants de la page.
    function appliquer(connecte) {
        estConnecte = !!connecte;

        var sectionMarche = document.getElementById('section-marche');
        var sectionActus = document.getElementById('section-actus');
        var encart = document.getElementById('encart-marche');

        if (sectionMarche) sectionMarche.hidden = estConnecte;
        if (sectionActus) sectionActus.hidden = estConnecte;
        if (encart) encart.hidden = !estConnecte;

        charger().then(rendre);

        if (minuterie) clearInterval(minuterie);
        minuterie = setInterval(function () {
            charger().then(rendre);
        }, RAFRAICHISSEMENT);
    }

    // Changement de devise : les cours sont redemandes, pas reconvertis sur place
    C.surChangementDevise(function () {
        chargerCours().then(rendre);
    });

    brancherRafraichir('marche-rafraichir', chargerCours);
    brancherRafraichir('actus-rafraichir', chargerActus);

    window.Marche = {
        appliquer: appliquer,
        formaterVariation: formaterVariation,
        classeVariation: classeVariation,
    };
})();
