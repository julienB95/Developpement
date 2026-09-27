// Page d'une crypto du portefeuille : position, prix moyen, performance et
// graphique du cours sur la période choisie.
(function () {
    'use strict';

    var C = window.Crypto;
    var M = window.Marche;
    var CLE_UNITE = 'crypto.performance.unite';

    var erreurPage = document.getElementById('erreur-page');
    var zoneCrypto = document.getElementById('zone-crypto');
    var zoneGraphique = document.getElementById('zone-graphique');

    var champs = {
        logo: document.getElementById('crypto-logo'),
        nom: document.getElementById('crypto-nom'),
        code: document.getElementById('crypto-code'),
        quantite: document.getElementById('ind-quantite'),
        cours: document.getElementById('ind-cours'),
        variation: document.getElementById('ind-variation'),
        valeur: document.getElementById('ind-valeur'),
        prixMoyen: document.getElementById('ind-prix-moyen'),
        cout: document.getElementById('ind-cout'),
        performance: document.getElementById('ind-performance'),
        releve: document.getElementById('crypto-releve'),
    };

    var graphique = {
        etat: document.getElementById('graphique-etat'),
        zone: document.getElementById('graphique-zone'),
        pied: document.getElementById('graphique-pied'),
        lecture: document.getElementById('graphique-lecture'),
        bornes: document.getElementById('graphique-bornes'),
    };

    var boutonsUnite = Array.prototype.slice.call(document.querySelectorAll('.bascule-unite-choix'));
    var boutonsPeriode = Array.prototype.slice.call(document.querySelectorAll('.onglets-periode .onglet'));

    var position = null;
    var unite = lireUnite();
    var joursCourants = 1;
    var demandeGraphique = 0;

    function afficherErreurPage(message) {
        erreurPage.textContent = message;
        erreurPage.hidden = false;
    }

    // --- Préférence d'unité de la performance -----------------------------
    // Simple confort d'affichage : sans stockage, la page repart en euro.
    function lireUnite() {
        try {
            return window.localStorage.getItem(CLE_UNITE) === 'pourcentage' ? 'pourcentage' : 'devise';
        } catch (e) {
            return 'devise';
        }
    }

    function ecrireUnite(valeur) {
        try {
            window.localStorage.setItem(CLE_UNITE, valeur);
        } catch (e) {
            // Stockage refusé (navigation privée) : le choix vaut pour la page ouverte
            console.warn('Préférence d\'unité non enregistrée :', e.message);
        }
    }

    // --- Mise en forme ----------------------------------------------------
    function signe(texte) {
        return Number(texte) > 0 ? '+' : '';
    }

    function classeSigne(texte) {
        var nombre = Number(texte);
        if (texte === null || texte === undefined || !isFinite(nombre) || nombre === 0) return '';
        return nombre > 0 ? 'variation-hausse' : 'variation-baisse';
    }

    function formaterPourcentage(texte) {
        return signe(texte) + Number(texte).toFixed(2).replace('.', ',') + ' %';
    }

    function rendrePerformance() {
        boutonsUnite.forEach(function (bouton) {
            bouton.setAttribute('aria-pressed', String(bouton.dataset.unite === unite));
        });
        if (!position) return;

        var texte = unite === 'pourcentage' ? position.performance_pourcentage : position.performance;
        champs.performance.className = 'indicateur-valeur ' + classeSigne(position.performance);

        if (texte === null || texte === undefined) {
            champs.performance.textContent = '—';
        } else if (unite === 'pourcentage') {
            champs.performance.textContent = formaterPourcentage(texte);
        } else {
            champs.performance.textContent = signe(texte) + C.formaterMontant(texte, position.devise);
        }
    }

    function rendrePosition(donnees) {
        position = donnees;
        document.title = donnees.libelle + ' (' + donnees.id_crypto + ') — Suivi crypto';

        C.vider(champs.logo);
        champs.logo.appendChild(C.logoCrypto(donnees.id_crypto, 36));
        champs.nom.textContent = donnees.libelle;
        champs.code.textContent = donnees.id_crypto;
        champs.code.hidden = false;

        champs.quantite.textContent = C.formaterQuantite(donnees.quantite) + ' ' + donnees.id_crypto;
        champs.cours.textContent = donnees.cours === null ? '—' : C.formaterMontant(donnees.cours, donnees.devise);
        champs.variation.className = M.classeVariation(donnees.variation_24h);
        champs.variation.textContent = donnees.variation_24h === null ? '' : M.formaterVariation(donnees.variation_24h) + ' sur 24 h';
        champs.valeur.textContent = donnees.valeur === null ? '—' : C.formaterMontant(donnees.valeur, donnees.devise);
        champs.prixMoyen.textContent = donnees.prix_moyen === null ? '—' : C.formaterMontant(donnees.prix_moyen, donnees.devise);
        champs.cout.textContent = 'Coût de la position : ' + C.formaterMontant(donnees.cout_acquisition, donnees.devise);

        rendrePerformance();

        // Le cours est volatil : sa source et son heure sont toujours dites
        var releve = donnees.releve_le && donnees.cours !== null
            ? 'Cours ' + donnees.source + ' du ' + C.formaterDateHeure(donnees.releve_le) + '.'
            : 'Cours indisponible' + (donnees.cours_indisponible ? ' : ' + donnees.cours_indisponible : '') + '.';
        releve += ' Prix moyen calculé au coût moyen pondéré, frais compris ; '
            + (donnees.staking_acquisition === 'valeur_recue'
                ? 'le staking y compte pour sa valeur à la réception.'
                : 'le staking y compte pour un coût nul.');
        champs.releve.textContent = releve;

        zoneCrypto.hidden = false;
    }

    // --- Graphique --------------------------------------------------------
    function choisirPeriode(jours) {
        joursCourants = jours;
        boutonsPeriode.forEach(function (bouton) {
            var actif = Number(bouton.dataset.jours) === jours;
            bouton.classList.toggle('actif', actif);
            bouton.setAttribute('aria-pressed', String(actif));
        });
        tracer();
    }

    function tracer() {
        if (!position) return;

        // Un clic rapide sur plusieurs périodes : seule la dernière réponse compte
        var numero = ++demandeGraphique;
        var jours = joursCourants;

        C.vider(graphique.zone);
        graphique.pied.hidden = true;
        graphique.etat.className = 'aide';
        graphique.etat.textContent = 'Chargement du graphique…';

        if (!position.identifiant_coingecko) {
            graphique.etat.className = 'erreur';
            graphique.etat.textContent = 'Aucun historique de cours pour cette crypto.';
            return;
        }

        C.appeler('/marche/historique/' + encodeURIComponent(position.identifiant_coingecko)
            + '?devise=eur&jours=' + jours)
            .then(function (resultat) {
                if (numero !== demandeGraphique) return;

                var points = resultat.points;
                var hausse = points.length > 1
                    ? Number(points[points.length - 1].prix) >= Number(points[0].prix)
                    : null;

                var trace = M.tracerGraphique(points, resultat.devise, hausse, jours);
                graphique.zone.appendChild(trace.svg);

                graphique.etat.textContent = 'Cours sur ' + M.libellePeriode(jours)
                    + ' · source ' + resultat.source + ' · relevé ' + M.ilYA(resultat.releve_le);
                graphique.bornes.textContent = 'Plus bas ' + C.formaterMontant(trace.mini, resultat.devise)
                    + ' · plus haut ' + C.formaterMontant(trace.maxi, resultat.devise);

                function lire(rang) {
                    var point = points[rang];
                    // Points horaires jusqu'à 90 jours : la lecture donne l'heure ;
                    // points quotidiens sur un an : la date suffit
                    graphique.lecture.textContent = M.repereTemps(point.horodatage,
                        jours <= 1 ? 1 : (jours <= 90 ? 7 : 365))
                        + ' · ' + C.formaterMontant(point.prix, resultat.devise);
                }

                trace.svg.addEventListener('pointermove', function (evenement) {
                    var rang = trace.rangSousPointeur(evenement.clientX);
                    trace.placer(rang);
                    lire(rang);
                });
                trace.svg.addEventListener('pointerleave', function () {
                    trace.masquer();
                    lire(points.length - 1);
                });

                lire(points.length - 1);
                graphique.pied.hidden = false;
            })
            .catch(function (erreur) {
                if (numero !== demandeGraphique) return;
                graphique.etat.className = 'erreur';
                graphique.etat.textContent = erreur.message || 'Graphique momentanément indisponible.';
            });
    }

    // --- Événements -------------------------------------------------------
    boutonsUnite.forEach(function (bouton) {
        bouton.addEventListener('click', function () {
            unite = bouton.dataset.unite;
            ecrireUnite(unite);
            rendrePerformance();
        });
    });

    boutonsPeriode.forEach(function (bouton) {
        bouton.addEventListener('click', function () { choisirPeriode(Number(bouton.dataset.jours)); });
    });

    // --- Chargement -------------------------------------------------------
    var idCrypto = (new URLSearchParams(window.location.search).get('id') || '').trim().toUpperCase();

    C.pageConnectee(function () {
        if (!idCrypto) {
            afficherErreurPage('Aucune crypto indiquée. Revenez à l\'accueil et choisissez-en une.');
            return null;
        }

        return C.appeler('/mon-portefeuille/' + encodeURIComponent(idCrypto))
            .then(function (donnees) {
                rendrePosition(donnees);
                zoneGraphique.hidden = false;
                tracer();
            })
            .catch(function (erreur) {
                afficherErreurPage(erreur.message);
            });
    });
})();
