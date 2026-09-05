// Page d'accueil : etat de connexion, dialogue d'authentification, connexion Google
(function () {
    'use strict';

    var C = window.Crypto;

    var accrocheActions = document.getElementById('accroche-actions');
    var espaceConnecte = document.getElementById('espace-connecte');
    var dialogue = document.getElementById('dialogue-connexion');
    var formulaire = document.getElementById('formulaire-auth');
    var boutonValider = document.getElementById('bouton-valider');
    var titreDialogue = document.getElementById('titre-dialogue');
    var zoneErreur = document.getElementById('erreur-auth');
    var ongletConnexion = document.getElementById('onglet-connexion');
    var ongletInscription = document.getElementById('onglet-inscription');
    var champsInscription = document.querySelectorAll('.champ-inscription');

    var mode = 'connexion';

    // --- Affichage --------------------------------------------------------
    function appliquerEtat(compte) {
        C.afficherCompte(compte, {
            surConnexion: function () { ouvrirDialogue('connexion'); },
            surDeconnexion: function () { appliquerEtat(null); },
        });

        if (window.Marche) window.Marche.appliquer(!!compte);

        C.vider(accrocheActions);

        if (compte) {
            var bienvenue = document.createElement('p');
            bienvenue.className = 'accroche-bienvenue';
            bienvenue.textContent = 'Bonjour ' + compte.prenom + ', votre espace est prêt.';
            accrocheActions.appendChild(bienvenue);
            espaceConnecte.hidden = false;
            return;
        }

        var principal = document.createElement('button');
        principal.className = 'bouton bouton-principal';
        principal.type = 'button';
        principal.textContent = 'Créer mon compte';
        principal.addEventListener('click', function () { ouvrirDialogue('inscription'); });
        accrocheActions.appendChild(principal);
        espaceConnecte.hidden = true;
    }

    // --- Dialogue ---------------------------------------------------------
    function ouvrirDialogue(nouveauMode) {
        basculerMode(nouveauMode);
        formulaire.reset();
        masquerErreur();
        if (typeof dialogue.showModal === 'function') dialogue.showModal();
        else dialogue.setAttribute('open', '');
    }

    function basculerMode(nouveauMode) {
        mode = nouveauMode;
        var inscription = mode === 'inscription';

        titreDialogue.textContent = inscription ? 'Créer un compte' : 'Connexion';
        boutonValider.textContent = inscription ? 'Créer mon compte' : 'Se connecter';
        document.getElementById('mot_de_passe').autocomplete = inscription ? 'new-password' : 'current-password';

        champsInscription.forEach(function (element) { element.hidden = !inscription; });
        document.getElementById('prenom').required = inscription;
        document.getElementById('nom').required = inscription;

        ongletConnexion.classList.toggle('actif', !inscription);
        ongletInscription.classList.toggle('actif', inscription);
        ongletConnexion.setAttribute('aria-selected', String(!inscription));
        ongletInscription.setAttribute('aria-selected', String(inscription));
        masquerErreur();
    }

    function afficherErreur(message) {
        zoneErreur.textContent = message;
        zoneErreur.hidden = false;
    }
    function masquerErreur() {
        zoneErreur.textContent = '';
        zoneErreur.hidden = true;
    }

    function reussite(reponse) {
        C.ecrireJeton(reponse.jeton);
        appliquerEtat(reponse.utilisateur);
        dialogue.close();
    }

    ongletConnexion.addEventListener('click', function () { basculerMode('connexion'); });
    ongletInscription.addEventListener('click', function () { basculerMode('inscription'); });

    formulaire.addEventListener('submit', function (evenement) {
        evenement.preventDefault();
        masquerErreur();

        var courriel = document.getElementById('courriel').value.trim().toLowerCase();
        var motDePasse = document.getElementById('mot_de_passe').value;

        if (!courriel || !motDePasse) {
            return afficherErreur('Renseignez votre adresse de courriel et votre mot de passe.');
        }

        var corps = { courriel: courriel, mot_de_passe: motDePasse };

        if (mode === 'inscription') {
            corps.prenom = document.getElementById('prenom').value.trim();
            corps.nom = document.getElementById('nom').value.trim();
            if (!corps.prenom || !corps.nom) {
                return afficherErreur('Renseignez votre prénom et votre nom.');
            }
        }

        boutonValider.disabled = true;
        C.appeler(mode === 'inscription' ? '/inscription' : '/connexion', { method: 'POST', corps: corps })
            .then(reussite)
            .catch(function (erreur) {
                if (erreur.code === 409) {
                    afficherErreur('Un compte existe déjà avec cette adresse. Connectez-vous.');
                } else {
                    afficherErreur(erreur.message);
                }
            })
            .finally(function () { boutonValider.disabled = false; });
    });

    // --- Connexion Google -------------------------------------------------
    function chargerGoogle(clientId) {
        var zone = document.getElementById('zone-google');
        var indisponible = document.getElementById('google-indisponible');

        if (!clientId) {
            indisponible.hidden = false;
            return;
        }

        var script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.onerror = function () { indisponible.hidden = false; };
        script.onload = function () {
            if (!window.google || !window.google.accounts) {
                indisponible.hidden = false;
                return;
            }
            window.google.accounts.id.initialize({
                client_id: clientId,
                callback: function (reponse) {
                    masquerErreur();
                    C.appeler('/connexion/google', { method: 'POST', corps: { jeton: reponse.credential } })
                        .then(reussite)
                        .catch(function (erreur) { afficherErreur(erreur.message); });
                },
            });
            window.google.accounts.id.renderButton(document.getElementById('bouton-google'), {
                theme: 'outline',
                size: 'large',
                text: 'continue_with',
                locale: 'fr',
                width: 320,
            });
            zone.hidden = false;
        };
        document.head.appendChild(script);
    }

    // --- Demarrage --------------------------------------------------------
    appliquerEtat(null);

    C.appeler('/configuration')
        .then(function (configuration) { chargerGoogle(configuration.google_client_id); })
        .catch(function () { document.getElementById('google-indisponible').hidden = false; });

    if (C.lireJeton()) {
        C.appeler('/moi')
            .then(appliquerEtat)
            .catch(function () {
                C.effacerJeton();
                appliquerEtat(null);
            });
    }
})();
