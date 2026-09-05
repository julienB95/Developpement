// Page de profil : prénom, nom, adresse de courriel et devise d'affichage.
(function () {
    'use strict';

    var C = window.Crypto;

    var zoneProfil = document.getElementById('zone-profil');
    var zoneDeconnecte = document.getElementById('zone-deconnecte');
    var formulaire = document.getElementById('formulaire-profil');
    var bouton = document.getElementById('bouton-valider');
    var erreur = document.getElementById('erreur-page');
    var succes = document.getElementById('succes-page');
    var accesGoogle = document.getElementById('acces-google');

    var champs = {
        prenom: document.getElementById('prenom'),
        nom: document.getElementById('nom'),
        courriel: document.getElementById('courriel'),
        devise: document.getElementById('devise'),
    };

    function afficherErreur(message) {
        erreur.textContent = message;
        erreur.hidden = false;
        succes.hidden = true;
    }

    function afficherSucces(message) {
        succes.textContent = message;
        succes.hidden = false;
        erreur.hidden = true;
    }

    function remplir(compte) {
        champs.prenom.value = compte.prenom || '';
        champs.nom.value = compte.nom || '';
        champs.courriel.value = compte.courriel || '';
        champs.devise.value = compte.devise || 'EUR';

        accesGoogle.textContent = compte.autorise_google
            ? 'La connexion par Google est autorisée sur ce compte.'
            : "La connexion par Google n'est pas autorisée sur ce compte. "
              + 'Un administrateur peut ouvrir ce droit.';
    }

    formulaire.addEventListener('submit', function (evenement) {
        evenement.preventDefault();
        erreur.hidden = true;
        succes.hidden = true;

        var corps = {
            prenom: champs.prenom.value.trim(),
            nom: champs.nom.value.trim(),
            courriel: champs.courriel.value.trim().toLowerCase(),
            devise: champs.devise.value,
        };

        if (!corps.prenom || !corps.nom) return afficherErreur('Renseignez votre prénom et votre nom.');
        if (!corps.courriel) return afficherErreur('Renseignez votre adresse de courriel.');

        bouton.disabled = true;
        C.appeler('/moi', { method: 'PUT', corps: corps })
            .then(function (compte) {
                remplir(compte);
                // La devise du compte fait foi : l'en-tête suit immédiatement
                C.definirDevise(compte.devise, { enregistrer: false });
                C.afficherCompte(compte, {
                    masquerProfil: true,
                    surDeconnexion: function () { window.location.href = '/'; },
                });
                afficherSucces('Profil enregistré.');
            })
            .catch(function (err) {
                if (err.code === 409) {
                    return afficherErreur('Cette adresse de courriel est déjà utilisée par un autre compte.');
                }
                afficherErreur(err.message);
            })
            .finally(function () { bouton.disabled = false; });
    });

    // --- Demarrage --------------------------------------------------------
    if (!C.lireJeton()) {
        zoneDeconnecte.hidden = false;
    } else {
        C.appeler('/moi')
            .then(function (compte) {
                C.definirDevise(compte.devise, { enregistrer: false });
                C.afficherCompte(compte, {
                    masquerProfil: true,
                    surDeconnexion: function () { window.location.href = '/'; },
                });
                if (window.Marche) window.Marche.appliquer(true);

                remplir(compte);
                zoneProfil.hidden = false;
            })
            .catch(function (err) {
                if (err.code === 401) {
                    C.effacerJeton();
                    zoneDeconnecte.hidden = false;
                    return;
                }
                zoneProfil.hidden = false;
                afficherErreur(err.message);
            });
    }
})();
