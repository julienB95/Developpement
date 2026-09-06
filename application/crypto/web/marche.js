// Cours et actualites : blocs defilants de la page quand personne n'est connecte,
// bandeau de cours dans l'en-tete a cote du bloc utilisateur quand on l'est.
(function () {
    'use strict';

    var C = window.Crypto;
    var RAFRAICHISSEMENT = 2 * 60 * 1000;
    var NOMBRE_ACTUS = 12;

    var donnees = { cours: null, actus: null };
    var minuterie = null;
    var defilements = null;
    var estConnecte = false;

    // --- Mise en forme ----------------------------------------------------
    var formaterPrix = C.formaterMontant;

    function formaterVariation(valeur) {
        if (valeur === null || valeur === undefined) return '—';
        return (valeur > 0 ? '+' : '') + valeur.toFixed(2).replace('.', ',') + ' %';
    }

    function classeVariation(valeur) {
        if (valeur === null || valeur === undefined) return 'variation';
        if (valeur > 0) return 'variation variation-hausse';
        if (valeur < 0) return 'variation variation-baisse';
        return 'variation';
    }

    function ilYA(iso) {
        if (!iso) return '';
        var minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
        if (isNaN(minutes) || minutes < 0) return '';
        if (minutes < 1) return "à l'instant";
        if (minutes < 60) return 'il y a ' + minutes + ' min';
        var heures = Math.round(minutes / 60);
        if (heures < 24) return 'il y a ' + heures + ' h';
        var jours = Math.round(heures / 24);
        return 'il y a ' + jours + (jours > 1 ? ' jours' : ' jour');
    }

    // --- Defilement horizontal --------------------------------------------
    // Les fleches font avancer la piste d'un ecran complet de cartes.
    function brancherDefilement(idPiste, idPrecedent, idSuivant) {
        var piste = document.getElementById(idPiste);
        var precedent = document.getElementById(idPrecedent);
        var suivant = document.getElementById(idSuivant);
        if (!piste || !precedent || !suivant) return function () { /* piste absente de la page */ };

        function pas() {
            var premiere = piste.firstElementChild;
            if (!premiere) return piste.clientWidth;

            var ecart = 0;
            if (piste.children.length > 1) {
                ecart = piste.children[1].getBoundingClientRect().left
                    - piste.children[0].getBoundingClientRect().right;
            }

            var largeur = premiere.getBoundingClientRect().width + Math.max(0, ecart);
            if (largeur <= 0) return piste.clientWidth;

            var visibles = Math.max(1, Math.floor(piste.clientWidth / largeur));
            return largeur * visibles;
        }

        function actualiser() {
            var debordement = piste.scrollWidth - piste.clientWidth;
            var defilable = debordement > 2;
            precedent.disabled = !defilable || piste.scrollLeft <= 1;
            suivant.disabled = !defilable || piste.scrollLeft >= debordement - 1;
        }

        precedent.addEventListener('click', function () {
            piste.scrollBy({ left: -pas(), behavior: 'smooth' });
        });
        suivant.addEventListener('click', function () {
            piste.scrollBy({ left: pas(), behavior: 'smooth' });
        });
        piste.addEventListener('scroll', actualiser);
        window.addEventListener('resize', actualiser);

        return actualiser;
    }

    function preparerDefilements() {
        if (defilements) return defilements;
        defilements = {
            cours: brancherDefilement('piste-cours', 'marche-precedent', 'marche-suivant'),
            actus: brancherDefilement('piste-actus', 'actus-precedent', 'actus-suivant'),
        };
        return defilements;
    }

    // --- Rendu ------------------------------------------------------------
    function carteCours(actif, devise) {
        // La carte entiere est un bouton : elle ouvre le graphique du cours.
        // Un <button> plutot qu'un <article> cliquable, pour le clavier et le focus.
        var carte = document.createElement('button');
        carte.type = 'button';
        carte.className = 'carte-cours';
        carte.title = "Voir l'évolution du cours de " + actif.nom + ' sur 24 heures';
        carte.addEventListener('click', function () { ouvrirGraphique(actif, devise); });

        var haut = document.createElement('span');
        haut.className = 'carte-cours-haut';

        // Le logo est servi par l'API a partir du symbole, qui est aussi
        // l'identifiant de la crypto dans le referentiel.
        var identite = document.createElement('span');
        identite.className = 'carte-identite';
        identite.appendChild(C.logoCrypto(actif.symbole, 22));

        var symbole = document.createElement('span');
        symbole.className = 'carte-symbole';
        symbole.textContent = actif.symbole;
        identite.appendChild(symbole);

        var variation = document.createElement('span');
        variation.className = classeVariation(actif.variation_24h);
        variation.textContent = formaterVariation(actif.variation_24h);

        haut.appendChild(identite);
        haut.appendChild(variation);

        var nom = document.createElement('span');
        nom.className = 'carte-nom';
        nom.textContent = actif.nom;

        var prix = document.createElement('span');
        prix.className = 'carte-prix';
        prix.textContent = formaterPrix(actif.prix, devise);

        carte.appendChild(haut);
        carte.appendChild(nom);
        carte.appendChild(prix);
        return carte;
    }

    function carteActualite(article) {
        var carte = document.createElement('article');
        carte.className = 'carte-actu';

        var lien = document.createElement('a');
        lien.className = 'carte-actu-titre';
        lien.href = article.lien;
        lien.target = '_blank';
        lien.rel = 'noopener noreferrer';
        lien.textContent = article.titre;

        var meta = document.createElement('p');
        meta.className = 'actu-meta';
        var age = ilYA(article.publie_le);
        meta.textContent = article.source + (age ? ' · ' + age : '');

        carte.appendChild(lien);
        carte.appendChild(meta);
        return carte;
    }

    function messageVide(texte) {
        var element = document.createElement('p');
        element.className = 'piste-vide';
        element.textContent = texte;
        return element;
    }

    function rendreSections() {
        var pisteCours = document.getElementById('piste-cours');
        var pisteActus = document.getElementById('piste-actus');
        var horodatage = document.getElementById('marche-horodatage');
        if (!pisteCours || !pisteActus) return;

        var boutons = preparerDefilements();

        C.vider(pisteCours);
        if (donnees.cours) {
            donnees.cours.actifs.forEach(function (actif) {
                pisteCours.appendChild(carteCours(actif, donnees.cours.devise));
            });
            if (horodatage) {
                horodatage.textContent = 'Source ' + donnees.cours.source
                    + ' · relevé ' + ilYA(donnees.cours.releve_le);
            }
        } else {
            pisteCours.appendChild(messageVide('Cours momentanément indisponibles.'));
            if (horodatage) horodatage.textContent = '';
        }

        C.vider(pisteActus);
        if (donnees.actus) {
            donnees.actus.articles.forEach(function (article) {
                pisteActus.appendChild(carteActualite(article));
            });
        } else {
            pisteActus.appendChild(messageVide('Actualités momentanément indisponibles.'));
        }

        boutons.cours();
        boutons.actus();
    }

    // --- Bandeau de l'en-tete ---------------------------------------------
    // Le bloc des actualites est un bouton : c'est lui, en entier, qui ouvre la
    // boite. Un <button> plutot qu'un <div> cliquable, pour le clavier et le focus.
    function blocCliquable(intitule, action) {
        var bloc = document.createElement('button');
        bloc.type = 'button';
        bloc.className = 'encart-bloc';
        bloc.title = intitule;
        bloc.setAttribute('aria-label', intitule);
        bloc.addEventListener('click', action);
        return bloc;
    }

    // Boite construite a la demande et retiree a la fermeture : elle n'a rien
    // a conserver entre deux ouvertures, son contenu vient du dernier releve.
    function creerDialogue(titre, classe) {
        var boite = document.createElement('dialog');
        boite.className = 'dialogue ' + (classe || '');

        var forme = document.createElement('form');
        forme.method = 'dialog';
        forme.className = 'dialogue-fermer-forme';
        var fermer = document.createElement('button');
        fermer.className = 'dialogue-fermer';
        fermer.value = 'fermer';
        fermer.setAttribute('aria-label', 'Fermer');
        fermer.textContent = '×';
        forme.appendChild(fermer);
        boite.appendChild(forme);

        var entete = document.createElement('h2');
        entete.textContent = titre;
        boite.appendChild(entete);

        document.body.appendChild(boite);
        C.fermerAuClicExterieur(boite);
        boite.addEventListener('close', function () { boite.remove(); });

        return boite;
    }

    function ouvrirDialogue(boite) {
        if (typeof boite.showModal === 'function') boite.showModal();
        else boite.setAttribute('open', '');
    }

    function ouvrirTousLesCours() {
        if (!donnees.cours) return;

        var boite = creerDialogue('Cours', 'dialogue-large');

        var horodatage = document.createElement('p');
        horodatage.className = 'aide';
        horodatage.textContent = 'Source ' + donnees.cours.source
            + ' · relevé ' + ilYA(donnees.cours.releve_le);
        boite.appendChild(horodatage);

        var grille = document.createElement('div');
        grille.className = 'grille-cours-popup';
        donnees.cours.actifs.forEach(function (actif) {
            grille.appendChild(carteCours(actif, donnees.cours.devise));
        });
        boite.appendChild(grille);

        ouvrirDialogue(boite);
    }

    function ouvrirToutesLesActus() {
        if (!donnees.actus) return;

        var boite = creerDialogue('Actualités', 'dialogue-large');

        var liste = document.createElement('ul');
        liste.className = 'liste-actus-popup';

        donnees.actus.articles.forEach(function (article) {
            var item = document.createElement('li');

            var lien = document.createElement('a');
            lien.href = article.lien;
            lien.target = '_blank';
            lien.rel = 'noopener noreferrer';
            lien.textContent = article.titre;

            var meta = document.createElement('p');
            meta.className = 'actu-meta';
            var age = ilYA(article.publie_le);
            meta.textContent = article.source + (age ? ' · ' + age : '');

            item.appendChild(lien);
            item.appendChild(meta);
            liste.appendChild(item);
        });

        boite.appendChild(liste);
        ouvrirDialogue(boite);
    }

    // --- Graphique d'un cours sur 24 heures --------------------------------
    // Trace dessine a la main en SVG : aucune bibliotheque n'est chargee, et le
    // navigateur ne contacte jamais la source, c'est l'API qui la relaie.
    var SVG = 'http://www.w3.org/2000/svg';
    var CADRE = { largeur: 720, hauteur: 260, haut: 16, droite: 16, bas: 28, gauche: 74 };
    var compteurDegrade = 0;
    var formateurHeure = null;

    function heureParis(iso) {
        var date = new Date(iso);
        if (isNaN(date.getTime())) return '';

        if (!formateurHeure) {
            var options = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
            try {
                options.timeZone = 'Europe/Paris';
                formateurHeure = new Intl.DateTimeFormat('fr-FR', options);
            } catch (e) {
                // Fuseau inconnu du navigateur : repli sur l'heure locale du poste
                delete options.timeZone;
                formateurHeure = new Intl.DateTimeFormat('fr-FR', options);
            }
        }
        return formateurHeure.format(date);
    }

    function baliseSvg(nom, attributs) {
        var element = document.createElementNS(SVG, nom);
        Object.keys(attributs || {}).forEach(function (cle) {
            element.setAttribute(cle, attributs[cle]);
        });
        return element;
    }

    // hausse : true, false, ou null quand la variation n'est pas connue.
    // Renvoie le trace et de quoi y promener le curseur de lecture.
    function tracerGraphique(points, devise, hausse) {
        var valeurs = points.map(function (point) { return Number(point.prix); });
        var mini = valeurs.reduce(function (a, b) { return b < a ? b : a; }, valeurs[0]);
        var maxi = valeurs.reduce(function (a, b) { return b > a ? b : a; }, valeurs[0]);

        // Une marge au-dessus et au-dessous evite que le trace colle aux bords ;
        // une journee parfaitement plate garde malgre tout un trait lisible.
        var amplitude = maxi - mini;
        var respiration = amplitude ? amplitude * 0.12 : (Math.abs(maxi) * 0.01 || 1);
        var bas = mini - respiration;
        var haut = maxi + respiration;

        var largeurUtile = CADRE.largeur - CADRE.gauche - CADRE.droite;
        var hauteurUtile = CADRE.hauteur - CADRE.haut - CADRE.bas;
        var basAire = CADRE.haut + hauteurUtile;

        function abscisse(rang) {
            if (valeurs.length < 2) return CADRE.gauche + largeurUtile / 2;
            return CADRE.gauche + (largeurUtile * rang) / (valeurs.length - 1);
        }
        function ordonnee(valeur) {
            return CADRE.haut + (hauteurUtile * (haut - valeur)) / (haut - bas);
        }

        var teinte = hausse === null ? 'neutre' : (hausse ? 'hausse' : 'baisse');
        var svg = baliseSvg('svg', {
            viewBox: '0 0 ' + CADRE.largeur + ' ' + CADRE.hauteur,
            class: 'graphique graphique-' + teinte,
            role: 'img',
            'aria-label': 'Évolution du cours sur les 24 dernières heures, entre '
                + formaterPrix(mini, devise) + ' et ' + formaterPrix(maxi, devise),
        });

        // Echelle des prix : le plus bas, le milieu et le plus haut suffisent
        var niveaux = amplitude ? [maxi, (maxi + mini) / 2, mini] : [maxi];
        niveaux.forEach(function (niveau) {
            var y = ordonnee(niveau);
            svg.appendChild(baliseSvg('line', {
                class: 'graphique-grille',
                x1: CADRE.gauche, y1: y, x2: CADRE.largeur - CADRE.droite, y2: y,
            }));

            var libelle = baliseSvg('text', {
                class: 'graphique-echelle',
                x: CADRE.gauche - 10, y: y + 4, 'text-anchor': 'end',
            });
            libelle.textContent = formaterPrix(niveau, devise);
            svg.appendChild(libelle);
        });

        var chemin = valeurs.map(function (valeur, rang) {
            return (rang ? 'L' : 'M') + abscisse(rang).toFixed(2) + ' ' + ordonnee(valeur).toFixed(2);
        }).join(' ');

        // Un degrade par trace : plusieurs graphiques peuvent coexister a l'ecran
        var idDegrade = 'degrade-cours-' + (++compteurDegrade);
        var defs = baliseSvg('defs', {});
        var degrade = baliseSvg('linearGradient', { id: idDegrade, x1: '0', y1: '0', x2: '0', y2: '1' });
        degrade.appendChild(baliseSvg('stop', { offset: '0', 'stop-color': 'currentColor', 'stop-opacity': '0.30' }));
        degrade.appendChild(baliseSvg('stop', { offset: '1', 'stop-color': 'currentColor', 'stop-opacity': '0' }));
        defs.appendChild(degrade);
        svg.appendChild(defs);

        svg.appendChild(baliseSvg('path', {
            class: 'graphique-aire',
            fill: 'url(#' + idDegrade + ')',
            d: chemin
                + ' L' + abscisse(valeurs.length - 1).toFixed(2) + ' ' + basAire
                + ' L' + abscisse(0).toFixed(2) + ' ' + basAire + ' Z',
        }));
        svg.appendChild(baliseSvg('path', { class: 'graphique-trait', d: chemin }));

        // Debut, milieu et fin de la fenetre : trois reperes d'heure suffisent
        var reperes = [];
        [0, Math.floor((points.length - 1) / 2), points.length - 1].forEach(function (rang) {
            if (reperes.indexOf(rang) === -1) reperes.push(rang);
        });
        reperes.forEach(function (rang) {
            var ancrage = 'middle';
            if (reperes.length > 1) {
                if (rang === 0) ancrage = 'start';
                else if (rang === points.length - 1) ancrage = 'end';
            }

            var libelle = baliseSvg('text', {
                class: 'graphique-heure',
                x: abscisse(rang), y: CADRE.hauteur - 8, 'text-anchor': ancrage,
            });
            libelle.textContent = heureParis(points[rang].horodatage);
            svg.appendChild(libelle);
        });

        // Curseur de lecture : masque tant que le pointeur n'est pas sur le trace
        var curseur = baliseSvg('g', { visibility: 'hidden' });
        var repere = baliseSvg('line', {
            class: 'graphique-repere', x1: 0, x2: 0, y1: CADRE.haut, y2: basAire,
        });
        var pastille = baliseSvg('circle', { class: 'graphique-pastille', r: 4.5, cx: 0, cy: 0 });
        curseur.appendChild(repere);
        curseur.appendChild(pastille);
        svg.appendChild(curseur);

        function placer(rang) {
            var x = abscisse(rang);
            var y = ordonnee(valeurs[rang]);
            repere.setAttribute('x1', x);
            repere.setAttribute('x2', x);
            pastille.setAttribute('cx', x);
            pastille.setAttribute('cy', y);
            curseur.setAttribute('visibility', 'visible');
        }

        function masquer() {
            curseur.setAttribute('visibility', 'hidden');
        }

        // Le SVG est etire par la feuille de style : l'abscisse du pointeur est
        // ramenee au repere du trace avant d'y chercher le point le plus proche.
        function rangSousPointeur(positionX) {
            var cadre = svg.getBoundingClientRect();
            if (!cadre.width || valeurs.length < 2) return 0;
            var dansLeTrace = ((positionX - cadre.left) / cadre.width) * CADRE.largeur;
            var rang = Math.round(((dansLeTrace - CADRE.gauche) / largeurUtile) * (valeurs.length - 1));
            return Math.min(valeurs.length - 1, Math.max(0, rang));
        }

        return {
            svg: svg,
            mini: mini,
            maxi: maxi,
            placer: placer,
            masquer: masquer,
            rangSousPointeur: rangSousPointeur,
        };
    }

    // Boite ouverte au clic sur une carte de cours : le trace des 24 dernieres
    // heures, demande a l'API au moment de l'ouverture.
    function ouvrirGraphique(actif, devise) {
        var boite = creerDialogue(actif.nom, 'dialogue-large dialogue-graphique');

        var entete = document.createElement('div');
        entete.className = 'graphique-entete';

        var identite = document.createElement('span');
        identite.className = 'carte-identite';
        identite.appendChild(C.logoCrypto(actif.symbole, 26));

        var symbole = document.createElement('span');
        symbole.className = 'carte-symbole';
        symbole.textContent = actif.symbole;
        identite.appendChild(symbole);

        var prix = document.createElement('span');
        prix.className = 'graphique-prix';
        prix.textContent = formaterPrix(actif.prix, devise);

        var variation = document.createElement('span');
        variation.className = classeVariation(actif.variation_24h);
        variation.textContent = formaterVariation(actif.variation_24h);

        entete.appendChild(identite);
        entete.appendChild(prix);
        entete.appendChild(variation);
        boite.appendChild(entete);

        var etat = document.createElement('p');
        etat.className = 'aide';
        etat.textContent = 'Chargement du graphique…';
        boite.appendChild(etat);

        var zone = document.createElement('div');
        zone.className = 'graphique-zone';
        boite.appendChild(zone);

        var pied = document.createElement('div');
        pied.className = 'graphique-pied';

        var lecture = document.createElement('p');
        lecture.className = 'graphique-lecture';

        var bornes = document.createElement('p');
        bornes.className = 'graphique-bornes';

        pied.appendChild(lecture);
        pied.appendChild(bornes);

        ouvrirDialogue(boite);

        C.appeler('/marche/historique/' + encodeURIComponent(actif.id)
            + '?devise=' + devise.toLowerCase())
            .then(function (resultat) {
                // La boite a pu etre fermee pendant l'attente : plus rien a remplir
                if (!boite.isConnected) return;

                // La couleur suit la variation affichee juste au-dessus ; a defaut,
                // c'est le trace lui-meme qui tranche entre hausse et baisse.
                var hausse;
                if (actif.variation_24h !== null && actif.variation_24h !== undefined) {
                    hausse = actif.variation_24h >= 0;
                } else if (resultat.points.length > 1) {
                    hausse = Number(resultat.points[resultat.points.length - 1].prix)
                        >= Number(resultat.points[0].prix);
                } else {
                    hausse = null;
                }

                var trace = tracerGraphique(resultat.points, resultat.devise, hausse);
                zone.appendChild(trace.svg);

                etat.textContent = 'Cours des 24 dernières heures · source ' + resultat.source
                    + ' · relevé ' + ilYA(resultat.releve_le);

                bornes.textContent = 'Plus bas ' + formaterPrix(trace.mini, resultat.devise)
                    + ' · plus haut ' + formaterPrix(trace.maxi, resultat.devise);

                function lire(rang) {
                    var point = resultat.points[rang];
                    lecture.textContent = heureParis(point.horodatage) + ' · '
                        + formaterPrix(point.prix, resultat.devise);
                }

                trace.svg.addEventListener('pointermove', function (evenement) {
                    var rang = trace.rangSousPointeur(evenement.clientX);
                    trace.placer(rang);
                    lire(rang);
                });
                trace.svg.addEventListener('pointerleave', function () {
                    trace.masquer();
                    lire(resultat.points.length - 1);
                });

                lire(resultat.points.length - 1);
                boite.appendChild(pied);
            })
            .catch(function (erreur) {
                if (!boite.isConnected) return;
                etat.className = 'erreur';
                etat.textContent = erreur.message || 'Graphique momentanément indisponible.';
            });
    }

    // Un cours du bandeau ouvre son propre graphique. C'est pour cela que le
    // bloc des cours n'est plus cliquable en entier : un bouton ne peut pas en
    // contenir d'autres.
    function tickerActif(actif, devise) {
        var bouton = document.createElement('button');
        bouton.type = 'button';
        bouton.className = 'ticker-actif';
        bouton.title = "Voir l'évolution du cours de " + actif.nom + ' sur 24 heures';
        bouton.addEventListener('click', function () { ouvrirGraphique(actif, devise); });

        var symbole = document.createElement('span');
        symbole.className = 'ticker-symbole';
        symbole.textContent = actif.symbole;

        var prix = document.createElement('span');
        prix.className = 'ticker-prix';
        prix.textContent = formaterPrix(actif.prix, devise);

        var variation = document.createElement('span');
        variation.className = classeVariation(actif.variation_24h);
        variation.textContent = formaterVariation(actif.variation_24h);

        bouton.appendChild(symbole);
        bouton.appendChild(prix);
        bouton.appendChild(variation);
        return bouton;
    }

    function rendreEncart() {
        var encart = document.getElementById('encart-marche');
        if (!encart) return;
        C.vider(encart);

        if (donnees.cours && donnees.cours.actifs.length) {
            var blocCours = document.createElement('div');
            blocCours.className = 'encart-bloc encart-cours';

            var ticker = document.createElement('div');
            ticker.className = 'ticker';

            donnees.cours.actifs.slice(0, 2).forEach(function (actif) {
                ticker.appendChild(tickerActif(actif, donnees.cours.devise));
            });
            blocCours.appendChild(ticker);

            // Les cours au-dela des deux premiers restent joignables par ce
            // bouton, qui reste le seul acces a la liste sur petit ecran.
            var nombreCours = donnees.cours.actifs.length;
            var tousLesCours = document.createElement('button');
            tousLesCours.type = 'button';
            tousLesCours.className = 'encart-tout';
            tousLesCours.title = nombreCours > 1
                ? 'Voir les ' + nombreCours + ' cours'
                : 'Voir le cours';
            tousLesCours.setAttribute('aria-label', tousLesCours.title);
            tousLesCours.addEventListener('click', ouvrirTousLesCours);

            var icone = baliseSvg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' });
            icone.appendChild(baliseSvg('path', { d: 'M4 6h16M4 12h16M4 18h10' }));
            tousLesCours.appendChild(icone);

            blocCours.appendChild(tousLesCours);
            encart.appendChild(blocCours);
        }

        if (donnees.actus && donnees.actus.articles.length) {
            var nombreActus = donnees.actus.articles.length;
            var blocActus = blocCliquable(
                nombreActus > 1 ? 'Voir les ' + nombreActus + ' actualités' : "Voir l'actualité",
                ouvrirToutesLesActus
            );

            var titres = document.createElement('div');
            titres.className = 'encart-actus';

            // Titres en texte simple : le lien vers l'article est dans la boite.
            // Des liens ici auraient concurrence le clic qui ouvre le bloc.
            donnees.actus.articles.slice(0, 2).forEach(function (article) {
                var titre = document.createElement('span');
                titre.className = 'encart-actu';
                titre.textContent = article.titre;
                titres.appendChild(titre);
            });

            blocActus.appendChild(titres);
            encart.appendChild(blocActus);
        }
    }

    // --- Chargement -------------------------------------------------------
    // Les cours sont demandes dans la devise choisie par l'utilisateur :
    // la conversion est faite par la source, jamais dans le navigateur.
    // forcer : rafraichissement demande par le visiteur. L'API raccourcit alors
    // son cache sans le supprimer, ce qui protege la source d'un clic en rafale.
    function chargerCours(forcer) {
        return C.appeler('/marche/cours?devise=' + C.devise().toLowerCase() + (forcer ? '&forcer=1' : ''))
            .then(function (resultat) { donnees.cours = resultat; })
            .catch(function () { /* la derniere valeur connue reste affichee */ });
    }

    function chargerActus(forcer) {
        return C.appeler('/actualites?limite=' + NOMBRE_ACTUS + (forcer ? '&forcer=1' : ''))
            .then(function (resultat) { donnees.actus = resultat; })
            .catch(function () { /* la derniere valeur connue reste affichee */ });
    }

    function charger(forcer) {
        return Promise.all([chargerCours(forcer), chargerActus(forcer)]);
    }

    function brancherRafraichir(identifiant, chargement) {
        var bouton = document.getElementById(identifiant);
        if (!bouton) return;

        bouton.addEventListener('click', function () {
            bouton.disabled = true;
            bouton.classList.add('fleche-tourne');
            chargement(true)
                .then(rendre)
                .finally(function () {
                    bouton.disabled = false;
                    bouton.classList.remove('fleche-tourne');
                });
        });
    }

    function rendre() {
        if (estConnecte) rendreEncart();
        else rendreSections();
    }

    // connecte === true : bandeau dans l'en-tete. Sinon : blocs defilants de la page.
    function appliquer(connecte) {
        estConnecte = !!connecte;

        var sectionMarche = document.getElementById('section-marche');
        var sectionActus = document.getElementById('section-actus');
        var encart = document.getElementById('encart-marche');

        if (sectionMarche) sectionMarche.hidden = estConnecte;
        if (sectionActus) sectionActus.hidden = estConnecte;
        if (encart) encart.hidden = !estConnecte;

        charger().then(rendre);

        if (minuterie) clearInterval(minuterie);
        minuterie = setInterval(function () {
            charger().then(rendre);
        }, RAFRAICHISSEMENT);
    }

    // Changement de devise : les cours sont redemandes, pas reconvertis sur place
    C.surChangementDevise(function () {
        chargerCours().then(rendre);
    });

    brancherRafraichir('marche-rafraichir', chargerCours);
    brancherRafraichir('actus-rafraichir', chargerActus);

    window.Marche = {
        appliquer: appliquer,
        formaterVariation: formaterVariation,
        classeVariation: classeVariation,
    };
})();
