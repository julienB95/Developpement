// Boite de creation d'un compte, reservee aux administrateurs.
// Il n'y a plus d'inscription publique : c'est le seul chemin depuis l'interface.
(function () {
    'use strict';

    var C = window.Crypto;

    var dialogue = null;
    var champs = {};
    var surCreation = null;

    function etiquette(pour, texte) {
        var element = document.createElement('label');
        element.htmlFor = pour;
        element.textContent = texte;
        return element;
    }

    function champTexte(identifiant, libelle, type) {
        var bloc = document.createElement('div');
        bloc.className = 'champ';

        var entree = document.createElement('input');
        entree.type = type || 'text';
        entree.id = identifiant;
        entree.name = identifiant;

        bloc.appendChild(etiquette(identifiant, libelle));
        bloc.appendChild(entree);

        champs[identifiant] = entree;
        champs['bloc_' + identifiant] = bloc;
        return bloc;
    }

    function caseACocher(identifiant, libelle, aide) {
        var bloc = document.createElement('div');
        bloc.className = 'champ-case';

        var boite = document.createElement('input');
        boite.type = 'checkbox';
        boite.id = identifiant;
        boite.name = identifiant;

        var texte = document.createElement('label');
        texte.htmlFor = identifiant;
        texte.textContent = libelle;

        var ligne = document.createElement('div');
        ligne.className = 'champ-case-ligne';
        ligne.appendChild(boite);
        ligne.appendChild(texte);
        bloc.appendChild(ligne);

        if (aide) {
            var note = document.createElement('p');
            note.className = 'aide';
            note.textContent = aide;
            bloc.appendChild(note);
        }

        champs[identifiant] = boite;
        return bloc;
    }

    function construire() {
        dialogue = document.createElement('dialog');
        dialogue.className = 'dialogue';
        dialogue.id = 'dialogue-utilisateur';

        var formeFermer = document.createElement('form');
        formeFermer.method = 'dialog';
        formeFermer.className = 'dialogue-fermer-forme';
        var fermer = document.createElement('button');
        fermer.className = 'dialogue-fermer';
        fermer.value = 'annuler';
        fermer.setAttribute('aria-label', 'Fermer');
        fermer.textContent = '×';
        formeFermer.appendChild(fermer);
        dialogue.appendChild(formeFermer);

        var titre = document.createElement('h2');
        titre.textContent = 'Nouvel utilisateur';
        dialogue.appendChild(titre);

        var forme = document.createElement('form');
        forme.className = 'formulaire';
        forme.noValidate = true;

        forme.appendChild(champTexte('u_prenom', 'Prénom'));
        forme.appendChild(champTexte('u_nom', 'Nom'));
        forme.appendChild(champTexte('u_courriel', 'Adresse de courriel', 'email'));

        forme.appendChild(caseACocher(
            'u_a_definir',
            'Définira son mot de passe lui-même',
            'Le compte est créé sans mot de passe. Un lien à usage unique lui permet de choisir le sien.'
        ));

        forme.appendChild(champTexte('u_mot_de_passe', 'Mot de passe provisoire', 'password'));

        forme.appendChild(caseACocher(
            'u_google',
            'Autorisé à se connecter par Google',
            'Sans cette case, une tentative de connexion Google avec cette adresse sera refusée.'
        ));

        var erreur = document.createElement('p');
        erreur.className = 'erreur';
        erreur.setAttribute('role', 'alert');
        erreur.hidden = true;
        forme.appendChild(erreur);
        champs.erreur = erreur;

        var resultat = document.createElement('div');
        resultat.className = 'resultat-creation';
        resultat.hidden = true;
        forme.appendChild(resultat);
        champs.resultat = resultat;

        var actions = document.createElement('div');
        actions.className = 'actions-dialogue';

        var valider = document.createElement('button');
        valider.type = 'submit';
        valider.className = 'bouton bouton-principal';
        valider.textContent = 'Créer';
        actions.appendChild(valider);
        champs.valider = valider;

        forme.appendChild(actions);
        forme.addEventListener('submit', creer);

        champs.u_a_definir.addEventListener('change', ajusterMotDePasse);

        dialogue.appendChild(forme);
        document.body.appendChild(dialogue);
        champs.forme = forme;
    }

    // Le mot de passe provisoire ne sert que si l'administrateur le pose lui-même
    function ajusterMotDePasse() {
        champs.bloc_u_mot_de_passe.hidden = champs.u_a_definir.checked;
    }

    function afficherErreur(message) {
        champs.erreur.textContent = message;
        champs.erreur.hidden = false;
    }

    // Sans SMTP configuré, le lien est affiché pour que l'administrateur le transmette
    function afficherLien(reponse) {
        C.vider(champs.resultat);
        champs.resultat.hidden = false;
        champs.erreur.hidden = true;

        var titre = document.createElement('p');
        titre.className = 'succes';
        titre.textContent = reponse.courriel_envoye
            ? 'Compte créé. Un courriel vient de partir avec le lien de définition du mot de passe.'
            : 'Compte créé.';
        champs.resultat.appendChild(titre);

        if (!reponse.lien) return;

        var explication = document.createElement('p');
        explication.className = 'aide';
        explication.textContent = "L'envoi de courriel n'est pas configuré sur ce serveur. "
            + 'Transmettez ce lien vous-même — valable une heure, un seul usage :';
        champs.resultat.appendChild(explication);

        var zone = document.createElement('input');
        zone.type = 'text';
        zone.className = 'champ-lien';
        zone.readOnly = true;
        zone.value = reponse.lien;
        zone.addEventListener('focus', function () { zone.select(); });
        champs.resultat.appendChild(zone);

        var copier = document.createElement('button');
        copier.type = 'button';
        copier.className = 'bouton bouton-discret bouton-petit';
        copier.textContent = 'Copier le lien';
        copier.addEventListener('click', function () {
            zone.select();
            // Le presse-papiers peut être refusé (page non sécurisée, permission) :
            // la sélection reste faite, l'utilisateur peut copier à la main.
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(zone.value)
                    .then(function () { copier.textContent = 'Lien copié'; })
                    .catch(function () { copier.textContent = 'Copiez avec Ctrl+C'; });
            } else {
                copier.textContent = 'Copiez avec Ctrl+C';
            }
        });
        champs.resultat.appendChild(copier);
    }

    function creer(evenement) {
        evenement.preventDefault();
        champs.erreur.hidden = true;

        var corps = {
            prenom: champs.u_prenom.value.trim(),
            nom: champs.u_nom.value.trim(),
            courriel: champs.u_courriel.value.trim().toLowerCase(),
            autorise_google: champs.u_google.checked,
            mot_de_passe_a_definir: champs.u_a_definir.checked,
        };

        if (!corps.prenom || !corps.nom) return afficherErreur('Renseignez le prénom et le nom.');
        if (!corps.courriel) return afficherErreur("Renseignez l'adresse de courriel.");

        if (!corps.mot_de_passe_a_definir) {
            corps.mot_de_passe = champs.u_mot_de_passe.value;
            if (corps.mot_de_passe.length < 12) {
                return afficherErreur('Le mot de passe provisoire doit faire au moins 12 caractères.');
            }
        }

        champs.valider.disabled = true;
        C.appeler('/administration/utilisateurs', { method: 'POST', corps: corps })
            .then(function (reponse) {
                afficherLien(reponse);
                champs.forme.querySelectorAll('.champ, .champ-case').forEach(function (bloc) {
                    bloc.hidden = true;
                });
                champs.valider.textContent = 'Fermer';
                champs.valider.type = 'button';
                champs.valider.addEventListener('click', function () { dialogue.close(); });
                if (surCreation) surCreation(reponse.utilisateur);
            })
            .catch(function (erreur) {
                if (erreur.code === 409) {
                    return afficherErreur('Un compte existe déjà avec cette adresse.');
                }
                afficherErreur(erreur.message);
            })
            .finally(function () { champs.valider.disabled = false; });
    }

    function ouvrir(options) {
        options = options || {};
        surCreation = options.surCreation || null;

        // Une boîte déjà utilisée garde l'état de la création précédente :
        // on la reconstruit plutôt que de démêler les cas.
        if (dialogue) {
            dialogue.remove();
            dialogue = null;
            champs = {};
        }
        construire();

        champs.u_a_definir.checked = true;
        ajusterMotDePasse();

        if (typeof dialogue.showModal === 'function') dialogue.showModal();
        else dialogue.setAttribute('open', '');
    }

    window.Utilisateur = { ouvrir: ouvrir };
})();
