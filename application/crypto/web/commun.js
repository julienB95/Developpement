// Briques partagees par les pages du site : appels a l'API, session, en-tete de compte
(function () {
    'use strict';

    var API = '/api/crypto';
    var CLE_JETON = 'crypto_jeton';

    // localStorage peut etre indisponible (navigation privee stricte, cookies bloques)
    function lireJeton() {
        try { return localStorage.getItem(CLE_JETON); } catch (e) { return null; }
    }
    function ecrireJeton(jeton) {
        try { localStorage.setItem(CLE_JETON, jeton); } catch (e) { /* session non memorisee */ }
    }
    function effacerJeton() {
        try { localStorage.removeItem(CLE_JETON); } catch (e) { /* rien a faire */ }
    }

    function appeler(chemin, options) {
        options = options || {};
        var entetes = { 'Content-Type': 'application/json' };
        var jeton = lireJeton();
        if (jeton) entetes.Authorization = 'Bearer ' + jeton;

        return fetch(API + chemin, {
            method: options.method || 'GET',
            headers: entetes,
            body: options.corps ? JSON.stringify(options.corps) : undefined,
        }).then(function (reponse) {
            return reponse.json()
                .catch(function () { return {}; })
                .then(function (corps) {
                    if (!reponse.ok) {
                        var erreur = new Error(corps.erreur || 'Erreur inattendue du serveur');
                        erreur.code = reponse.status;
                        throw erreur;
                    }
                    return corps;
                });
        });
    }

    function vider(element) {
        while (element.firstChild) element.removeChild(element.firstChild);
    }

    function initiales(compte) {
        var premier = (compte.prenom || '').trim().charAt(0);
        var second = (compte.nom || '').trim().charAt(0);
        var texte = (premier + second) || (compte.courriel || '?').charAt(0);
        return texte.toUpperCase();
    }

    function seDeconnecter(apres) {
        appeler('/deconnexion', { method: 'POST' })
            .catch(function () { /* la session locale est effacee dans tous les cas */ })
            .finally(function () {
                effacerJeton();
                if (typeof apres === 'function') apres();
            });
    }

    // Remplit #bloc-compte : bouton de connexion, ou pastille et menu du compte connecte
    function afficherCompte(compte, options) {
        options = options || {};
        var bloc = document.getElementById('bloc-compte');
        if (!bloc) return;
        vider(bloc);

        if (!compte) {
            var bouton = document.createElement('button');
            bouton.className = 'bouton bouton-entete';
            bouton.type = 'button';
            bouton.textContent = 'Se connecter';
            bouton.addEventListener('click', function () {
                if (options.surConnexion) options.surConnexion();
                else window.location.href = '/';
            });
            bloc.appendChild(bouton);
            return;
        }

        var conteneur = document.createElement('div');
        conteneur.className = 'menu-compte';

        var pastille = document.createElement('button');
        pastille.className = 'pastille';
        pastille.type = 'button';
        pastille.textContent = initiales(compte);
        pastille.title = compte.prenom + ' ' + compte.nom;
        pastille.setAttribute('aria-haspopup', 'true');
        pastille.setAttribute('aria-expanded', 'false');

        var menu = document.createElement('div');
        menu.className = 'menu-deroulant';
        menu.hidden = true;

        var identite = document.createElement('p');
        identite.className = 'menu-identite';
        identite.textContent = compte.prenom + ' ' + compte.nom;

        var courriel = document.createElement('p');
        courriel.className = 'menu-courriel';
        courriel.textContent = compte.courriel;

        menu.appendChild(identite);
        menu.appendChild(courriel);

        if (compte.est_admin) {
            var etiquette = document.createElement('p');
            etiquette.className = 'menu-role';
            etiquette.textContent = 'Administrateur';
            menu.appendChild(etiquette);

            if (!options.masquerAdministration) {
                var lien = document.createElement('a');
                lien.className = 'menu-action menu-action-lien';
                lien.href = '/administration.html';
                lien.textContent = "Administration";
                menu.appendChild(lien);
            }
        }

        var deconnexion = document.createElement('button');
        deconnexion.className = 'menu-action';
        deconnexion.type = 'button';
        deconnexion.textContent = 'Se déconnecter';
        deconnexion.addEventListener('click', function () {
            seDeconnecter(options.surDeconnexion || function () { window.location.href = '/'; });
        });
        menu.appendChild(deconnexion);

        pastille.addEventListener('click', function (evenement) {
            evenement.stopPropagation();
            menu.hidden = !menu.hidden;
            pastille.setAttribute('aria-expanded', String(!menu.hidden));
        });

        document.addEventListener('click', function (evenement) {
            if (!menu.hidden && !conteneur.contains(evenement.target)) {
                menu.hidden = true;
                pastille.setAttribute('aria-expanded', 'false');
            }
        });

        conteneur.appendChild(pastille);
        conteneur.appendChild(menu);
        bloc.appendChild(conteneur);
    }

    window.Crypto = {
        appeler: appeler,
        lireJeton: lireJeton,
        ecrireJeton: ecrireJeton,
        effacerJeton: effacerJeton,
        vider: vider,
        initiales: initiales,
        afficherCompte: afficherCompte,
        seDeconnecter: seDeconnecter,
    };
})();
