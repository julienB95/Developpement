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

    // --- Plus-values par annee --------------------------------------------
    var pvAnnee = document.getElementById('pv-annee');
    var pvContenu = document.getElementById('pv-contenu');
    var pvPrecedent = document.getElementById('pv-precedent');
    var pvSuivant = document.getElementById('pv-suivant');

    // Annee civile francaise : c'est elle qui fait foi pour la declaration,
    // pas l'annee du fuseau du poste.
    var ANNEE_COURANTE = Number(new Intl.DateTimeFormat('fr-CA', {
        timeZone: 'Europe/Paris', year: 'numeric',
    }).format(new Date()));

    var anneePlusValues = ANNEE_COURANTE;

    function messagePlusValues(texte, classe) {
        C.vider(pvContenu);
        var message = document.createElement('p');
        message.className = classe || 'pv-vide';
        message.textContent = texte;
        pvContenu.appendChild(message);
    }

    // Les plus-values s'affichent au centime : formaterMontant arrondit les
    // montants au-dela de 100 a l'unite, ce qui gommerait la difference entre
    // deux cessions proches. La declaration, elle, reste en euro.
    function formaterEuros(montant) {
        var nombre = Number(montant);
        if (montant === null || montant === undefined || !isFinite(nombre)) return '—';
        return new Intl.NumberFormat('fr-FR', {
            style: 'currency',
            currency: 'EUR',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(nombre);
    }

    // Le signe vient de la chaine decimale, pas du nombre : une perte minuscule
    // arrondie a zero doit rester une perte.
    function signerEuros(montant) {
        if (montant === null || montant === undefined) return '—';
        var formate = formaterEuros(montant);
        return String(montant).charAt(0) === '-' ? formate : '+' + formate;
    }

    function classePlusValue(montant) {
        if (montant === null || montant === undefined) return '';
        return String(montant).charAt(0) === '-' ? 'pv-perte' : 'pv-gain';
    }

    function ligneCrypto(crypto) {
        var item = document.createElement('li');
        item.className = 'pv-ligne';
        item.appendChild(C.logoCrypto(crypto.id_crypto));

        var texte = document.createElement('span');
        texte.className = 'pv-texte';

        var nom = document.createElement('span');
        nom.className = 'pv-libelle';
        nom.textContent = crypto.libelle;

        var detail = document.createElement('span');
        detail.className = 'pv-detail';
        detail.textContent = (crypto.cessions > 1 ? crypto.cessions + ' cessions' : '1 cession')
            + ' · ' + formaterEuros(crypto.prix_cession) + ' cédés';

        texte.appendChild(nom);
        texte.appendChild(detail);

        var montant = document.createElement('span');
        montant.className = 'pv-montant ' + classePlusValue(crypto.plus_value);
        montant.textContent = signerEuros(crypto.plus_value);

        item.appendChild(texte);
        item.appendChild(montant);
        return item;
    }

    // Une plus-value calculee sur un portefeuille mal valorise est fausse, et
    // toujours dans le meme sens : trop haute. Le chiffre reste affiche, mais
    // jamais sans sa reserve.
    function reservesDuBilan(donnees) {
        var motifs = [];
        donnees.cryptos.forEach(function (crypto) {
            crypto.lignes.forEach(function (ligne) {
                ligne.reserves.forEach(function (motif) {
                    if (motifs.indexOf(motif) === -1) motifs.push(motif);
                });
            });
        });
        return motifs;
    }

    function rendrePlusValues(donnees) {
        pvAnnee.textContent = donnees.annee;
        pvPrecedent.disabled = donnees.premiere_annee !== null
            && donnees.annee <= donnees.premiere_annee;
        pvSuivant.disabled = donnees.annee >= ANNEE_COURANTE;

        if (!donnees.cryptos.length) {
            return messagePlusValues('Aucune cession en ' + donnees.annee + '.');
        }

        C.vider(pvContenu);

        var total = document.createElement('div');
        total.className = 'pv-total';

        var libelle = document.createElement('span');
        libelle.className = 'pv-total-libelle';
        libelle.textContent = donnees.total.cessions > 1
            ? donnees.total.cessions + ' cessions'
            : '1 cession';

        var montantTotal = document.createElement('span');
        montantTotal.className = 'pv-total-montant ' + classePlusValue(donnees.total.plus_value);
        montantTotal.textContent = signerEuros(donnees.total.plus_value);

        total.appendChild(libelle);
        total.appendChild(montantTotal);
        pvContenu.appendChild(total);

        var liste = document.createElement('ul');
        liste.className = 'liste-pv';
        donnees.cryptos.forEach(function (crypto) {
            liste.appendChild(ligneCrypto(crypto));
        });
        pvContenu.appendChild(liste);

        if (!donnees.complet) {
            var alerte = document.createElement('p');
            alerte.className = 'pv-reserve';
            alerte.textContent = 'Chiffre à vérifier : ' + reservesDuBilan(donnees).join(' ; ') + '.';
            pvContenu.appendChild(alerte);
        }

        // La convention de staking change le résultat : tant que le compte en
        // compte au moins une, le chiffre affiché ne se lit pas sans elle.
        if (donnees.staking && donnees.staking.operations) {
            pvContenu.appendChild(noteStaking(donnees.staking.convention));
        }
    }

    function noteStaking(convention) {
        var note = document.createElement('p');
        note.className = 'aide pv-convention';
        note.appendChild(document.createTextNode(convention === 'valeur_recue'
            ? 'Staking compté à sa valeur à la réception ('
            : "Staking compté à un prix d'acquisition nul ("));

        var lien = document.createElement('a');
        lien.href = '/profil.html';
        lien.textContent = 'profil';
        note.appendChild(lien);

        note.appendChild(document.createTextNode(').'));
        return note;
    }

    function chargerPlusValues() {
        if (!compteCourant || !pvContenu) return;

        // L'annee est posee avant l'appel : meme en cas d'echec, l'entete dit
        // sur quelle annee on se trouve.
        pvAnnee.textContent = anneePlusValues;

        C.appeler('/plus-values?annee=' + anneePlusValues)
            .then(rendrePlusValues)
            .catch(function (erreur) {
                messagePlusValues('Plus-values indisponibles : ' + erreur.message, 'pv-reserve');
            });
    }

    function changerAnnee(pas) {
        anneePlusValues += pas;
        chargerPlusValues();
    }

    if (pvPrecedent) {
        pvPrecedent.addEventListener('click', function () { changerAnnee(-1); });
    }
    if (pvSuivant) {
        pvSuivant.addEventListener('click', function () { changerAnnee(1); });
    }

    // --- Operations -------------------------------------------------------
    // Toutes les operations du compte, par tranches chargees a mesure que l'on
    // descend : plus de pages a parcourir une par une.
    var TAILLE_PAGE = 20;

    var operationsContenu = document.getElementById('operations-contenu');
    var operationsTotal = document.getElementById('operations-total');
    var operationsSentinelle = document.getElementById('operations-sentinelle');
    var operationsEtat = document.getElementById('operations-etat');
    var boutonAjout = document.getElementById('bouton-ajout-operation');

    var pageOperations = 0;
    var pagesOperations = 1;
    var chargementOperations = false;

    // Corps du tableau en cours de remplissage : les tranches suivantes s'y
    // ajoutent, au lieu de reconstruire la liste entiere a chaque fois.
    var corpsOperations = null;

    function etatOperations(texte) {
        if (operationsEtat) operationsEtat.textContent = texte;
    }

    function messageOperations(texte) {
        C.vider(operationsContenu);
        corpsOperations = null;
        var message = document.createElement('p');
        message.className = 'espace-vide';
        message.textContent = texte;
        operationsContenu.appendChild(message);
        etatOperations('');
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

    function construireTableau() {
        C.vider(operationsContenu);

        var enveloppe = document.createElement('div');
        enveloppe.className = 'tableau-defilant';

        var tableau = document.createElement('table');
        tableau.className = 'tableau tableau-operations';

        var entete = document.createElement('tr');
        ['Crypto', 'Date', 'Type', 'Quantité', 'Montant'].forEach(function (titre, rang) {
            var th = document.createElement('th');
            th.scope = 'col';
            th.textContent = titre;
            if (rang >= 3) th.className = 'cellule-nombre';
            entete.appendChild(th);
        });
        var thead = document.createElement('thead');
        thead.appendChild(entete);
        tableau.appendChild(thead);

        corpsOperations = document.createElement('tbody');
        tableau.appendChild(corpsOperations);

        enveloppe.appendChild(tableau);
        operationsContenu.appendChild(enveloppe);
    }

    function rangeeOperation(ligne) {
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

        var type = document.createElement('td');
        type.appendChild(C.etiquetteType(ligne.type));
        rangee.appendChild(type);

        rangee.appendChild(cellule(C.formaterQuantite(ligne.quantite), 'cellule-nombre'));
        rangee.appendChild(cellule(texteMontant(ligne.montant, 'EUR'), classeMontant(ligne.montant)));

        return rangee;
    }

    function majTotalOperations(total) {
        if (!operationsTotal) return;
        operationsTotal.textContent = total;
        operationsTotal.hidden = false;
    }

    function ajouterOperations(donnees) {
        // Premiere tranche : le tableau est refait. Les suivantes s'y ajoutent.
        if (donnees.page === 1) {
            if (!donnees.lignes.length) {
                return messageOperations(
                    'Aucune opération enregistrée. Utilisez le bouton + pour en ajouter une.'
                );
            }
            construireTableau();
        }
        if (!corpsOperations) return;

        donnees.lignes.forEach(function (ligne) {
            corpsOperations.appendChild(rangeeOperation(ligne));
        });
    }

    // suivante : la tranche qui suit la derniere chargee. Sinon on repart de la
    // premiere, ce qui reconstruit la liste.
    function chargerOperations(suivante) {
        if (!compteCourant || !operationsContenu) return;
        if (chargementOperations) return;
        if (suivante && pageOperations >= pagesOperations) return;

        var page = suivante ? pageOperations + 1 : 1;
        chargementOperations = true;
        if (page > 1) etatOperations('Chargement…');

        C.appeler('/operations?taille=' + TAILLE_PAGE + '&page=' + page)
            .then(function (donnees) {
                pageOperations = donnees.page;
                pagesOperations = donnees.pages;
                majTotalOperations(donnees.total);
                ajouterOperations(donnees);
                etatOperations('');
            })
            .catch(function (erreur) {
                if (page === 1) messageOperations('Opérations indisponibles : ' + erreur.message);
                else etatOperations('Suite indisponible : ' + erreur.message);
            })
            .finally(function () {
                chargementOperations = false;
                suiteSiVisible();
            });
    }

    // Une tranche de vingt lignes ne remplit pas forcement l'ecran : sans cette
    // relance, la sentinelle resterait visible sans jamais repasser par une
    // entree dans le champ, et le chargement s'arreterait la.
    function suiteSiVisible() {
        if (!operationsSentinelle || chargementOperations) return;
        if (pageOperations >= pagesOperations) return;
        if (operationsSentinelle.getBoundingClientRect().top <= window.innerHeight) {
            chargerOperations(true);
        }
    }

    if (operationsSentinelle && typeof IntersectionObserver === 'function') {
        // La marge fait partir la demande avant que le bas ne soit atteint :
        // la suite est deja la quand on y arrive.
        new IntersectionObserver(function (entrees) {
            entrees.forEach(function (entree) {
                if (entree.isIntersecting) chargerOperations(true);
            });
        }, { rootMargin: '300px' }).observe(operationsSentinelle);
    } else if (operationsSentinelle) {
        // Repli pour un navigateur sans IntersectionObserver
        window.addEventListener('scroll', suiteSiVisible, { passive: true });
        window.addEventListener('resize', suiteSiVisible);
    }
    if (boutonAjout) {
        boutonAjout.addEventListener('click', function () {
            window.Operation.ouvrir({
                surEnregistrement: function () {
                    chargerOperations();
                    chargerDetentions();
                    // Une vente change les plus-values de son annee, et le
                    // cumul des fractions imputees pour toutes les suivantes.
                    chargerPlusValues();
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
            anneePlusValues = ANNEE_COURANTE;
            chargerDetentions();
            chargerOperations();
            chargerPlusValues();
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
