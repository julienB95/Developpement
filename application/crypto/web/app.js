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
    var blocMotDePasse = document.getElementById('bloc-mot-de-passe');
    var lienOubli = document.getElementById('lien-oubli');
    var zoneSucces = document.getElementById('succes-auth');
    var zoneGoogle = document.getElementById('zone-google');
    var googleDisponible = false;

    var mode = 'connexion';
    var compteCourant = null;

    // --- Cryptos detenues -------------------------------------------------
    var listeDetentions = document.getElementById('liste-detentions');

    function messageDetentions(texte) {
        C.vider(listeDetentions);
        var item = document.createElement('li');
        item.className = 'detention-vide';
        item.textContent = texte;
        listeDetentions.appendChild(item);
    }

    function rendreDetentions(donnees) {
        if (!donnees.lignes.length) {
            return messageDetentions('Aucune crypto détenue pour le moment.');
        }

        C.vider(listeDetentions);

        donnees.lignes.forEach(function (ligne) {
            var item = document.createElement('li');
            item.className = 'detention';

            var texte = document.createElement('span');
            texte.className = 'detention-texte';

            var libelle = document.createElement('span');
            libelle.className = 'detention-libelle';
            libelle.textContent = ligne.libelle;

            var symbole = document.createElement('span');
            symbole.className = 'detention-symbole';
            symbole.textContent = ligne.id_crypto;

            texte.appendChild(libelle);
            texte.appendChild(symbole);

            var quantite = document.createElement('span');
            quantite.className = 'detention-quantite';
            quantite.textContent = C.formaterQuantite(ligne.quantite);

            item.appendChild(C.logoCrypto(ligne.id_crypto));
            item.appendChild(texte);
            item.appendChild(quantite);
            listeDetentions.appendChild(item);
        });
    }

    function chargerDetentions() {
        if (!compteCourant || !listeDetentions) return;

        C.appeler('/mon-portefeuille')
            .then(rendreDetentions)
            .catch(function (erreur) {
                messageDetentions('Détentions indisponibles : ' + erreur.message);
            });
    }

    // --- Dernieres operations ---------------------------------------------
    var TAILLE_PAGE = 5;

    var operationsContenu = document.getElementById('operations-contenu');
    var operationsPagination = document.getElementById('operations-pagination');
    var operationsPosition = document.getElementById('operations-position');
    var operationsPrecedent = document.getElementById('operations-precedent');
    var operationsSuivant = document.getElementById('operations-suivant');
    var boutonAjout = document.getElementById('bouton-ajout-operation');

    var pageOperations = 1;

    function messageOperations(texte) {
        C.vider(operationsContenu);
        var message = document.createElement('p');
        message.className = 'espace-vide';
        message.textContent = texte;
        operationsContenu.appendChild(message);
        operationsPagination.hidden = true;
    }

    function cellule(texte, classe) {
        var td = document.createElement('td');
        if (classe) td.className = classe;
        td.textContent = texte;
        return td;
    }

    function classeMontant(montant) {
        if (montant === null || montant === undefined) return 'cellule-nombre';
        return 'cellule-nombre ' + (String(montant).charAt(0) === '-' ? 'montant-sortie' : 'montant-entree');
    }

    // Le montant arrive deja signe du serveur ; le signe + est ajoute a l'affichage
    function texteMontant(montant, devise) {
        if (montant === null || montant === undefined) return '—';
        var formate = C.formaterMontant(montant, devise);
        return String(montant).charAt(0) === '-' ? formate : '+' + formate;
    }

    function rendreOperations(donnees) {
        if (!donnees.lignes.length) {
            return messageOperations(donnees.total
                ? 'Aucune opération sur cette page.'
                : 'Aucune opération enregistrée. Utilisez le bouton + pour en ajouter une.');
        }

        C.vider(operationsContenu);

        var enveloppe = document.createElement('div');
        enveloppe.className = 'tableau-defilant';

        var tableau = document.createElement('table');
        tableau.className = 'tableau tableau-operations';

        var entete = document.createElement('tr');
        ['Crypto', 'Date', 'Sens', 'Quantité', 'Montant'].forEach(function (titre, rang) {
            var th = document.createElement('th');
            th.scope = 'col';
            th.textContent = titre;
            if (rang >= 3) th.className = 'cellule-nombre';
            entete.appendChild(th);
        });
        var thead = document.createElement('thead');
        thead.appendChild(entete);
        tableau.appendChild(thead);

        var corps = document.createElement('tbody');
        donnees.lignes.forEach(function (ligne) {
            var rangee = document.createElement('tr');

            var identite = document.createElement('td');
            var groupe = document.createElement('span');
            groupe.className = 'cellule-identite';
            groupe.appendChild(C.logoCrypto(ligne.id_crypto, 24));
            var symbole = document.createElement('span');
            symbole.className = 'cellule-nom';
            symbole.textContent = ligne.id_crypto;
            groupe.appendChild(symbole);
            identite.appendChild(groupe);
            rangee.appendChild(identite);

            rangee.appendChild(cellule(C.formaterDateHeure(ligne.horodatage)));

            var sens = document.createElement('td');
            var etiquette = document.createElement('span');
            etiquette.className = 'etiquette-sens etiquette-' + ligne.sens;
            etiquette.textContent = ligne.sens === 'achat' ? 'Achat' : 'Vente';
            sens.appendChild(etiquette);
            rangee.appendChild(sens);

            rangee.appendChild(cellule(C.formaterQuantite(ligne.quantite), 'cellule-nombre'));
            rangee.appendChild(cellule(texteMontant(ligne.montant, 'EUR'), classeMontant(ligne.montant)));

            corps.appendChild(rangee);
        });
        tableau.appendChild(corps);

        enveloppe.appendChild(tableau);
        operationsContenu.appendChild(enveloppe);

        operationsPagination.hidden = donnees.pages <= 1;
        operationsPosition.textContent = 'Page ' + donnees.page + ' sur ' + donnees.pages;
        operationsPrecedent.disabled = donnees.page <= 1;
        operationsSuivant.disabled = donnees.page >= donnees.pages;
    }

    function chargerOperations() {
        if (!compteCourant || !operationsContenu) return;

        C.appeler('/operations?taille=' + TAILLE_PAGE + '&page=' + pageOperations)
            .then(function (donnees) {
                pageOperations = donnees.page;
                rendreOperations(donnees);
            })
            .catch(function (erreur) {
                messageOperations('Opérations indisponibles : ' + erreur.message);
            });
    }

    if (operationsPrecedent) {
        operationsPrecedent.addEventListener('click', function () {
            if (pageOperations > 1) { pageOperations -= 1; chargerOperations(); }
        });
    }
    if (operationsSuivant) {
        operationsSuivant.addEventListener('click', function () {
            pageOperations += 1;
            chargerOperations();
        });
    }
    if (boutonAjout) {
        boutonAjout.addEventListener('click', function () {
            window.Operation.ouvrir({
                surEnregistrement: function () {
                    pageOperations = 1;
                    chargerOperations();
                    chargerDetentions();
                },
            });
        });
    }

    // --- Affichage --------------------------------------------------------
    function appliquerEtat(compte) {
        // Hors connexion, la page se limite aux blocs defilants : ils peuvent
        // occuper toute la largeur disponible plutot que la colonne de lecture.
        document.body.classList.toggle('page-large', !compte);

        // La devise du compte fait foi des la connexion, avant tout affichage de montant
        if (compte) C.definirDevise(compte.devise, { enregistrer: false });
        compteCourant = compte || null;

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
            chargerDetentions();
            chargerOperations();
            return;
        }

        // Hors connexion, la page se limite aux cours et aux actualités.
        // Les comptes sont créés par un administrateur, pas en libre-service.
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
        var oubli = mode === 'oubli';

        titreDialogue.textContent = oubli ? 'Mot de passe oublié' : 'Connexion';
        boutonValider.textContent = oubli ? 'Recevoir le lien' : 'Se connecter';

        // En mode oubli, seule l adresse est demandee
        blocMotDePasse.hidden = oubli;
        document.getElementById('mot_de_passe').required = !oubli;
        lienOubli.hidden = oubli;
        if (zoneGoogle) zoneGoogle.hidden = oubli || !googleDisponible;

        masquerErreur();
        masquerSucces();
    }

    function afficherErreur(message) {
        zoneErreur.textContent = message;
        zoneErreur.hidden = false;
    }
    function masquerErreur() {
        zoneErreur.textContent = '';
        zoneErreur.hidden = true;
    }

    function afficherSucces(message) {
        zoneSucces.textContent = message;
        zoneSucces.hidden = false;
    }
    function masquerSucces() {
        zoneSucces.textContent = '';
        zoneSucces.hidden = true;
    }

    function reussite(reponse) {
        C.ecrireJeton(reponse.jeton);
        appliquerEtat(reponse.utilisateur);
        dialogue.close();
    }


    C.fermerAuClicExterieur(dialogue);

    lienOubli.addEventListener('click', function () { basculerMode('oubli'); });

    formulaire.addEventListener('submit', function (evenement) {
        evenement.preventDefault();
        masquerErreur();
        masquerSucces();

        var courriel = document.getElementById('courriel').value.trim().toLowerCase();
        var motDePasse = document.getElementById('mot_de_passe').value;

        // Demande de réinitialisation : seule l'adresse est nécessaire
        if (mode === 'oubli') {
            if (!courriel) return afficherErreur('Renseignez votre adresse de courriel.');

            boutonValider.disabled = true;
            return C.appeler('/mot-de-passe/oubli', { method: 'POST', corps: { courriel: courriel } })
                .then(function (reponse) { afficherSucces(reponse.statut); })
                .catch(function (erreur) { afficherErreur(erreur.message); })
                .finally(function () { boutonValider.disabled = false; });
        }

        if (!courriel || !motDePasse) {
            return afficherErreur('Renseignez votre adresse de courriel et votre mot de passe.');
        }

        boutonValider.disabled = true;
        C.appeler('/connexion', { method: 'POST', corps: { courriel: courriel, mot_de_passe: motDePasse } })
            .then(reussite)
            .catch(function (erreur) { afficherErreur(erreur.message); })
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
            googleDisponible = true;
            zone.hidden = mode === 'oubli';
        };
        document.head.appendChild(script);
    }

    // --- Demarrage --------------------------------------------------------
    appliquerEtat(null);

    // Reposee juste apres l'etat initial : sans ca, une page ouverte avec une
    // session valide s'elargirait une fraction de seconde avant que /moi reponde.
    document.body.classList.toggle('page-large', !C.lireJeton());

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
