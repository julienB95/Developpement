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

    // Supprimer son propre compte fermerait la session en cours et pourrait
    // retirer le dernier administrateur : le bouton est neutralisé, pas caché,
    // pour que la raison soit lisible au survol.
    function actionsUtilisateur(ligne) {
        var actions = document.createElement('div');
        actions.className = 'cellule-actions';

        var bouton = document.createElement('button');
        bouton.type = 'button';
        bouton.className = 'bouton bouton-danger bouton-petit';
        bouton.textContent = 'Supprimer';

        if (ligne.id === moi.id) {
            bouton.disabled = true;
            bouton.title = 'Vous ne pouvez pas supprimer votre propre compte';
            actions.appendChild(bouton);
            return actions;
        }

        bouton.addEventListener('click', function () {
            var avertissements = ['Compte : ' + ligne.courriel + '.'];
            var aCocher = null;

            if (ligne.operations > 0) {
                avertissements.push(ligne.operations + ' opération(s) enregistrée(s) '
                    + 'seront supprimées avec le compte.');
                aCocher = 'Je confirme supprimer ce compte et ses '
                    + ligne.operations + ' opération(s).';
            }
            if (ligne.sessions_ouvertes > 0) {
                avertissements.push(ligne.sessions_ouvertes + ' session(s) ouverte(s) '
                    + 'seront fermées.');
            }

            confirmerSuppression('le compte de ' + ligne.prenom + ' ' + ligne.nom,
                function (cascade) {
                    return C.appeler('/administration/utilisateurs/' + ligne.id
                        + (cascade ? '?cascade=1' : ''), { method: 'DELETE' });
                },
                charger, avertissements, aCocher);
        });

        actions.appendChild(bouton);
        return actions;
    }

    var listeUtilisateurs = [];

    function afficherUtilisateurs(lignes) {
        listeUtilisateurs = lignes;
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
            tr.appendChild(cellule(actionsUtilisateur(ligne)));

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
        valeurs: ouvrirValeurs,
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
        var apercus = {};

        // Passe aux champs qui savent en remplir d'autres : une liste de choix
        // renseigne le reste de la fiche a partir de ce qui a ete selectionne.
        var pilote = {
            definir: function (nom, valeur) {
                var entree = entrees[nom];
                if (!entree) return;
                if (entree.type === 'checkbox') entree.checked = !!valeur;
                else entree.value = valeur === null || valeur === undefined ? '' : valeur;
            },
            logo: function (nom, adresse, symbole) {
                var zone = apercus[nom];
                if (!zone) return;
                C.vider(zone);
                if (!adresse) return;

                var image = document.createElement('img');
                image.src = adresse;
                image.alt = '';
                image.width = 32;
                image.height = 32;
                zone.appendChild(image);

                var texte = document.createElement('span');
                texte.className = 'aide';
                texte.textContent = 'Logo de ' + (symbole || '') + ' récupéré automatiquement.';
                zone.appendChild(texte);
            },
        };

        listeChamps.forEach(function (champ) {
            var bloc = document.createElement('div');
            bloc.className = champ.type === 'case' ? 'champ-case' : 'champ';

            if (champ.type === 'logo') {
                bloc.className = 'apercu-logo';
                apercus[champ.nom] = bloc;
                forme.appendChild(bloc);
                return;
            }

            if (champ.type === 'combo') {
                var etiquetteCombo = document.createElement('label');
                etiquetteCombo.htmlFor = 'fiche_' + champ.nom;
                etiquetteCombo.textContent = champ.libelle;
                if (champ.obligatoire) etiquetteCombo.appendChild(etoile());

                var saisie = document.createElement('input');
                saisie.type = 'text';
                saisie.id = 'fiche_' + champ.nom;
                saisie.setAttribute('list', 'liste_' + champ.nom);
                saisie.autocomplete = 'off';
                saisie.placeholder = champ.exemple || '';

                // <datalist> donne la recherche au clavier sans une ligne de script
                var liste = document.createElement('datalist');
                liste.id = 'liste_' + champ.nom;
                (champ.options || []).forEach(function (option) {
                    var element = document.createElement('option');
                    element.value = option.valeur;
                    if (option.libelle) element.label = option.libelle;
                    liste.appendChild(element);
                });

                saisie.addEventListener('change', function () {
                    if (champ.surChoix) champ.surChoix(saisie.value, pilote);
                });

                bloc.appendChild(etiquetteCombo);
                bloc.appendChild(saisie);
                bloc.appendChild(liste);
                entrees[champ.nom] = saisie;
            } else if (champ.type === 'case') {
                // Même interrupteur que dans la liste des utilisateurs :
                // une case à cocher et un interrupteur pour la même idée
                // auraient donné deux vocabulaires visuels dans la même page.
                var ligne = document.createElement('div');
                ligne.className = 'champ-case-ligne';

                var boite = document.createElement('input');
                boite.type = 'checkbox';
                boite.id = 'fiche_' + champ.nom;
                boite.checked = !!champ.valeur;

                var curseur = document.createElement('span');
                curseur.className = 'bascule-curseur';
                curseur.setAttribute('aria-hidden', 'true');

                var interrupteur = document.createElement('label');
                interrupteur.className = 'bascule';
                interrupteur.appendChild(boite);
                interrupteur.appendChild(curseur);

                var texte = document.createElement('label');
                texte.htmlFor = boite.id;
                texte.textContent = champ.libelle;

                ligne.appendChild(interrupteur);
                ligne.appendChild(texte);
                bloc.appendChild(ligne);
                entrees[champ.nom] = boite;
            } else {
                var etiquette = document.createElement('label');
                etiquette.htmlFor = 'fiche_' + champ.nom;
                etiquette.textContent = champ.libelle;
                if (champ.obligatoire) etiquette.appendChild(etoile());

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

        // Le bouton reste inactif tant qu'un champ obligatoire est vide
        var obligatoires = listeChamps
            .filter(function (champ) { return champ.obligatoire; })
            .map(function (champ) { return entrees[champ.nom]; })
            .filter(Boolean);

        function verifierObligatoires() {
            valider.disabled = obligatoires.some(function (entree) {
                return !String(entree.value || '').trim();
            });
        }

        obligatoires.forEach(function (entree) {
            entree.addEventListener('input', verifierObligatoires);
            entree.addEventListener('change', verifierObligatoires);
        });
        verifierObligatoires();

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
                .finally(verifierObligatoires);
        });

        dialogue.appendChild(forme);
        document.body.appendChild(dialogue);

        // Une fiche est creee a chaque ouverture : elle disparait avec elle
        C.fermerAuClicExterieur(dialogue);
        dialogue.addEventListener('close', function () { dialogue.remove(); });

        if (typeof dialogue.showModal === 'function') dialogue.showModal();
        else dialogue.setAttribute('open', '');
    }

    // Marque un champ obligatoire. L'étoile est portée par le libellé lui-même :
    // un lecteur d'écran annonce donc « Crypto, obligatoire ».
    function etoile() {
        var marque = document.createElement('abbr');
        marque.className = 'obligatoire';
        marque.title = 'Champ obligatoire';
        marque.textContent = '*';
        return marque;
    }

    // --- Confirmation d'une suppression -----------------------------------
    // Une vraie boîte plutôt que window.confirm : elle peut détailler ce que
    // la suppression emporte, ce que l'alerte du navigateur ne permet pas.
    function confirmer(titre, lignes, surConfirmation, aCocher) {
        var dialogue = document.createElement('dialog');
        dialogue.className = 'dialogue';

        var entete = document.createElement('h2');
        entete.textContent = titre;
        dialogue.appendChild(entete);

        lignes.forEach(function (texte, rang) {
            var paragraphe = document.createElement('p');
            paragraphe.className = rang === 0 ? 'confirmation-question' : 'aide';
            paragraphe.textContent = texte;
            dialogue.appendChild(paragraphe);
        });

        // Case de confirmation : quand la suppression emporte autre chose
        // qu'elle-meme, elle doit etre reclamee explicitement.
        var accord = null;
        if (aCocher) {
            var bloc = document.createElement('div');
            bloc.className = 'champ-case champ-case-alerte';

            var ligne = document.createElement('div');
            ligne.className = 'champ-case-ligne';

            accord = document.createElement('input');
            accord.type = 'checkbox';
            accord.id = 'confirmation-cascade';

            var texte = document.createElement('label');
            texte.htmlFor = accord.id;
            texte.textContent = aCocher;

            ligne.appendChild(accord);
            ligne.appendChild(texte);
            bloc.appendChild(ligne);
            dialogue.appendChild(bloc);
        }

        var erreur = document.createElement('p');
        erreur.className = 'erreur';
        erreur.setAttribute('role', 'alert');
        erreur.hidden = true;
        dialogue.appendChild(erreur);

        var actions = document.createElement('div');
        actions.className = 'actions-dialogue';

        var annuler = document.createElement('button');
        annuler.type = 'button';
        annuler.className = 'bouton bouton-discret';
        annuler.textContent = 'Annuler';
        annuler.addEventListener('click', function () {
            dialogue.close();
            dialogue.remove();
        });

        var valider = document.createElement('button');
        valider.type = 'button';
        valider.className = 'bouton bouton-danger';
        valider.textContent = 'Supprimer';
        valider.disabled = !!accord;

        if (accord) {
            accord.addEventListener('change', function () {
                valider.disabled = !accord.checked;
            });
        }

        valider.addEventListener('click', function () {
            valider.disabled = true;
            erreur.hidden = true;

            Promise.resolve(surConfirmation(accord ? accord.checked : false))
                .then(function () { dialogue.close(); dialogue.remove(); })
                .catch(function (err) {
                    erreur.textContent = err.message;
                    erreur.hidden = false;
                    valider.disabled = accord ? !accord.checked : false;
                });
        });

        actions.appendChild(annuler);
        actions.appendChild(valider);
        dialogue.appendChild(actions);

        document.body.appendChild(dialogue);

        C.fermerAuClicExterieur(dialogue);
        dialogue.addEventListener('close', function () { dialogue.remove(); });

        if (typeof dialogue.showModal === 'function') dialogue.showModal();
        else dialogue.setAttribute('open', '');
        annuler.focus();
    }

    // --- Tri des colonnes -------------------------------------------------
    // Le tri porte sur les donnees, jamais sur le DOM : la fonction de rendu
    // reste la seule a decider de ce qui s'affiche.
    function comparer(a, b) {
        var aVide = a === null || a === undefined || a === '';
        var bVide = b === null || b === undefined || b === '';
        if (aVide && bVide) return 0;
        if (aVide) return 1;   // les valeurs manquantes vont en fin de liste
        if (bVide) return -1;

        if (typeof a === 'boolean' || typeof b === 'boolean') {
            return (a === b) ? 0 : (a ? -1 : 1);
        }

        var nombreA = Number(a);
        var nombreB = Number(b);
        if (!isNaN(nombreA) && !isNaN(nombreB)) return nombreA - nombreB;

        return String(a).localeCompare(String(b), 'fr', { numeric: true, sensitivity: 'base' });
    }

    // colonnes : un extracteur par colonne, null pour celles qui ne se trient pas
    function brancherTri(idTableau, colonnes, obtenirLignes, rendre) {
        var tableauCible = document.getElementById(idTableau);
        if (!tableauCible) return;

        var entetes = Array.prototype.slice.call(tableauCible.querySelectorAll('thead th'));
        var etat = { rang: null, croissant: true };

        colonnes.forEach(function (extraire, rang) {
            var entete = entetes[rang];
            if (!extraire || !entete) return;

            entete.classList.add('triable');
            entete.tabIndex = 0;

            function trier() {
                if (etat.rang === rang) etat.croissant = !etat.croissant;
                else { etat.rang = rang; etat.croissant = true; }

                var lignes = obtenirLignes().slice();
                lignes.sort(function (a, b) {
                    return comparer(extraire(a), extraire(b)) * (etat.croissant ? 1 : -1);
                });

                entetes.forEach(function (autre) { autre.removeAttribute('aria-sort'); });
                entete.setAttribute('aria-sort', etat.croissant ? 'ascending' : 'descending');

                rendre(lignes);
            }

            entete.addEventListener('click', trier);
            entete.addEventListener('keydown', function (evenement) {
                if (evenement.key === 'Enter' || evenement.key === ' ') {
                    evenement.preventDefault();
                    trier();
                }
            });
        });
    }

    function boutonLigne(libelle, action, classe) {
        var bouton = document.createElement('button');
        bouton.type = 'button';
        bouton.className = 'bouton bouton-petit ' + (classe || 'bouton-discret');
        bouton.textContent = libelle;
        bouton.addEventListener('click', action);
        return bouton;
    }

    // appel recoit true quand la case de confirmation a ete cochee
    function confirmerSuppression(designation, appel, apres, avertissements, aCocher) {
        masquerErreur();
        confirmer(
            'Supprimer ' + designation + ' ?',
            ['Cette suppression est définitive.'].concat(avertissements || []),
            function (cascade) { return appel(cascade).then(apres); },
            aCocher
        );
    }

    // --- Cryptos ----------------------------------------------------------
    var corpsCryptos = document.getElementById('corps-cryptos');
    var listeCryptos = [];

    // Les cent plus grosses capitalisations, chargées une fois pour la session
    var catalogueCryptos = null;

    function chargerCatalogue() {
        if (catalogueCryptos) return Promise.resolve(catalogueCryptos);
        return C.appeler('/administration/catalogue-cryptos')
            .then(function (lignes) { catalogueCryptos = lignes; return lignes; })
            .catch(function () { catalogueCryptos = []; return []; });
    }

    function ficheCrypto(crypto) {
        var creation = !crypto;
        var logoChoisi = creation ? null : crypto.logo_url;

        var prepare = creation ? chargerCatalogue() : Promise.resolve([]);

        prepare.then(function (catalogue) {
            // Une crypto déjà au référentiel ne doit pas être proposée : la
            // choisir aurait écrasé la fiche existante au lieu d'en créer une.
            var deja = new Set();
            listeCryptos.forEach(function (crypto) {
                deja.add(crypto.id);
                if (crypto.identifiant_coingecko) deja.add(crypto.identifiant_coingecko);
            });

            var parChoix = new Map();
            var options = catalogue
                .filter(function (entree) {
                    return !deja.has(entree.symbole) && !deja.has(entree.identifiant_coingecko);
                })
                .map(function (entree) {
                    var valeur = entree.symbole + ' — ' + entree.libelle;
                    parChoix.set(valeur, entree);
                    return { valeur: valeur, libelle: 'n° ' + entree.rang };
                });

            var listeChamps = [];

            if (creation) {
                listeChamps.push({
                    nom: 'choix',
                    libelle: 'Crypto',
                    type: 'combo',
                    options: options,
                    obligatoire: true,
                    exemple: 'Tapez un code ou un nom : BTC, Solana…',
                    aide: catalogue.length
                        ? 'Les ' + catalogue.length + ' plus grosses capitalisations. '
                          + 'Le reste de la fiche se remplit tout seul.'
                        : 'Catalogue indisponible : renseignez les champs à la main.',
                    surChoix: function (valeur, pilote) {
                        var entree = parChoix.get(valeur);
                        if (!entree) return;

                        logoChoisi = entree.logo_url;
                        pilote.definir('id', entree.symbole);
                        pilote.definir('libelle', entree.libelle);
                        pilote.definir('identifiant_coingecko', entree.identifiant_coingecko);
                        // La paire en euro suit presque toujours cette forme ; reste modifiable
                        pilote.definir('paire_binance', entree.symbole + 'EUR');
                        pilote.logo('apercu', entree.logo_url, entree.symbole);
                    },
                });
                listeChamps.push({ nom: 'apercu', type: 'logo' });
            }

            listeChamps.push({ nom: 'id', libelle: 'Symbole',
                valeur: creation ? '' : crypto.id, lectureSeule: !creation });
            listeChamps.push({ nom: 'libelle', libelle: 'Libellé',
                valeur: creation ? '' : crypto.libelle });
            listeChamps.push({ nom: 'identifiant_coingecko', libelle: 'Identifiant CoinGecko',
                valeur: creation ? '' : crypto.identifiant_coingecko,
                aide: 'Sert aux cours affichés en direct.' });
            listeChamps.push({ nom: 'paire_binance', libelle: 'Paire Binance en euro',
                valeur: creation ? '' : crypto.paire_binance,
                aide: 'Sert au relevé de la valeur moyenne journalière.' });
            listeChamps.push({ nom: 'est_suivi', libelle: 'Actif', type: 'case',
                valeur: creation ? true : crypto.est_suivi });

            ouvrirFiche(creation ? 'Nouvelle crypto' : 'Modifier ' + crypto.id, listeChamps,
                function (valeurs) {
                    if (!valeurs.id) throw new Error('Choisissez une crypto ou renseignez son symbole.');
                    if (!valeurs.libelle) throw new Error('Le libellé est obligatoire.');

                    // Le symbole reste saisissable à la main : ce contrôle rattrape
                    // le cas où l'on retape celui d'une crypto déjà présente.
                    if (creation && deja.has(valeurs.id.toUpperCase())) {
                        throw new Error('La crypto ' + valeurs.id.toUpperCase()
                            + ' existe déjà. Modifiez-la depuis la liste.');
                    }

                    return C.appeler('/cryptos', {
                        method: 'POST',
                        corps: {
                            id: valeurs.id,
                            libelle: valeurs.libelle,
                            identifiant_coingecko: valeurs.identifiant_coingecko || null,
                            paire_binance: valeurs.paire_binance || null,
                            est_suivi: valeurs.est_suivi,
                            logo_url: logoChoisi || null,
                        },
                    }).then(chargerCryptos);
                });
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

            // L'identifiant CoinGecko et la paire Binance restent modifiables
            // par la fiche, mais n'encombrent pas la liste.
            var suivi = document.createElement('span');
            suivi.className = 'etiquette-sens ' + (ligne.est_suivi ? 'etiquette-achat' : 'etiquette-vente');
            suivi.textContent = ligne.est_suivi ? 'Oui' : 'Non';
            tr.appendChild(cellule(suivi));

            var actions = document.createElement('div');
            actions.className = 'cellule-actions';
            actions.appendChild(boutonLigne('Modifier', function () { ficheCrypto(ligne); }));
            actions.appendChild(boutonLigne('Supprimer', function () {
                // L'alerte détaille ce que la suppression emporte : les valeurs
                // quotidiennes partent en cascade, les opérations la bloquent.
                var avertissements = [];
                if (ligne.valeurs > 0) {
                    avertissements.push(ligne.valeurs + ' valeur(s) quotidienne(s) enregistrée(s) '
                        + 'seront supprimées avec elle.');
                }

                // Emporter des opérations d'utilisateurs ne peut pas être
                // implicite : la case doit être cochée pour armer le bouton.
                var aCocher = null;
                if (ligne.operations > 0) {
                    avertissements.push(ligne.operations + ' opération(s) d’utilisateurs '
                        + 'portent cette crypto.');
                    aCocher = 'Je confirme supprimer la crypto ' + ligne.id + ', ses '
                        + ligne.valeurs + ' valeur(s) et ses ' + ligne.operations + ' opération(s).';
                }

                confirmerSuppression('la crypto ' + ligne.id,
                    function (cascade) {
                        return C.appeler('/cryptos/' + ligne.id + (cascade ? '?cascade=1' : ''),
                            { method: 'DELETE' });
                    },
                    chargerCryptos, avertissements, aCocher);
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

    var listePlateformes = [];

    // Le libellé est la seule donnée d'une plateforme, et il lui sert de clé.
    function fichePlateforme(plateforme) {
        var creation = !plateforme;
        ouvrirFiche(creation ? 'Nouvelle plateforme' : 'Modifier ' + plateforme.libelle, [
            { nom: 'libelle', libelle: 'Libellé', obligatoire: true,
              valeur: creation ? '' : plateforme.libelle },
            { nom: 'est_actif', libelle: 'Actif', type: 'case',
              valeur: creation ? true : plateforme.est_actif,
              aide: "Une plateforme inactive n'est plus proposée à la saisie d'une opération, "
                  + 'mais reste rattachée aux opérations déjà enregistrées.' },
        ], function (valeurs) {
            if (!valeurs.libelle) throw new Error('Le libellé est obligatoire.');

            // Doublon rattrapé avant l’appel : la casse ne fait pas la différence
            var doublon = listePlateformes.some(function (autre) {
                return autre.libelle.toLowerCase() === valeurs.libelle.toLowerCase()
                    && (creation || autre.libelle !== plateforme.libelle);
            });
            if (doublon) throw new Error('La plateforme « ' + valeurs.libelle + ' » existe déjà.');

            return C.appeler('/plateformes', {
                method: 'POST',
                corps: {
                    libelle: valeurs.libelle,
                    est_actif: valeurs.est_actif,
                    ancien_libelle: creation ? null : plateforme.libelle,
                },
            }).then(chargerPlateformes);
        });
    }

    function afficherPlateformes(lignes) {
        listePlateformes = lignes;
        C.vider(corpsPlateformes);

        lignes.forEach(function (ligne) {
            var tr = document.createElement('tr');
            tr.appendChild(cellule(ligne.libelle));

            var actif = document.createElement('span');
            actif.className = 'etiquette-sens ' + (ligne.est_actif ? 'etiquette-achat' : 'etiquette-vente');
            actif.textContent = ligne.est_actif ? 'Oui' : 'Non';
            tr.appendChild(cellule(actif));

            var actions = document.createElement('div');
            actions.className = 'cellule-actions';
            actions.appendChild(boutonLigne('Modifier', function () { fichePlateforme(ligne); }));
            actions.appendChild(boutonLigne('Supprimer', function () {
                confirmerSuppression('la plateforme ' + ligne.libelle,
                    function () { return C.appeler('/plateformes/' + encodeURIComponent(ligne.libelle), { method: 'DELETE' }); },
                    chargerPlateformes);
            }, 'bouton-danger'));
            tr.appendChild(cellule(actions));

            corpsPlateformes.appendChild(tr);
        });
    }

    function chargerPlateformes() {
        return C.appeler('/plateformes')
            .then(afficherPlateformes)
            .catch(function (err) { afficherErreur(err.message); });
    }

    document.getElementById('bouton-ajout-plateforme')
        .addEventListener('click', function () { fichePlateforme(null); });

    // --- Valeurs quotidiennes ---------------------------------------------
    var corpsValeurs = document.getElementById('corps-valeurs');
    var choixCrypto = document.getElementById('valeurs-crypto');
    var choixAnnee = document.getElementById('valeurs-annee');
    var resultatReleve = document.getElementById('resultat-releve');

    // Le choix ne propose que le contenu de la table crypto. Une crypto
    // supprimee entre-temps disparait, et la selection retombe sur la premiere.
    function remplirChoixCryptos(toutes) {
        // Une crypto desactivee ne doit plus etre proposee
        var lignes = toutes.filter(function (crypto) { return crypto.est_suivi; });
        var precedent = choixCrypto.value;
        C.vider(choixCrypto);

        lignes.forEach(function (crypto) {
            var option = document.createElement('option');
            option.value = crypto.id;
            option.textContent = crypto.libelle + ' (' + crypto.id + ')';
            choixCrypto.appendChild(option);
        });

        var toujoursLa = lignes.some(function (crypto) { return crypto.id === precedent; });
        choixCrypto.value = toujoursLa ? precedent : (lignes.length ? lignes[0].id : '');
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

    var listeValeurs = [];

    function messageValeurs(texte) {
        C.vider(corpsValeurs);
        var vide = document.createElement('tr');
        var cellVide = document.createElement('td');
        cellVide.colSpan = 8;
        cellVide.className = 'espace-vide';
        cellVide.textContent = texte;
        vide.appendChild(cellVide);
        corpsValeurs.appendChild(vide);
    }

    function afficherValeurs(lignes) {
        listeValeurs = lignes;

        if (!lignes.length) {
            return messageValeurs('Aucune valeur enregistrée pour cette sélection.');
        }

        C.vider(corpsValeurs);

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
    }

    // Le référentiel est relu avant d'ouvrir l'onglet : une crypto supprimée
    // entre-temps ne doit plus figurer dans le choix.
    function ouvrirValeurs() {
        return chargerCryptos().then(chargerValeurs);
    }

    function chargerValeurs() {
        if (!choixAnnee.options.length) remplirAnnees();

        if (!choixCrypto.value) {
            listeValeurs = [];
            return Promise.resolve(messageValeurs('Aucune crypto dans le référentiel.'));
        }

        var requete = '/valeurs?crypto=' + encodeURIComponent(choixCrypto.value) + '&limite=400';
        if (choixAnnee.value) requete += '&annee=' + encodeURIComponent(choixAnnee.value);

        return C.appeler(requete)
            .then(afficherValeurs)
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

    // --- Colonnes triables ------------------------------------------------
    brancherTri('tableau-utilisateurs', [
        function (l) { return l.prenom + ' ' + l.nom; },
        moyensDeConnexion,
        function (l) { return l.cree_le; },
        function (l) { return l.est_actif; },
        function (l) { return l.est_admin; },
        function (l) { return l.autorise_google; },
        function (l) { return l.est_bloque; },
    ], function () { return listeUtilisateurs; }, afficherUtilisateurs);

    brancherTri('tableau-cryptos', [
        function (l) { return l.id; },
        function (l) { return l.est_suivi; },
        null,
    ], function () { return listeCryptos; }, afficherCryptos);

    brancherTri('tableau-plateformes', [
        function (l) { return l.libelle; },
        function (l) { return l.est_actif; },
        null,
    ], function () { return listePlateformes; }, afficherPlateformes);

    brancherTri('tableau-valeurs', [
        function (l) { return l.date; },
        function (l) { return l.vwap; },
        function (l) { return l.ouverture; },
        function (l) { return l.haut; },
        function (l) { return l.bas; },
        function (l) { return l.cloture; },
        function (l) { return l.source; },
        null,
    ], function () { return listeValeurs; }, afficherValeurs);

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
