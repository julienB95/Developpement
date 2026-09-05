// Page des opérations : liste complète, filtres, création, modification, suppression.
(function () {
    'use strict';

    var C = window.Crypto;
    var TAILLE_PAGE = 20;

    var zoneOperations = document.getElementById('zone-operations');
    var zoneDeconnecte = document.getElementById('zone-deconnecte');
    var erreurPage = document.getElementById('erreur-page');

    var contenu = document.getElementById('operations-contenu');
    var pagination = document.getElementById('operations-pagination');
    var position = document.getElementById('operations-position');
    var precedent = document.getElementById('operations-precedent');
    var suivant = document.getElementById('operations-suivant');
    var boutonAjout = document.getElementById('bouton-ajout-operation');
    var resumeFiltres = document.getElementById('resume-filtres');

    var filtreAnnee = document.getElementById('filtre-annee');
    var filtreCrypto = document.getElementById('filtre-crypto');
    var filtreSens = document.getElementById('filtre-sens');
    var reinitialiser = document.getElementById('filtre-reinitialiser');

    var page = 1;

    // --- Outils -----------------------------------------------------------
    function afficherErreurPage(message) {
        erreurPage.textContent = message;
        erreurPage.hidden = false;
    }

    function option(valeur, libelle) {
        var element = document.createElement('option');
        element.value = valeur;
        element.textContent = libelle;
        return element;
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

    function texteMontant(montant) {
        if (montant === null || montant === undefined) return '—';
        var formate = C.formaterMontant(montant, 'EUR');
        return String(montant).charAt(0) === '-' ? formate : '+' + formate;
    }

    function messageContenu(texte) {
        C.vider(contenu);
        var message = document.createElement('p');
        message.className = 'espace-vide';
        message.textContent = texte;
        contenu.appendChild(message);
        pagination.hidden = true;
    }

    // --- Filtres ----------------------------------------------------------
    function requeteFiltres() {
        var parties = ['taille=' + TAILLE_PAGE, 'page=' + page];
        if (filtreAnnee.value) parties.push('annee=' + encodeURIComponent(filtreAnnee.value));
        if (filtreCrypto.value) parties.push('crypto=' + encodeURIComponent(filtreCrypto.value));
        if (filtreSens.value) parties.push('sens=' + encodeURIComponent(filtreSens.value));
        return parties.join('&');
    }

    function chargerFiltres() {
        return Promise.all([
            C.appeler('/operations/annees').catch(function () { return []; }),
            C.appeler('/cryptos?actives=1').catch(function () { return []; }),
        ]).then(function (resultats) {
            C.vider(filtreAnnee);
            filtreAnnee.appendChild(option('', 'Toutes'));
            resultats[0].forEach(function (annee) {
                filtreAnnee.appendChild(option(String(annee), String(annee)));
            });

            C.vider(filtreCrypto);
            filtreCrypto.appendChild(option('', 'Toutes'));
            resultats[1].forEach(function (crypto) {
                filtreCrypto.appendChild(option(crypto.id, crypto.libelle + ' (' + crypto.id + ')'));
            });
        });
    }

    // --- Rendu ------------------------------------------------------------
    function rendre(donnees) {
        resumeFiltres.textContent = donnees.total === 0
            ? 'Aucune opération ne correspond aux filtres.'
            : donnees.total + (donnees.total > 1 ? ' opérations' : ' opération');

        if (!donnees.lignes.length) {
            return messageContenu(donnees.total
                ? 'Aucune opération sur cette page.'
                : 'Utilisez le bouton + pour enregistrer votre première opération.');
        }

        C.vider(contenu);

        var enveloppe = document.createElement('div');
        enveloppe.className = 'tableau-defilant';

        var tableau = document.createElement('table');
        tableau.className = 'tableau tableau-operations';

        var entete = document.createElement('tr');
        var colonnes = [
            { titre: 'Crypto' },
            { titre: 'Date' },
            { titre: 'Sens' },
            { titre: 'Quantité', nombre: true },
            { titre: 'Prix unitaire', nombre: true },
            { titre: 'Frais', nombre: true },
            { titre: 'Montant', nombre: true },
            { titre: 'Plateforme' },
            { titre: '' },
        ];
        colonnes.forEach(function (colonne) {
            var th = document.createElement('th');
            th.scope = 'col';
            th.textContent = colonne.titre;
            if (colonne.nombre) th.className = 'cellule-nombre';
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
            rangee.appendChild(cellule(
                ligne.prix_unitaire === null ? '—' : C.formaterMontant(ligne.prix_unitaire, 'EUR'),
                'cellule-nombre'
            ));
            rangee.appendChild(cellule(C.formaterMontant(ligne.frais, 'EUR'), 'cellule-nombre'));
            rangee.appendChild(cellule(texteMontant(ligne.montant), classeMontant(ligne.montant)));
            rangee.appendChild(cellule(ligne.plateforme || '—'));

            var actions = document.createElement('td');
            actions.className = 'cellule-actions';
            var modifier = document.createElement('button');
            modifier.type = 'button';
            modifier.className = 'bouton bouton-discret bouton-petit';
            modifier.textContent = 'Modifier';
            modifier.addEventListener('click', function () {
                window.Operation.ouvrir({ operation: ligne, surEnregistrement: recharger });
            });
            actions.appendChild(modifier);
            rangee.appendChild(actions);

            corps.appendChild(rangee);
        });
        tableau.appendChild(corps);

        enveloppe.appendChild(tableau);
        contenu.appendChild(enveloppe);

        pagination.hidden = donnees.pages <= 1;
        position.textContent = 'Page ' + donnees.page + ' sur ' + donnees.pages;
        precedent.disabled = donnees.page <= 1;
        suivant.disabled = donnees.page >= donnees.pages;
    }

    function charger() {
        C.appeler('/operations?' + requeteFiltres())
            .then(function (donnees) {
                page = donnees.page;
                rendre(donnees);
            })
            .catch(function (erreur) {
                messageContenu('Opérations indisponibles : ' + erreur.message);
            });
    }

    // Après une écriture, les millésimes disponibles ont pu changer
    function recharger() {
        chargerFiltres().then(charger);
    }

    // --- Branchements -----------------------------------------------------
    [filtreAnnee, filtreCrypto, filtreSens].forEach(function (filtre) {
        filtre.addEventListener('change', function () { page = 1; charger(); });
    });

    reinitialiser.addEventListener('click', function () {
        filtreAnnee.value = '';
        filtreCrypto.value = '';
        filtreSens.value = '';
        page = 1;
        charger();
    });

    precedent.addEventListener('click', function () {
        if (page > 1) { page -= 1; charger(); }
    });
    suivant.addEventListener('click', function () {
        page += 1;
        charger();
    });

    boutonAjout.addEventListener('click', function () {
        window.Operation.ouvrir({ surEnregistrement: recharger });
    });

    // --- Demarrage --------------------------------------------------------
    if (!C.lireJeton()) {
        zoneDeconnecte.hidden = false;
    } else {
        C.appeler('/moi')
            .then(function (compte) {
                C.definirDevise(compte.devise, { enregistrer: false });
                C.afficherCompte(compte, {
                    surDeconnexion: function () { window.location.href = '/'; },
                });
                if (window.Marche) window.Marche.appliquer(true);

                zoneOperations.hidden = false;
                return chargerFiltres().then(charger);
            })
            .catch(function (erreur) {
                if (erreur.code === 401) {
                    C.effacerJeton();
                    zoneDeconnecte.hidden = false;
                    return;
                }
                afficherErreurPage(erreur.message);
            });
    }
})();
