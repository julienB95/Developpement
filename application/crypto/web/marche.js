// Cours et actualites : bloc de page quand personne n'est connecte,
// encart dans l'en-tete a cote du bloc utilisateur quand on l'est.
(function () {
    'use strict';

    var C = window.Crypto;
    var RAFRAICHISSEMENT = 2 * 60 * 1000;

    var donnees = { cours: null, actus: null };
    var minuterie = null;

    // --- Mise en forme ----------------------------------------------------
    function formaterPrix(valeur, devise) {
        var nombre = Number(valeur);
        if (!isFinite(nombre)) return '—';
        // Les cryptos a faible valeur unitaire ont besoin de plus de decimales
        var decimales = nombre >= 100 ? 0 : (nombre >= 1 ? 2 : 6);
        return new Intl.NumberFormat('fr-FR', {
            style: 'currency',
            currency: devise || 'EUR',
            minimumFractionDigits: decimales,
            maximumFractionDigits: decimales,
        }).format(nombre);
    }

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

    // --- Rendu ------------------------------------------------------------
    function carteCours(actif, devise) {
        var carte = document.createElement('article');
        carte.className = 'carte-cours';

        var haut = document.createElement('div');
        haut.className = 'carte-cours-haut';

        var symbole = document.createElement('span');
        symbole.className = 'carte-symbole';
        symbole.textContent = actif.symbole;

        var variation = document.createElement('span');
        variation.className = classeVariation(actif.variation_24h);
        variation.textContent = formaterVariation(actif.variation_24h);

        haut.appendChild(symbole);
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

    function ligneActualite(article) {
        var element = document.createElement('li');

        var lien = document.createElement('a');
        lien.href = article.lien;
        lien.target = '_blank';
        lien.rel = 'noopener noreferrer';
        lien.textContent = article.titre;

        var meta = document.createElement('span');
        meta.className = 'actu-meta';
        var age = ilYA(article.publie_le);
        meta.textContent = article.source + (age ? ' · ' + age : '');

        element.appendChild(lien);
        element.appendChild(meta);
        return element;
    }

    function rendreSection() {
        var section = document.getElementById('section-marche');
        if (!section) return;

        var grille = document.getElementById('grille-cours');
        var horodatage = document.getElementById('marche-horodatage');
        var liste = document.getElementById('liste-actus');

        if (donnees.cours) {
            C.vider(grille);
            donnees.cours.actifs.forEach(function (actif) {
                grille.appendChild(carteCours(actif, donnees.cours.devise));
            });
            horodatage.textContent = 'Source ' + donnees.cours.source + ' · relevé ' + ilYA(donnees.cours.releve_le);
        } else {
            horodatage.textContent = 'Cours momentanément indisponibles.';
        }

        C.vider(liste);
        if (donnees.actus) {
            donnees.actus.articles.forEach(function (article) {
                liste.appendChild(ligneActualite(article));
            });
        } else {
            var vide = document.createElement('li');
            vide.className = 'actu-vide';
            vide.textContent = 'Actualités momentanément indisponibles.';
            liste.appendChild(vide);
        }
    }

    function rendreEncart() {
        var encart = document.getElementById('encart-marche');
        if (!encart) return;
        C.vider(encart);

        if (donnees.cours) {
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

        // Bouton d'ouverture du volet d'actualites
        var conteneur = document.createElement('div');
        conteneur.className = 'menu-compte';

        var bouton = document.createElement('button');
        bouton.type = 'button';
        bouton.className = 'bouton bouton-entete bouton-actus';
        bouton.textContent = 'Actus';
        bouton.setAttribute('aria-haspopup', 'true');
        bouton.setAttribute('aria-expanded', 'false');

        var volet = document.createElement('div');
        volet.className = 'menu-deroulant volet-actus';
        volet.hidden = true;

        var titre = document.createElement('p');
        titre.className = 'menu-role';
        titre.textContent = 'Actualités crypto';
        volet.appendChild(titre);

        var liste = document.createElement('ul');
        liste.className = 'liste-actus liste-actus-volet';
        if (donnees.actus) {
            donnees.actus.articles.slice(0, 6).forEach(function (article) {
                liste.appendChild(ligneActualite(article));
            });
        } else {
            var vide = document.createElement('li');
            vide.className = 'actu-vide';
            vide.textContent = 'Actualités momentanément indisponibles.';
            liste.appendChild(vide);
        }
        volet.appendChild(liste);

        bouton.addEventListener('click', function (evenement) {
            evenement.stopPropagation();
            volet.hidden = !volet.hidden;
            bouton.setAttribute('aria-expanded', String(!volet.hidden));
        });

        document.addEventListener('click', function (evenement) {
            if (!volet.hidden && !conteneur.contains(evenement.target)) {
                volet.hidden = true;
                bouton.setAttribute('aria-expanded', 'false');
            }
        });

        conteneur.appendChild(bouton);
        conteneur.appendChild(volet);
        encart.appendChild(conteneur);
    }

    // --- Chargement -------------------------------------------------------
    function charger() {
        return Promise.all([
            C.appeler('/marche/cours').catch(function () { return null; }),
            C.appeler('/actualites?limite=8').catch(function () { return null; }),
        ]).then(function (resultats) {
            if (resultats[0]) donnees.cours = resultats[0];
            if (resultats[1]) donnees.actus = resultats[1];
        });
    }

    // connecte === true : encart dans l'en-tete. Sinon : bloc dans la page.
    function appliquer(connecte) {
        var section = document.getElementById('section-marche');
        var encart = document.getElementById('encart-marche');

        if (section) section.hidden = !!connecte;
        if (encart) encart.hidden = !connecte;

        charger().then(function () {
            if (connecte) rendreEncart();
            else rendreSection();
        });

        if (minuterie) clearInterval(minuterie);
        minuterie = setInterval(function () {
            charger().then(function () {
                if (connecte) rendreEncart();
                else rendreSection();
            });
        }, RAFRAICHISSEMENT);
    }

    window.Marche = { appliquer: appliquer };
})();
