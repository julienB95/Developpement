// Boite de saisie d'une operation, partagee par la page d'accueil et la page
// des operations : creation et modification utilisent exactement le meme formulaire.
(function () {
    'use strict';

    var C = window.Crypto;

    var dialogue = null;
    var champs = {};
    var referentiel = null;
    var operationCourante = null;
    var surEnregistrement = null;
    var sensCourant = 'achat';

    // --- Construction du formulaire ---------------------------------------
    function etiquette(pour, texte) {
        var element = document.createElement('label');
        element.htmlFor = pour;
        element.textContent = texte;
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

        bloc.appendChild(etiquette(identifiant, libelle));
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

        bloc.appendChild(etiquette(identifiant, libelle));
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

        // Sens : deux onglets, comme le dialogue de connexion
        var onglets = document.createElement('div');
        onglets.className = 'onglets';
        onglets.setAttribute('role', 'tablist');

        ['achat', 'vente'].forEach(function (sens) {
            var bouton = document.createElement('button');
            bouton.type = 'button';
            bouton.className = 'onglet';
            bouton.textContent = sens === 'achat' ? 'Achat' : 'Vente';
            bouton.addEventListener('click', function () { choisirSens(sens); });
            champs['onglet_' + sens] = bouton;
            onglets.appendChild(bouton);
        });
        forme.appendChild(onglets);

        forme.appendChild(champListe('id_crypto', 'Crypto'));
        forme.appendChild(champTexte('horodatage', 'Date et heure', 'datetime-local'));
        forme.appendChild(champTexte('quantite', 'Quantité', 'text'));
        forme.appendChild(champTexte('prix_unitaire', 'Prix unitaire en euro', 'text',
            'Le prix réellement payé ou encaissé, pas le cours du marché.'));
        forme.appendChild(champTexte('frais', 'Frais en euro', 'text'));
        forme.appendChild(champListe('plateforme_id', 'Plateforme'));

        var erreur = document.createElement('p');
        erreur.className = 'erreur';
        erreur.setAttribute('role', 'alert');
        erreur.hidden = true;
        forme.appendChild(erreur);
        champs.erreur = erreur;

        var note = document.createElement('p');
        note.className = 'aide note-vente';
        note.hidden = true;
        note.textContent = "À l'enregistrement d'une vente, la valeur moyenne du jour "
            + 'de toutes vos cryptos est relevée et conservée pour la déclaration.';
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

        dialogue.appendChild(forme);
        document.body.appendChild(dialogue);
        champs.forme = forme;
    }

    function choisirSens(sens) {
        sensCourant = sens;
        champs.onglet_achat.classList.toggle('actif', sens === 'achat');
        champs.onglet_vente.classList.toggle('actif', sens === 'vente');
        champs.note.hidden = sens !== 'vente';
    }

    // --- Referentiel ------------------------------------------------------
    function chargerReferentiel() {
        if (referentiel) return Promise.resolve(referentiel);

        return Promise.all([
            C.appeler('/cryptos').catch(function () { return []; }),
            C.appeler('/plateformes').catch(function () { return []; }),
        ]).then(function (resultats) {
            referentiel = { cryptos: resultats[0], plateformes: resultats[1] };

            remplirListe(champs.id_crypto, referentiel.cryptos.map(function (crypto) {
                return { valeur: crypto.id, libelle: crypto.libelle + ' (' + crypto.id + ')' };
            }));
            remplirListe(champs.plateforme_id, referentiel.plateformes.map(function (plateforme) {
                return { valeur: plateforme.id, libelle: plateforme.libelle };
            }), 'Non précisée');

            return referentiel;
        });
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
            champs.titre.textContent = modification ? 'Modifier une opération' : 'Nouvelle opération';
            champs.supprimer.hidden = !modification;

            choisirSens(modification ? operationCourante.sens : 'achat');
            champs.id_crypto.value = modification ? operationCourante.id_crypto : (referentiel.cryptos[0] || {}).id || '';
            champs.horodatage.value = versChampLocal(modification ? operationCourante.horodatage : null);
            champs.quantite.value = modification ? versChampDecimal(operationCourante.quantite) : '';
            champs.prix_unitaire.value = modification ? versChampDecimal(operationCourante.prix_unitaire) : '';
            champs.frais.value = modification ? versChampDecimal(operationCourante.frais) : '';
            champs.plateforme_id.value = modification ? (operationCourante.plateforme_id || '') : '';

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
        var horodatage = versIso(champs.horodatage.value);

        if (!/^\d+(\.\d+)?$/.test(quantite) || Number(quantite) <= 0) {
            return afficherErreur('Renseignez une quantité décimale strictement positive.');
        }
        if (!horodatage) {
            return afficherErreur("Renseignez la date et l'heure de l'opération.");
        }

        var corps = {
            sens: sensCourant,
            id_crypto: champs.id_crypto.value,
            quantite: quantite,
            horodatage: horodatage,
            plateforme_id: champs.plateforme_id.value || null,
        };

        var prix = nettoyerDecimal(champs.prix_unitaire.value);
        if (prix) {
            if (!/^\d+(\.\d+)?$/.test(prix)) return afficherErreur('Prix unitaire : nombre décimal attendu.');
            corps.prix_unitaire = prix;
        }

        var frais = nettoyerDecimal(champs.frais.value);
        if (frais) {
            if (!/^\d+(\.\d+)?$/.test(frais)) return afficherErreur('Frais : nombre décimal attendu.');
            corps.frais = frais;
        }

        champs.valider.disabled = true;
        champs.valider.textContent = sensCourant === 'vente' ? 'Relevé des valeurs…' : 'Enregistrement…';

        var chemin = operationCourante ? '/operations/' + operationCourante.id : '/operations';
        var methode = operationCourante ? 'PUT' : 'POST';

        C.appeler(chemin, { method: methode, corps: corps })
            .then(function (reponse) {
                dialogue.close();
                if (surEnregistrement) surEnregistrement(reponse);
            })
            .catch(function (erreur) { afficherErreur(erreur.message); })
            .finally(function () {
                champs.valider.disabled = false;
                champs.valider.textContent = 'Enregistrer';
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

    window.Operation = { ouvrir: ouvrir };
})();
