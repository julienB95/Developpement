// Choix d'un nouveau mot de passe depuis le lien reçu par courriel.
(function () {
    'use strict';

    var C = window.Crypto;
    var LONGUEUR_MINIMALE = 12;

    var formulaire = document.getElementById('formulaire-reinitialisation');
    var bouton = document.getElementById('bouton-valider');
    var erreur = document.getElementById('erreur-page');
    var succes = document.getElementById('succes-page');
    var retour = document.getElementById('retour');

    var jeton = new URLSearchParams(window.location.search).get('jeton');

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

    if (!jeton) {
        afficherErreur("Ce lien est incomplet. Redemandez une réinitialisation depuis la page d'accueil.");
        formulaire.hidden = true;
        retour.hidden = false;
        return;
    }

    formulaire.addEventListener('submit', function (evenement) {
        evenement.preventDefault();
        erreur.hidden = true;

        var motDePasse = document.getElementById('mot_de_passe').value;
        var confirmation = document.getElementById('confirmation').value;

        if (motDePasse.length < LONGUEUR_MINIMALE) {
            return afficherErreur('Le mot de passe doit faire au moins ' + LONGUEUR_MINIMALE + ' caractères.');
        }
        if (motDePasse !== confirmation) {
            return afficherErreur('Les deux mots de passe ne correspondent pas.');
        }

        bouton.disabled = true;
        C.appeler('/mot-de-passe/reinitialisation', {
            method: 'POST',
            corps: { jeton: jeton, mot_de_passe: motDePasse },
        })
            .then(function () {
                // Toute session ouverte ailleurs a été fermée par le serveur :
                // le jeton conservé ici ne vaut plus rien.
                C.effacerJeton();
                formulaire.hidden = true;
                retour.hidden = false;
                afficherSucces('Mot de passe enregistré. Votre compte est débloqué.');
            })
            .catch(function (err) { afficherErreur(err.message); })
            .finally(function () { bouton.disabled = false; });
    });
})();
