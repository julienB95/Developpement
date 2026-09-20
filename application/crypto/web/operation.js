// Boite de saisie d'une operation, partagee par la page d'accueil et la page
// des operations : creation et modification utilisent exactement le meme formulaire.
(function () {
    'use strict';

    var C = window.Crypto;

    // Tous les champs sont obligatoires : le bouton reste inactif tant qu'il
    // en manque un, et chaque libelle porte une etoile.
    var OBLIGATOIRES = ['id_crypto', 'horodatage', 'quantite', 'prix_unitaire', 'frais', 'plateforme'];
    var NUMERIQUES = ['quantite', 'prix_unitaire', 'frais'];

    var dialogue = null;
    var champs = {};
    var referentiel = null;
    var operationCourante = null;
    var surEnregistrement = null;
    var typeCourant = 'achat';

    // Ce que le type change au-delà de son libellé, dit à la saisie
    var NOTES = {
        vente: "À l'enregistrement d'une vente, la valeur moyenne du jour de toutes vos "
            + 'cryptos est relevée et conservée pour la déclaration.',
        staking: 'Une récompense de staking entre au portefeuille comme un achat, mais '
            + "sans frais et sans prix d'acquisition : elle n'a rien coûté.",
    };

    // --- Construction du formulaire ---------------------------------------
    function etoile() {
        var marque = document.createElement('abbr');
        marque.className = 'obligatoire';
        marque.title = 'Champ obligatoire';
        marque.textContent = '*';
        return marque;
    }

    function etiquette(pour, texte, obligatoire) {
        var element = document.createElement('label');
        element.htmlFor = pour;
        element.textContent = texte;
        if (obligatoire) element.appendChild(etoile());
        return element;
    }

    function champTexte(identifiant, libelle, type, aide) {
        var bloc = document.createElement('div');
        bloc.className = 'champ';

        var entree = document.createElement('input');
        entree.type = type || 'text';
        entree.id = identifiant;
        entree.name = identifiant;
        if (type === 'text') entree.inputMode = 'decimal';

        bloc.appendChild(etiquette(identifiant, libelle, OBLIGATOIRES.indexOf(identifiant) >= 0));
        bloc.appendChild(entree);

        if (aide) {
            var note = document.createElement('p');
            note.className = 'aide';
            note.textContent = aide;
            bloc.appendChild(note);
        }

        champs[identifiant] = entree;
        return bloc;
    }

    function champListe(identifiant, libelle) {
        var bloc = document.createElement('div');
        bloc.className = 'champ';

        var liste = document.createElement('select');
        liste.id = identifiant;
        liste.name = identifiant;

        bloc.appendChild(etiquette(identifiant, libelle, OBLIGATOIRES.indexOf(identifiant) >= 0));
        bloc.appendChild(liste);

        champs[identifiant] = liste;
        return bloc;
    }

    function remplirListe(liste, elements, vide) {
        C.vider(liste);

        if (vide) {
            var aucun = document.createElement('option');
            aucun.value = '';
            aucun.textContent = vide;
            liste.appendChild(aucun);
        }

        elements.forEach(function (element) {
            var option = document.createElement('option');
            option.value = element.valeur;
            option.textContent = element.libelle;
            liste.appendChild(option);
        });
    }

    function construire() {
        dialogue = document.createElement('dialog');
        dialogue.className = 'dialogue';
        dialogue.id = 'dialogue-operation';

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
        titre.id = 'titre-operation';
        dialogue.appendChild(titre);
        champs.titre = titre;

        var forme = document.createElement('form');
        forme.className = 'formulaire';
        forme.noValidate = true;

        // Type : un onglet par type d'opération, comme le dialogue de connexion
        var onglets = document.createElement('div');
        onglets.className = 'onglets';
        onglets.setAttribute('role', 'tablist');

        C.typesOperation().forEach(function (type) {
            var bouton = document.createElement('button');
            bouton.type = 'button';
            bouton.className = 'onglet';
            bouton.textContent = type.libelle;
            bouton.addEventListener('click', function () { choisirType(type.valeur); });
            champs['onglet_' + type.valeur] = bouton;
            onglets.appendChild(bouton);
        });
        forme.appendChild(onglets);

        forme.appendChild(champListe('id_crypto', 'Crypto'));
        forme.appendChild(champTexte('horodatage', 'Date et heure', 'datetime-local'));
        forme.appendChild(champTexte('quantite', 'Quantité', 'text'));
        forme.appendChild(champTexte('prix_unitaire', 'Prix unitaire', 'text',
            'Le prix réellement payé ou encaissé, pas le cours du marché.'));
        forme.appendChild(champTexte('frais', 'Frais', 'text'));
        forme.appendChild(champListe('plateforme', 'Plateforme'));

        var erreur = document.createElement('p');
        erreur.className = 'erreur';
        erreur.setAttribute('role', 'alert');
        erreur.hidden = true;
        forme.appendChild(erreur);
        champs.erreur = erreur;

        var note = document.createElement('p');
        note.className = 'aide note-vente';
        note.hidden = true;
        forme.appendChild(note);
        champs.note = note;

        var actions = document.createElement('div');
        actions.className = 'actions-dialogue';

        var supprimer = document.createElement('button');
        supprimer.type = 'button';
        supprimer.className = 'bouton bouton-danger';
        supprimer.textContent = 'Supprimer';
        supprimer.addEventListener('click', supprimerOperation);
        actions.appendChild(supprimer);
        champs.supprimer = supprimer;

        var valider = document.createElement('button');
        valider.type = 'submit';
        valider.className = 'bouton bouton-principal';
        valider.textContent = 'Enregistrer';
        actions.appendChild(valider);
        champs.valider = valider;

        forme.appendChild(actions);
        forme.addEventListener('submit', enregistrer);

        // Le pavé numérique s'ouvre à l'entrée dans un champ de montant
        NUMERIQUES.forEach(function (nom) {
            if (window.Pave) window.Pave.attacher(champs[nom]);
        });

        OBLIGATOIRES.forEach(function (nom) {
            champs[nom].addEventListener('input', verifierObligatoires);
            champs[nom].addEventListener('change', verifierObligatoires);
        });

        C.fermerAuClicExterieur(dialogue);

        dialogue.addEventListener('close', function () {
            if (window.Pave) window.Pave.fermer();
        });

        dialogue.appendChild(forme);
        document.body.appendChild(dialogue);
        champs.forme = forme;
    }

    function verifierObligatoires() {
        champs.valider.disabled = OBLIGATOIRES.some(function (nom) {
            return !String(champs[nom].value || '').trim();
        });
    }

    // Le staking fait entrer de la crypto sans contrepartie en argent : des
    // frais dessus ne veulent rien dire, et la base les refuse. Le champ est
    // donc bloqué à zéro plutôt que laissé à une saisie vouée à l'échec.
    function choisirType(type) {
        typeCourant = type;

        C.typesOperation().forEach(function (candidat) {
            champs['onglet_' + candidat.valeur].classList.toggle('actif', candidat.valeur === type);
        });

        var staking = type === 'staking';
        if (staking) champs.frais.value = '0';
        champs.frais.disabled = staking;

        champs.note.textContent = NOTES[type] || '';
        champs.note.hidden = !NOTES[type];

        verifierObligatoires();
    }

    // --- Referentiel ------------------------------------------------------
    // Les listes completes sont chargees une fois ; le filtrage par etat se fait
    // a l'ouverture, car il depend du mode creation ou modification.
    function chargerReferentiel() {
        if (referentiel) return Promise.resolve(referentiel);

        return Promise.all([
            C.appeler('/cryptos').catch(function () { return []; }),
            C.appeler('/plateformes').catch(function () { return []; }),
            C.appeler('/moi').catch(function () { return null; }),
        ]).then(function (resultats) {
            referentiel = { cryptos: resultats[0], plateformes: resultats[1], compte: resultats[2] };
            return referentiel;
        });
    }

    // En creation, seuls les elements actifs sont proposes. En modification,
    // tous le sont : une operation ancienne peut porter un element retire
    // depuis, et l'enregistrer ne doit pas l'effacer.
    function remplirChoix(creation) {
        var cryptos = referentiel.cryptos.filter(function (crypto) {
            return !creation || crypto.est_suivi;
        });
        remplirListe(champs.id_crypto, cryptos.map(function (crypto) {
            return {
                valeur: crypto.id,
                libelle: crypto.libelle + ' (' + crypto.id + ')' + (crypto.est_suivi ? '' : ' — inactive'),
            };
        }), 'Choisir…');

        var plateformes = referentiel.plateformes.filter(function (plateforme) {
            return !creation || plateforme.est_actif;
        });
        remplirListe(champs.plateforme, plateformes.map(function (plateforme) {
            return {
                valeur: plateforme.libelle,
                libelle: plateforme.libelle + (plateforme.est_actif ? '' : ' — inactive'),
            };
        }), 'Choisir…');
    }

    // --- Conversions date -------------------------------------------------
    // <input datetime-local> travaille en heure locale ; la base stocke de l'UTC.
    function versChampLocal(iso) {
        var date = iso ? new Date(iso) : new Date();
        var decalage = date.getTimezoneOffset() * 60000;
        return new Date(date.getTime() - decalage).toISOString().slice(0, 16);
    }

    function versIso(valeurChamp) {
        var date = new Date(valeurChamp);
        return isNaN(date.getTime()) ? null : date.toISOString();
    }

    // Retire les zéros de fin d'une valeur NUMERIC pour la remettre dans un champ.
    // Le test sur le point est indispensable : sans lui, 100 deviendrait 1.
    function versChampDecimal(valeur) {
        var texte = String(valeur === null || valeur === undefined ? '' : valeur).trim();
        if (!texte || texte.indexOf('.') < 0) return texte;
        return texte.replace(/0+$/, '').replace(/\.$/, '');
    }

    // --- Erreurs ----------------------------------------------------------
    function afficherErreur(message) {
        champs.erreur.textContent = message;
        champs.erreur.hidden = false;
    }
    function masquerErreur() {
        champs.erreur.textContent = '';
        champs.erreur.hidden = true;
    }

    // --- Ouverture --------------------------------------------------------
    function ouvrir(options) {
        options = options || {};
        if (!dialogue) construire();

        operationCourante = options.operation || null;
        surEnregistrement = options.surEnregistrement || null;

        chargerReferentiel().then(function () {
            masquerErreur();

            var modification = !!operationCourante;
            var compte = referentiel.compte || {};

            champs.titre.textContent = modification ? 'Modifier une opération' : 'Nouvelle opération';
            champs.supprimer.hidden = !modification;

            remplirChoix(!modification);

            champs.id_crypto.value = modification ? operationCourante.id_crypto : '';
            champs.horodatage.value = versChampLocal(modification ? operationCourante.horodatage : null);
            champs.quantite.value = modification ? versChampDecimal(operationCourante.quantite) : '';
            champs.prix_unitaire.value = modification ? versChampDecimal(operationCourante.prix_unitaire) : '';

            // Les préférences du compte servent de point de départ à une création
            champs.frais.value = modification
                ? versChampDecimal(operationCourante.frais)
                : versChampDecimal(compte.frais_defaut);
            champs.plateforme.value = modification
                ? (operationCourante.plateforme || '')
                : (compte.plateforme_defaut || '');

            // Après le remplissage : sur un staking, le type remet les frais à
            // zéro, ce que la valeur par défaut du compte écraserait sinon.
            choisirType(modification ? operationCourante.type : 'achat');

            if (typeof dialogue.showModal === 'function') dialogue.showModal();
            else dialogue.setAttribute('open', '');
        });
    }

    // --- Enregistrement ---------------------------------------------------
    function nettoyerDecimal(valeur) {
        return String(valeur || '').trim().replace(',', '.');
    }

    function enregistrer(evenement) {
        evenement.preventDefault();
        masquerErreur();

        var quantite = nettoyerDecimal(champs.quantite.value);
        var prix = nettoyerDecimal(champs.prix_unitaire.value);
        var frais = nettoyerDecimal(champs.frais.value);
        var horodatage = versIso(champs.horodatage.value);

        if (!/^\d+(\.\d+)?$/.test(quantite) || Number(quantite) <= 0) {
            return afficherErreur('Renseignez une quantité décimale strictement positive.');
        }
        if (!/^\d+(\.\d+)?$/.test(prix)) {
            return afficherErreur('Prix unitaire : nombre décimal attendu.');
        }
        if (!/^\d+(\.\d+)?$/.test(frais)) {
            return afficherErreur('Frais : nombre décimal attendu.');
        }
        if (!horodatage) {
            return afficherErreur("Renseignez la date et l'heure de l'opération.");
        }

        var corps = {
            type: typeCourant,
            id_crypto: champs.id_crypto.value,
            quantite: quantite,
            prix_unitaire: prix,
            frais: frais,
            horodatage: horodatage,
            plateforme: champs.plateforme.value || null,
        };

        champs.valider.disabled = true;
        champs.valider.textContent = typeCourant === 'vente' ? 'Relevé des valeurs…' : 'Enregistrement…';

        var chemin = operationCourante ? '/operations/' + operationCourante.id : '/operations';
        var methode = operationCourante ? 'PUT' : 'POST';

        C.appeler(chemin, { method: methode, corps: corps })
            .then(function (reponse) {
                dialogue.close();
                if (surEnregistrement) surEnregistrement(reponse);
            })
            .catch(function (erreur) { afficherErreur(erreur.message); })
            .finally(function () {
                champs.valider.textContent = 'Enregistrer';
                verifierObligatoires();
            });
    }

    function supprimerOperation() {
        if (!operationCourante) return;
        if (!window.confirm('Supprimer définitivement cette opération ?')) return;

        champs.supprimer.disabled = true;
        C.appeler('/operations/' + operationCourante.id, { method: 'DELETE' })
            .then(function () {
                dialogue.close();
                if (surEnregistrement) surEnregistrement(null);
            })
            .catch(function (erreur) { afficherErreur(erreur.message); })
            .finally(function () { champs.supprimer.disabled = false; });
    }

    // Le referentiel est relu apres un changement de profil ou de referentiel :
    // les preferences du compte ont pu bouger entre deux ouvertures.
    function oublierReferentiel() { referentiel = null; }

    window.Operation = { ouvrir: ouvrir, oublierReferentiel: oublierReferentiel };
})();
