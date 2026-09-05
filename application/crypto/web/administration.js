// Administration : parametrage des utilisateurs
(function () {
    'use strict';

    var C = window.Crypto;

    var chargement = document.getElementById('chargement');
    var tableau = document.getElementById('tableau-utilisateurs');
    var corps = document.getElementById('corps-utilisateurs');
    var zoneErreur = document.getElementById('erreur-page');

    var moi = null;

    function afficherErreur(message) {
        zoneErreur.textContent = message;
        zoneErreur.hidden = false;
    }
    function masquerErreur() {
        zoneErreur.textContent = '';
        zoneErreur.hidden = true;
    }

    function formaterDate(iso) {
        var date = new Date(iso);
        if (isNaN(date.getTime())) return '—';
        return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    function moyensDeConnexion(ligne) {
        var moyens = [];
        if (ligne.a_mot_de_passe) moyens.push('Mot de passe');
        if (ligne.a_google) moyens.push('Google');
        return moyens.join(' + ') || '—';
    }

    // Interrupteur : desactive et explique lorsqu'il porte sur son propre compte
    function bascule(ligne, champ, chemin) {
        var etiquette = document.createElement('label');
        etiquette.className = 'bascule';

        var boite = document.createElement('input');
        boite.type = 'checkbox';
        boite.checked = ligne[champ];
        boite.setAttribute('aria-label', champ === 'est_actif' ? 'Compte actif' : 'Administrateur');

        if (ligne.id === moi.id) {
            boite.disabled = true;
            etiquette.title = 'Vous ne pouvez pas modifier votre propre compte ici';
        }

        boite.addEventListener('change', function () {
            var valeur = boite.checked;
            var envoi = {};
            envoi[champ] = valeur;

            boite.disabled = true;
            masquerErreur();

            C.appeler('/administration/utilisateurs/' + ligne.id + '/' + chemin, {
                method: 'POST',
                corps: envoi,
            })
                .then(function (misAJour) {
                    ligne[champ] = misAJour[champ];
                    boite.checked = misAJour[champ];
                })
                .catch(function (erreur) {
                    boite.checked = !valeur;
                    afficherErreur(erreur.message);
                })
                .finally(function () { boite.disabled = ligne.id === moi.id; });
        });

        var curseur = document.createElement('span');
        curseur.className = 'bascule-curseur';
        curseur.setAttribute('aria-hidden', 'true');

        etiquette.appendChild(boite);
        etiquette.appendChild(curseur);
        return etiquette;
    }

    function cellule(contenu) {
        var td = document.createElement('td');
        if (typeof contenu === 'string') td.textContent = contenu;
        else td.appendChild(contenu);
        return td;
    }

    function afficherUtilisateurs(lignes) {
        C.vider(corps);

        lignes.forEach(function (ligne) {
            var tr = document.createElement('tr');

            var identite = document.createElement('div');
            identite.className = 'cellule-identite';

            var pastille = document.createElement('span');
            pastille.className = 'pastille pastille-petite';
            pastille.textContent = C.initiales(ligne);

            var textes = document.createElement('div');
            var nom = document.createElement('span');
            nom.className = 'cellule-nom';
            nom.textContent = ligne.prenom + ' ' + ligne.nom + (ligne.id === moi.id ? ' (vous)' : '');
            var adresse = document.createElement('span');
            adresse.className = 'cellule-courriel';
            adresse.textContent = ligne.courriel;

            textes.appendChild(nom);
            textes.appendChild(adresse);
            identite.appendChild(pastille);
            identite.appendChild(textes);

            tr.appendChild(cellule(identite));
            tr.appendChild(cellule(moyensDeConnexion(ligne)));
            tr.appendChild(cellule(formaterDate(ligne.cree_le)));
            tr.appendChild(cellule(bascule(ligne, 'est_actif', 'activation')));
            tr.appendChild(cellule(bascule(ligne, 'est_admin', 'administrateur')));

            corps.appendChild(tr);
        });

        chargement.hidden = true;
        tableau.hidden = false;
    }

    function charger() {
        C.appeler('/administration/utilisateurs')
            .then(afficherUtilisateurs)
            .catch(function (erreur) {
                chargement.hidden = true;
                afficherErreur(erreur.message);
            });
    }

    // --- Demarrage --------------------------------------------------------
    if (!C.lireJeton()) {
        window.location.href = '/';
        return;
    }

    C.appeler('/moi')
        .then(function (compte) {
            if (!compte.est_admin) {
                window.location.href = '/';
                return;
            }
            moi = compte;
            C.afficherCompte(compte, { masquerAdministration: true });
            if (window.Marche) window.Marche.appliquer(true);
            charger();
        })
        .catch(function () {
            C.effacerJeton();
            window.location.href = '/';
        });
})();
