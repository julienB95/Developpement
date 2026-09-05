// Administration : parametrage des utilisateurs
(function () {
    'use strict';

    var C = window.Crypto;

    var chargement = document.getElementById('chargement');
    var tableau = document.getElementById('tableau-utilisateurs');
    var corps = document.getElementById('corps-utilisateurs');
    var zoneErreur = document.getElementById('erreur-page');

    var moi = null;

    var LIBELLES_BASCULE = {
        est_actif: 'Compte actif',
        est_admin: 'Administrateur',
        autorise_google: 'Connexion Google autorisée',
    };

    // Se retirer soi-meme l'acces ou le droit d'administration verrouillerait le compte
    var CHAMPS_PROTEGES = ['est_actif', 'est_admin'];

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
        boite.setAttribute('aria-label', LIBELLES_BASCULE[champ] || champ);

        var interdit = ligne.id === moi.id && CHAMPS_PROTEGES.includes(champ);
        if (interdit) {
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
                .finally(function () { boite.disabled = interdit; });
        });

        var curseur = document.createElement('span');
        curseur.className = 'bascule-curseur';
        curseur.setAttribute('aria-hidden', 'true');

        etiquette.appendChild(boite);
        etiquette.appendChild(curseur);
        return etiquette;
    }

    // Le blocage ne se pose que tout seul, après trois échecs de connexion :
    // l'administrateur ne peut que le lever.
    function etatBlocage(ligne) {
        if (!ligne.est_bloque) {
            var libre = document.createElement('span');
            libre.className = 'cellule-courriel';
            libre.textContent = '—';
            return libre;
        }

        var conteneur = document.createElement('span');
        conteneur.className = 'cellule-identite';

        var etiquette = document.createElement('span');
        etiquette.className = 'etiquette-sens etiquette-vente';
        etiquette.textContent = 'Bloqué';

        var bouton = document.createElement('button');
        bouton.type = 'button';
        bouton.className = 'bouton bouton-discret bouton-petit';
        bouton.textContent = 'Débloquer';
        bouton.addEventListener('click', function () {
            bouton.disabled = true;
            masquerErreur();

            C.appeler('/administration/utilisateurs/' + ligne.id + '/deblocage', { method: 'POST' })
                .then(function (misAJour) {
                    ligne.est_bloque = misAJour.est_bloque;
                    C.vider(conteneur.parentNode);
                    conteneur.parentNode.appendChild(etatBlocage(ligne));
                })
                .catch(function (erreur) {
                    bouton.disabled = false;
                    afficherErreur(erreur.message);
                });
        });

        conteneur.appendChild(etiquette);
        conteneur.appendChild(bouton);
        return conteneur;
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
            tr.appendChild(cellule(bascule(ligne, 'autorise_google', 'google')));
            tr.appendChild(cellule(etatBlocage(ligne)));

            corps.appendChild(tr);
        });

        chargement.hidden = true;
        tableau.hidden = false;
    }

    var boutonAjout = document.getElementById('bouton-ajout-utilisateur');
    if (boutonAjout) {
        boutonAjout.addEventListener('click', function () {
            window.Utilisateur.ouvrir({ surCreation: charger });
        });
    }

    function charger() {
        C.appeler('/administration/utilisateurs')
            .then(afficherUtilisateurs)
            .catch(function (erreur) {
                chargement.hidden = true;
                afficherErreur(erreur.message);
            });
    }


    // --- Onglets ----------------------------------------------------------
    var sections = {
        utilisateurs: document.getElementById('section-utilisateurs'),
        cryptos: document.getElementById('section-cryptos'),
        plateformes: document.getElementById('section-plateformes'),
        valeurs: document.getElementById('section-valeurs'),
    };

    var chargeurs = {
        utilisateurs: function () { charger(); },
        cryptos: chargerCryptos,
        plateformes: chargerPlateformes,
        valeurs: chargerValeurs,
    };

    var dejaCharge = {};

    function ouvrirSection(nom) {
        Object.keys(sections).forEach(function (cle) {
            if (sections[cle]) sections[cle].hidden = cle !== nom;
        });

        document.querySelectorAll('#onglets-administration .onglet').forEach(function (onglet) {
            var actif = onglet.dataset.section === nom;
            onglet.classList.toggle('actif', actif);
            onglet.setAttribute('aria-selected', String(actif));
        });

        masquerErreur();

        // Chaque section n'est chargée qu'à sa première ouverture
        if (!dejaCharge[nom]) {
            dejaCharge[nom] = true;
            if (chargeurs[nom]) chargeurs[nom]();
        }
    }

    document.querySelectorAll('#onglets-administration .onglet').forEach(function (onglet) {
        onglet.addEventListener('click', function () { ouvrirSection(onglet.dataset.section); });
    });

    // --- Fiche générique --------------------------------------------------
    // Une seule boîte sert au référentiel des cryptos et à celui des plateformes :
    // les deux ne sont que des listes de quelques champs.
    function ouvrirFiche(titre, listeChamps, surValidation) {
        var dialogue = document.createElement('dialog');
        dialogue.className = 'dialogue';

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

        var entete = document.createElement('h2');
        entete.textContent = titre;
        dialogue.appendChild(entete);

        var forme = document.createElement('form');
        forme.className = 'formulaire';
        forme.noValidate = true;

        var entrees = {};

        listeChamps.forEach(function (champ) {
            var bloc = document.createElement('div');
            bloc.className = champ.type === 'case' ? 'champ-case' : 'champ';

            if (champ.type === 'case') {
                var ligne = document.createElement('div');
                ligne.className = 'champ-case-ligne';

                var boite = document.createElement('input');
                boite.type = 'checkbox';
                boite.id = 'fiche_' + champ.nom;
                boite.checked = !!champ.valeur;

                var texte = document.createElement('label');
                texte.htmlFor = boite.id;
                texte.textContent = champ.libelle;

                ligne.appendChild(boite);
                ligne.appendChild(texte);
                bloc.appendChild(ligne);
                entrees[champ.nom] = boite;
            } else {
                var etiquette = document.createElement('label');
                etiquette.htmlFor = 'fiche_' + champ.nom;
                etiquette.textContent = champ.libelle;

                var entree = document.createElement('input');
                entree.type = 'text';
                entree.id = 'fiche_' + champ.nom;
                entree.value = champ.valeur === null || champ.valeur === undefined ? '' : champ.valeur;
                entree.readOnly = !!champ.lectureSeule;

                bloc.appendChild(etiquette);
                bloc.appendChild(entree);
                entrees[champ.nom] = entree;
            }

            if (champ.aide) {
                var note = document.createElement('p');
                note.className = 'aide';
                note.textContent = champ.aide;
                bloc.appendChild(note);
            }

            forme.appendChild(bloc);
        });

        var erreur = document.createElement('p');
        erreur.className = 'erreur';
        erreur.setAttribute('role', 'alert');
        erreur.hidden = true;
        forme.appendChild(erreur);

        var actions = document.createElement('div');
        actions.className = 'actions-dialogue';
        var valider = document.createElement('button');
        valider.type = 'submit';
        valider.className = 'bouton bouton-principal';
        valider.textContent = 'Enregistrer';
        actions.appendChild(valider);
        forme.appendChild(actions);

        forme.addEventListener('submit', function (evenement) {
            evenement.preventDefault();
            erreur.hidden = true;

            var valeurs = {};
            Object.keys(entrees).forEach(function (nom) {
                var entree = entrees[nom];
                valeurs[nom] = entree.type === 'checkbox' ? entree.checked : entree.value.trim();
            });

            valider.disabled = true;
            Promise.resolve(surValidation(valeurs))
                .then(function () { dialogue.close(); dialogue.remove(); })
                .catch(function (err) {
                    erreur.textContent = err.message;
                    erreur.hidden = false;
                })
                .finally(function () { valider.disabled = false; });
        });

        dialogue.appendChild(forme);
        document.body.appendChild(dialogue);

        if (typeof dialogue.showModal === 'function') dialogue.showModal();
        else dialogue.setAttribute('open', '');
    }

    function boutonLigne(libelle, action, classe) {
        var bouton = document.createElement('button');
        bouton.type = 'button';
        bouton.className = 'bouton bouton-petit ' + (classe || 'bouton-discret');
        bouton.textContent = libelle;
        bouton.addEventListener('click', action);
        return bouton;
    }

    function confirmerSuppression(libelle, appel, apres) {
        if (!window.confirm('Supprimer définitivement ' + libelle + ' ?')) return;
        masquerErreur();
        appel()
            .then(apres)
            .catch(function (err) { afficherErreur(err.message); });
    }

    // --- Cryptos ----------------------------------------------------------
    var corpsCryptos = document.getElementById('corps-cryptos');
    var listeCryptos = [];

    function ficheCrypto(crypto) {
        var creation = !crypto;
        ouvrirFiche(creation ? 'Nouvelle crypto' : 'Modifier ' + crypto.id, [
            { nom: 'id', libelle: 'Symbole', valeur: creation ? '' : crypto.id, lectureSeule: !creation,
              aide: creation ? 'Le symbole d’usage : BTC, ETH, SOL…' : null },
            { nom: 'libelle', libelle: 'Libellé', valeur: creation ? '' : crypto.libelle },
            { nom: 'identifiant_coingecko', libelle: 'Identifiant CoinGecko',
              valeur: creation ? '' : crypto.identifiant_coingecko,
              aide: 'Celui de l’adresse coingecko.com/fr/pièces/… : bitcoin, ethereum…' },
            { nom: 'paire_binance', libelle: 'Paire Binance en euro',
              valeur: creation ? '' : crypto.paire_binance,
              aide: 'Sert au relevé de la valeur moyenne journalière : BTCEUR, ETHEUR…' },
            { nom: 'est_suivi', libelle: 'Suivie sur le site', type: 'case',
              valeur: creation ? true : crypto.est_suivi },
        ], function (valeurs) {
            if (!valeurs.id) throw new Error('Le symbole est obligatoire.');
            if (!valeurs.libelle) throw new Error('Le libellé est obligatoire.');

            return C.appeler('/cryptos', {
                method: 'POST',
                corps: {
                    id: valeurs.id,
                    libelle: valeurs.libelle,
                    identifiant_coingecko: valeurs.identifiant_coingecko || null,
                    paire_binance: valeurs.paire_binance || null,
                    est_suivi: valeurs.est_suivi,
                },
            }).then(chargerCryptos);
        });
    }

    function afficherCryptos(lignes) {
        listeCryptos = lignes;
        C.vider(corpsCryptos);

        lignes.forEach(function (ligne) {
            var tr = document.createElement('tr');

            var identite = document.createElement('div');
            identite.className = 'cellule-identite';
            identite.appendChild(C.logoCrypto(ligne.id, 24));
            var textes = document.createElement('div');
            var symbole = document.createElement('span');
            symbole.className = 'cellule-nom';
            symbole.textContent = ligne.id;
            var libelle = document.createElement('span');
            libelle.className = 'cellule-courriel';
            libelle.textContent = ligne.libelle;
            textes.appendChild(symbole);
            textes.appendChild(libelle);
            identite.appendChild(textes);

            tr.appendChild(cellule(identite));
            tr.appendChild(cellule(ligne.identifiant_coingecko || '—'));
            tr.appendChild(cellule(ligne.paire_binance || '—'));

            var suivi = document.createElement('span');
            suivi.className = 'etiquette-sens ' + (ligne.est_suivi ? 'etiquette-achat' : 'etiquette-vente');
            suivi.textContent = ligne.est_suivi ? 'Oui' : 'Non';
            tr.appendChild(cellule(suivi));

            var actions = document.createElement('div');
            actions.className = 'cellule-actions';
            actions.appendChild(boutonLigne('Modifier', function () { ficheCrypto(ligne); }));
            actions.appendChild(boutonLigne('Supprimer', function () {
                confirmerSuppression('la crypto ' + ligne.id,
                    function () { return C.appeler('/cryptos/' + ligne.id, { method: 'DELETE' }); },
                    chargerCryptos);
            }, 'bouton-danger'));
            tr.appendChild(cellule(actions));

            corpsCryptos.appendChild(tr);
        });
    }

    function chargerCryptos() {
        return C.appeler('/cryptos')
            .then(function (lignes) {
                afficherCryptos(lignes);
                remplirChoixCryptos(lignes);
            })
            .catch(function (err) { afficherErreur(err.message); });
    }

    document.getElementById('bouton-ajout-crypto')
        .addEventListener('click', function () { ficheCrypto(null); });

    // --- Plateformes ------------------------------------------------------
    var corpsPlateformes = document.getElementById('corps-plateformes');

    function fichePlateforme(plateforme) {
        var creation = !plateforme;
        ouvrirFiche(creation ? 'Nouvelle plateforme' : 'Modifier ' + plateforme.libelle, [
            { nom: 'id', libelle: 'Identifiant', valeur: creation ? '' : plateforme.id,
              lectureSeule: !creation, aide: creation ? 'En minuscules, sans espace : binance, kraken…' : null },
            { nom: 'libelle', libelle: 'Libellé', valeur: creation ? '' : plateforme.libelle },
        ], function (valeurs) {
            if (!valeurs.id) throw new Error("L'identifiant est obligatoire.");
            if (!valeurs.libelle) throw new Error('Le libellé est obligatoire.');

            return C.appeler('/plateformes', {
                method: 'POST',
                corps: { id: valeurs.id, libelle: valeurs.libelle },
            }).then(chargerPlateformes);
        });
    }

    function chargerPlateformes() {
        return C.appeler('/plateformes')
            .then(function (lignes) {
                C.vider(corpsPlateformes);
                lignes.forEach(function (ligne) {
                    var tr = document.createElement('tr');
                    tr.appendChild(cellule(ligne.id));
                    tr.appendChild(cellule(ligne.libelle));

                    var actions = document.createElement('div');
                    actions.className = 'cellule-actions';
                    actions.appendChild(boutonLigne('Modifier', function () { fichePlateforme(ligne); }));
                    actions.appendChild(boutonLigne('Supprimer', function () {
                        confirmerSuppression('la plateforme ' + ligne.libelle,
                            function () { return C.appeler('/plateformes/' + ligne.id, { method: 'DELETE' }); },
                            chargerPlateformes);
                    }, 'bouton-danger'));
                    tr.appendChild(cellule(actions));

                    corpsPlateformes.appendChild(tr);
                });
            })
            .catch(function (err) { afficherErreur(err.message); });
    }

    document.getElementById('bouton-ajout-plateforme')
        .addEventListener('click', function () { fichePlateforme(null); });

    // --- Valeurs quotidiennes ---------------------------------------------
    var corpsValeurs = document.getElementById('corps-valeurs');
    var choixCrypto = document.getElementById('valeurs-crypto');
    var choixAnnee = document.getElementById('valeurs-annee');
    var resultatReleve = document.getElementById('resultat-releve');

    function remplirChoixCryptos(lignes) {
        var precedent = choixCrypto.value;
        C.vider(choixCrypto);
        lignes.forEach(function (crypto) {
            var option = document.createElement('option');
            option.value = crypto.id;
            option.textContent = crypto.libelle + ' (' + crypto.id + ')';
            choixCrypto.appendChild(option);
        });
        if (precedent) choixCrypto.value = precedent;
    }

    function remplirAnnees() {
        var courante = new Date().getFullYear();
        C.vider(choixAnnee);

        var toutes = document.createElement('option');
        toutes.value = '';
        toutes.textContent = 'Toutes';
        choixAnnee.appendChild(toutes);

        for (var annee = courante; annee >= courante - 8; annee -= 1) {
            var option = document.createElement('option');
            option.value = String(annee);
            option.textContent = String(annee);
            choixAnnee.appendChild(option);
        }
        choixAnnee.value = String(courante);
    }

    function montant(valeur) {
        return valeur === null || valeur === undefined ? '—' : C.formaterMontant(valeur, 'EUR');
    }

    function chargerValeurs() {
        if (!listeCryptos.length) {
            return chargerCryptos().then(function () {
                if (!choixCrypto.value && listeCryptos.length) choixCrypto.value = listeCryptos[0].id;
                return chargerValeurs();
            });
        }
        if (!choixAnnee.options.length) remplirAnnees();
        if (!choixCrypto.value) choixCrypto.value = listeCryptos[0].id;

        var requete = '/valeurs?crypto=' + encodeURIComponent(choixCrypto.value) + '&limite=400';
        if (choixAnnee.value) requete += '&annee=' + encodeURIComponent(choixAnnee.value);

        return C.appeler(requete)
            .then(function (lignes) {
                C.vider(corpsValeurs);

                if (!lignes.length) {
                    var vide = document.createElement('tr');
                    var cellVide = document.createElement('td');
                    cellVide.colSpan = 8;
                    cellVide.className = 'espace-vide';
                    cellVide.textContent = 'Aucune valeur enregistrée pour cette sélection.';
                    vide.appendChild(cellVide);
                    corpsValeurs.appendChild(vide);
                    return;
                }

                lignes.forEach(function (ligne) {
                    var jour = String(ligne.date).slice(0, 10);
                    var tr = document.createElement('tr');

                    tr.appendChild(cellule(jour));
                    [ligne.vwap, ligne.ouverture, ligne.haut, ligne.bas, ligne.cloture]
                        .forEach(function (valeur, rang) {
                            var td = document.createElement('td');
                            td.className = 'cellule-nombre' + (rang === 0 ? ' cellule-valeur' : '');
                            td.textContent = montant(valeur);
                            tr.appendChild(td);
                        });
                    tr.appendChild(cellule(ligne.source || '—'));

                    var actions = document.createElement('div');
                    actions.className = 'cellule-actions';
                    actions.appendChild(boutonLigne('Supprimer', function () {
                        confirmerSuppression('la valeur du ' + jour,
                            function () {
                                return C.appeler('/administration/valeurs/'
                                    + encodeURIComponent(ligne.id_crypto) + '/' + jour, { method: 'DELETE' });
                            },
                            chargerValeurs);
                    }, 'bouton-danger'));
                    tr.appendChild(cellule(actions));

                    corpsValeurs.appendChild(tr);
                });
            })
            .catch(function (err) { afficherErreur(err.message); });
    }

    [choixCrypto, choixAnnee].forEach(function (choix) {
        choix.addEventListener('change', function () { chargerValeurs(); });
    });

    document.getElementById('bouton-relever').addEventListener('click', function () {
        var bouton = this;
        var debut = document.getElementById('releve-debut').value;
        var fin = document.getElementById('releve-fin').value;
        var ecraser = document.getElementById('releve-ecraser').checked;

        if (!debut || !fin) {
            return afficherErreur('Renseignez les deux dates de la période à relever.');
        }

        masquerErreur();
        bouton.disabled = true;
        resultatReleve.hidden = true;

        C.appeler('/administration/valeurs/relever', {
            method: 'POST',
            corps: { id_crypto: choixCrypto.value, debut: debut, fin: fin, ecraser: ecraser },
        })
            .then(function (reponse) {
                var bilan = reponse.bilans[0] || {};
                resultatReleve.textContent = bilan.erreur
                    ? 'Échec : ' + bilan.erreur
                    : bilan.releves + ' valeur(s) enregistrée(s), ' + bilan.ignorees
                      + ' déjà présente(s) et conservée(s), sur ' + bilan.jours + ' jour(s) cotés.';
                resultatReleve.hidden = false;
                return chargerValeurs();
            })
            .catch(function (err) { afficherErreur(err.message); })
            .finally(function () { bouton.disabled = false; });
    });

    remplirAnnees();

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
