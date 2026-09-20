// Page d'importation d'un fichier : sélection en haut, deux boutons, et
// rapport ligne par ligne en regard du tableur.
//
// La vérification et le traitement empruntent la même route, au drapeau
// « simuler » près : le rapport rendu avant import est donc exactement celui
// que l'import produira, et non le résultat d'un second contrôle écrit à côté
// qui finirait par diverger.
//
// Le fichier n'est jamais analysé ici : le navigateur en envoie les octets, et
// l'API seule sait s'il s'agit d'un classeur ou d'un CSV, et ce que ses lignes
// veulent dire. Le rapport reprend chaque ligne, y compris celles qui passent,
// pour que corriger le fichier et relancer soit une lecture de haut en bas
// plutôt qu'un jeu de piste.
(function () {
    'use strict';

    var C = window.Crypto;

    var champFichier = document.getElementById('fichier-import');
    var boutonVerification = document.getElementById('bouton-verification');
    var boutonTraitement = document.getElementById('bouton-traitement');
    var sectionRapport = document.getElementById('section-rapport');
    var titreRapport = document.getElementById('titre-rapport');
    var zoneRapport = document.getElementById('rapport');

    // Au-delà, la liste des problèmes cesse d'être un résumé
    var PROBLEMES_AFFICHES = 12;

    var STATUTS = {
        importee: { libelle: 'Importée', classe: 'etiquette-importee' },
        valide: { libelle: 'Valide', classe: 'etiquette-importee' },
        doublon: { libelle: 'Doublon', classe: 'etiquette-doublon' },
        rejetee: { libelle: 'Rejetée', classe: 'etiquette-rejetee' },
    };

    function messageRapport(texte, classe) {
        sectionRapport.hidden = false;
        C.vider(zoneRapport);
        var message = document.createElement('p');
        message.className = classe || 'aide';
        message.textContent = texte;
        zoneRapport.appendChild(message);
    }

    // --- Lecture du fichier -----------------------------------------------
    // Les octets bruts sont envoyés tels quels : un classeur est binaire, et
    // même pour un CSV c'est le serveur qui décide de l'encodage, sur des
    // octets qu'aucune lecture en texte n'a déjà abîmés.
    function lireFichier(fichier) {
        return new Promise(function (resoudre, rejeter) {
            var lecteur = new FileReader();
            lecteur.onload = function () { resoudre(enBase64(lecteur.result)); };
            // Le fichier a changé sur le disque depuis sa sélection : le
            // navigateur refuse de le relire, et il faut le redésigner.
            lecteur.onerror = function () {
                rejeter(new Error('Fichier illisible. S’il vient d’être modifié, '
                    + 'sélectionnez-le à nouveau puis relancez le traitement.'));
            };
            lecteur.readAsArrayBuffer(fichier);
        });
    }

    // Par tranches : passer des centaines de milliers d'octets d'un seul coup
    // à String.fromCharCode dépasse la pile d'appels.
    function enBase64(tampon) {
        var octets = new Uint8Array(tampon);
        var morceaux = [];
        for (var rang = 0; rang < octets.length; rang += 8192) {
            morceaux.push(String.fromCharCode.apply(null, octets.subarray(rang, rang + 8192)));
        }
        return btoa(morceaux.join(''));
    }

    // --- Rapport ------------------------------------------------------------
    function chiffre(valeur, libelle, classe) {
        var bloc = document.createElement('div');
        bloc.className = 'rapport-chiffre';

        var nombre = document.createElement('span');
        nombre.className = 'rapport-nombre ' + (classe || '');
        nombre.textContent = valeur;

        var texte = document.createElement('span');
        texte.className = 'rapport-libelle';
        texte.textContent = libelle;

        bloc.appendChild(nombre);
        bloc.appendChild(texte);
        return bloc;
    }

    // Ce que l'API a compris de la ligne : c'est là que se voient une date mal
    // lue ou une virgule décimale prise pour un séparateur.
    function resumeOperation(operation) {
        var parties = [
            operation.horodatage,
            C.libelleType(operation.type),
            C.formaterQuantite(operation.quantite) + ' ' + operation.id_crypto,
        ];
        if (operation.prix_unitaire !== null) {
            parties.push('à ' + C.formaterMontant(operation.prix_unitaire, 'EUR'));
        }
        if (Number(operation.frais) > 0) {
            parties.push('frais ' + C.formaterMontant(operation.frais, 'EUR'));
        }
        if (operation.plateforme) parties.push(operation.plateforme);
        return parties.join(' · ');
    }

    function rangeeLigne(ligne) {
        var rangee = document.createElement('tr');
        var statut = STATUTS[ligne.statut] || STATUTS.rejetee;

        var numero = document.createElement('td');
        numero.className = 'cellule-nombre';
        numero.textContent = ligne.ligne;
        rangee.appendChild(numero);

        var cellStatut = document.createElement('td');
        var etiquette = document.createElement('span');
        etiquette.className = 'etiquette-sens ' + statut.classe;
        etiquette.textContent = statut.libelle;
        cellStatut.appendChild(etiquette);
        rangee.appendChild(cellStatut);

        var lue = document.createElement('td');
        if (ligne.operation) {
            lue.textContent = resumeOperation(ligne.operation);
        } else {
            // Rien n'a pu être lu : le contenu brut est la seule accroche pour
            // retrouver la ligne dans le tableur.
            var brut = document.createElement('span');
            brut.className = 'erreur-contenu';
            brut.textContent = ligne.contenu;
            lue.appendChild(brut);
        }
        rangee.appendChild(lue);

        var observation = document.createElement('td');
        if (ligne.motifs.length) {
            observation.className = ligne.statut === 'rejetee' ? 'observation-erreur' : '';
            observation.textContent = ligne.motifs.join(' ; ');
        } else {
            observation.textContent = '—';
        }
        rangee.appendChild(observation);

        return rangee;
    }

    // Sur un fichier long, la lecture ligne à ligne ne dit pas ce qui cloche :
    // les mêmes motifs y reviennent par dizaines. Regroupés et comptés, ils
    // rendent le fichier corrigeable d'un coup plutôt que ligne par ligne.
    function syntheseProblemes(lignes) {
        var comptes = Object.create(null);
        lignes.forEach(function (ligne) {
            ligne.motifs.forEach(function (motif) {
                comptes[motif] = (comptes[motif] || 0) + 1;
            });
        });

        var motifs = Object.keys(comptes).sort(function (a, b) {
            return comptes[b] - comptes[a] || a.localeCompare(b, 'fr');
        });
        if (!motifs.length) return null;

        var bloc = document.createElement('div');
        bloc.className = 'rapport-problemes';

        var titre = document.createElement('p');
        titre.className = 'rapport-problemes-titre';
        titre.textContent = motifs.length > 1
            ? motifs.length + ' problèmes relevés'
            : 'Problème relevé';
        bloc.appendChild(titre);

        var liste = document.createElement('ul');
        liste.className = 'liste-problemes';
        motifs.slice(0, PROBLEMES_AFFICHES).forEach(function (motif) {
            var element = document.createElement('li');

            var compte = document.createElement('span');
            compte.className = 'probleme-compte';
            compte.textContent = comptes[motif];
            element.appendChild(compte);

            var texte = document.createElement('span');
            texte.textContent = motif;
            element.appendChild(texte);

            liste.appendChild(element);
        });
        bloc.appendChild(liste);

        if (motifs.length > PROBLEMES_AFFICHES) {
            var reste = document.createElement('p');
            reste.className = 'aide';
            reste.textContent = 'Et ' + (motifs.length - PROBLEMES_AFFICHES)
                + ' autre(s) motif(s), détaillés dans le tableau ci-dessous.';
            bloc.appendChild(reste);
        }

        return bloc;
    }

    function tableauLignes(lignes) {
        var enveloppe = document.createElement('div');
        enveloppe.className = 'tableau-defilant';

        var tableau = document.createElement('table');
        tableau.className = 'tableau tableau-rapport';

        var entete = document.createElement('tr');
        ['Ligne', 'Statut', 'Opération lue', 'Observation'].forEach(function (titre, rang) {
            var th = document.createElement('th');
            th.scope = 'col';
            th.textContent = titre;
            if (rang === 0) th.className = 'cellule-nombre';
            entete.appendChild(th);
        });
        var thead = document.createElement('thead');
        thead.appendChild(entete);
        tableau.appendChild(thead);

        var corps = document.createElement('tbody');
        lignes.forEach(function (ligne) { corps.appendChild(rangeeLigne(ligne)); });
        tableau.appendChild(corps);

        enveloppe.appendChild(tableau);
        return enveloppe;
    }

    function rendreRapport(rapport, nomFichier) {
        sectionRapport.hidden = false;
        titreRapport.textContent = rapport.simulation
            ? 'Rapport de vérification' : 'Rapport de traitement';
        C.vider(zoneRapport);

        var origine = document.createElement('p');
        origine.className = 'aide';
        origine.textContent = nomFichier
            + (rapport.feuille && rapport.feuille !== 'CSV' ? ' · feuille ' + rapport.feuille : '')
            + ' — ' + rapport.total_lignes
            + (rapport.total_lignes > 1 ? ' lignes lues' : ' ligne lue');
        zoneRapport.appendChild(origine);

        var chiffres = document.createElement('div');
        chiffres.className = 'rapport-chiffres';
        // Une vérification n'importe rien : ce qu'elle a à annoncer, c'est ce
        // que le traitement enregistrerait.
        chiffres.appendChild(rapport.simulation
            ? chiffre(rapport.valides, 'à importer', 'rapport-ok')
            : chiffre(rapport.importees, 'importées', 'rapport-ok'));
        chiffres.appendChild(chiffre(rapport.doublons, 'déjà présentes',
            rapport.doublons ? 'rapport-attente' : ''));
        chiffres.appendChild(chiffre(rapport.rejetees, 'rejetées',
            rapport.rejetees ? 'rapport-ko' : ''));
        zoneRapport.appendChild(chiffres);

        if (rapport.colonnes_ignorees.length) {
            var ignorees = document.createElement('p');
            ignorees.className = 'aide';
            ignorees.textContent = 'Colonnes ignorées : ' + rapport.colonnes_ignorees.join(', ') + '.';
            zoneRapport.appendChild(ignorees);
        }

        var problemes = syntheseProblemes(rapport.lignes);
        if (problemes) zoneRapport.appendChild(problemes);

        if (rapport.lignes.length) zoneRapport.appendChild(tableauLignes(rapport.lignes));

        var suite = document.createElement('p');
        suite.className = 'aide';

        if (rapport.rejetees) {
            suite.textContent = rapport.simulation
                ? 'Corrigez les lignes rejetées dans le fichier, sélectionnez-le à nouveau '
                    + 'et relancez la vérification. Lancer le traitement en l’état '
                    + 'importerait les ' + rapport.valides + ' ligne(s) valides et laisserait '
                    + 'les autres de côté.'
                : 'Corrigez les lignes rejetées dans le fichier, '
                    + 'sélectionnez-le à nouveau et relancez le traitement : '
                    + 'les lignes déjà importées seront reconnues et ignorées.';
            zoneRapport.appendChild(suite);
        } else if (rapport.simulation) {
            suite.textContent = 'Aucune anomalie : le fichier peut être traité.'
                + (rapport.doublons
                    ? ' Les ' + rapport.doublons + ' ligne(s) déjà présentes seront ignorées.'
                    : '');
            zoneRapport.appendChild(suite);
        }

        if (rapport.jours_de_vente.length) {
            var valeurs = document.createElement('p');
            valeurs.className = 'aide';
            valeurs.textContent = 'Valeurs de portefeuille relevées pour '
                + rapport.jours_de_vente.join(', ') + '.';
            zoneRapport.appendChild(valeurs);
        }
    }

    // --- Vérification et traitement -----------------------------------------
    function activerBoutons(actifs) {
        boutonVerification.disabled = !actifs;
        boutonTraitement.disabled = !actifs;
    }

    // simuler : le fichier est contrôlé et le rapport rendu sans rien écrire.
    function envoyer(simuler) {
        var fichier = champFichier.files && champFichier.files[0];
        if (!fichier) return;

        activerBoutons(false);
        messageRapport(simuler ? 'Vérification en cours…' : 'Traitement en cours…');

        lireFichier(fichier)
            .then(function (base64) {
                return C.appeler('/importation', {
                    method: 'POST',
                    corps: { fichier: base64, simuler: simuler },
                });
            })
            .then(function (rapport) { rendreRapport(rapport, fichier.name); })
            .catch(function (erreur) { messageRapport(erreur.message, 'erreur'); })
            .finally(function () {
                activerBoutons(Boolean(champFichier.files && champFichier.files[0]));
            });
    }

    champFichier.addEventListener('change', function () {
        activerBoutons(Boolean(champFichier.files && champFichier.files[0]));
        sectionRapport.hidden = true;
    });

    boutonVerification.addEventListener('click', function () { envoyer(true); });
    boutonTraitement.addEventListener('click', function () { envoyer(false); });

    C.pageConnectee(function () {
        document.getElementById('zone-fichier').hidden = false;
    });
})();
