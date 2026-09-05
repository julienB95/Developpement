// Briques partagees par les pages du site : appels a l'API, session, en-tete de compte
(function () {
    'use strict';

    var API = '/api/crypto';
    var CLE_JETON = 'crypto_jeton';

    // localStorage peut etre indisponible (navigation privee stricte, cookies bloques)
    function lireJeton() {
        try { return localStorage.getItem(CLE_JETON); } catch (e) { return null; }
    }
    function ecrireJeton(jeton) {
        try { localStorage.setItem(CLE_JETON, jeton); } catch (e) { /* session non memorisee */ }
    }
    function effacerJeton() {
        try { localStorage.removeItem(CLE_JETON); } catch (e) { /* rien a faire */ }
    }

    function appeler(chemin, options) {
        options = options || {};
        var entetes = { 'Content-Type': 'application/json' };
        var jeton = lireJeton();
        if (jeton) entetes.Authorization = 'Bearer ' + jeton;

        return fetch(API + chemin, {
            method: options.method || 'GET',
            headers: entetes,
            body: options.corps ? JSON.stringify(options.corps) : undefined,
        }).then(function (reponse) {
            return reponse.json()
                .catch(function () { return {}; })
                .then(function (corps) {
                    if (!reponse.ok) {
                        var erreur = new Error(corps.erreur || 'Erreur inattendue du serveur');
                        erreur.code = reponse.status;
                        throw erreur;
                    }
                    return corps;
                });
        });
    }

    function vider(element) {
        while (element.firstChild) element.removeChild(element.firstChild);
    }

    function initiales(compte) {
        var premier = (compte.prenom || '').trim().charAt(0);
        var second = (compte.nom || '').trim().charAt(0);
        var texte = (premier + second) || (compte.courriel || '?').charAt(0);
        return texte.toUpperCase();
    }

    function seDeconnecter(apres) {
        appeler('/deconnexion', { method: 'POST' })
            .catch(function () { /* la session locale est effacee dans tous les cas */ })
            .finally(function () {
                effacerJeton();
                if (typeof apres === 'function') apres();
            });
    }

    // Remplit #bloc-compte : bouton de connexion, ou pastille et menu du compte connecte
    function afficherCompte(compte, options) {
        options = options || {};
        var bloc = document.getElementById('bloc-compte');
        if (!bloc) return;
        vider(bloc);

        if (!compte) {
            var bouton = document.createElement('button');
            bouton.className = 'bouton bouton-entete';
            bouton.type = 'button';
            bouton.textContent = 'Se connecter';
            bouton.addEventListener('click', function () {
                if (options.surConnexion) options.surConnexion();
                else window.location.href = '/';
            });
            bloc.appendChild(bouton);
            return;
        }

        var conteneur = document.createElement('div');
        conteneur.className = 'menu-compte';

        var pastille = document.createElement('button');
        pastille.className = 'pastille';
        pastille.type = 'button';
        pastille.textContent = initiales(compte);
        pastille.title = compte.prenom + ' ' + compte.nom;
        pastille.setAttribute('aria-haspopup', 'true');
        pastille.setAttribute('aria-expanded', 'false');

        var menu = document.createElement('div');
        menu.className = 'menu-deroulant';
        menu.hidden = true;

        var identite = document.createElement('p');
        identite.className = 'menu-identite';
        identite.textContent = compte.prenom + ' ' + compte.nom;

        var courriel = document.createElement('p');
        courriel.className = 'menu-courriel';
        courriel.textContent = compte.courriel;

        menu.appendChild(identite);
        menu.appendChild(courriel);

        // Accessible a tout le monde
        function lienMenu(adresse, libelle) {
            var lien = document.createElement('a');
            lien.className = 'menu-action menu-action-lien';
            lien.href = adresse;
            lien.textContent = libelle;
            return lien;
        }

        if (options.masquerOperations !== true) {
            menu.appendChild(lienMenu('/operations.html', 'Opérations'));
        }
        if (options.masquerProfil !== true) {
            menu.appendChild(lienMenu('/profil.html', 'Profil'));
        }

        if (compte.est_admin) {
            var etiquette = document.createElement('p');
            etiquette.className = 'menu-role';
            etiquette.textContent = 'Administrateur';
            menu.appendChild(etiquette);

            if (!options.masquerAdministration) {
                menu.appendChild(lienMenu('/administration.html', 'Administration'));
            }
        }

        var deconnexion = document.createElement('button');
        deconnexion.className = 'menu-action';
        deconnexion.type = 'button';
        deconnexion.textContent = 'Se déconnecter';
        deconnexion.addEventListener('click', function () {
            seDeconnecter(options.surDeconnexion || function () { window.location.href = '/'; });
        });
        menu.appendChild(deconnexion);

        pastille.addEventListener('click', function (evenement) {
            evenement.stopPropagation();
            menu.hidden = !menu.hidden;
            pastille.setAttribute('aria-expanded', String(!menu.hidden));
        });

        document.addEventListener('click', function (evenement) {
            if (!menu.hidden && !conteneur.contains(evenement.target)) {
                menu.hidden = true;
                pastille.setAttribute('aria-expanded', 'false');
            }
        });

        conteneur.appendChild(pastille);
        conteneur.appendChild(menu);
        bloc.appendChild(conteneur);
    }

    // --- Fermeture d'une boîte au clic extérieur --------------------------
    // Un clic sur le fond d'une boîte modale a pour cible la boîte elle-même :
    // c'est ce qui permet de distinguer le fond du contenu. La comparaison au
    // rectangle évite de fermer quand on clique dans la marge de la boîte,
    // et le test sur la cible protège ce qui déborde d'elle — le pavé numérique
    // sort du cadre tout en restant un descendant.
    function fermerAuClicExterieur(dialogue) {
        dialogue.addEventListener('click', function (evenement) {
            if (evenement.target !== dialogue) return;

            var cadre = dialogue.getBoundingClientRect();
            var dedans = evenement.clientX >= cadre.left
                && evenement.clientX <= cadre.right
                && evenement.clientY >= cadre.top
                && evenement.clientY <= cadre.bottom;

            if (!dedans) dialogue.close();
        });
    }

    // Date et heure d'une opération, toujours affichées en heure de Paris :
    // c'est le calendrier français qui fait foi pour la déclaration.
    function formaterDateHeure(iso) {
        var date = new Date(iso);
        if (isNaN(date.getTime())) return '—';
        try {
            return new Intl.DateTimeFormat('fr-FR', {
                timeZone: 'Europe/Paris',
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hourCycle: 'h23',
            }).format(date);
        } catch (e) {
            // Fuseau inconnu du navigateur : repli sur l'heure locale du poste
            return date.toLocaleString('fr-FR');
        }
    }

    // --- Logo d'une crypto ------------------------------------------------
    // L'image est servie par l'API, jamais recuperee depuis la source par le
    // navigateur. Si elle manque, une pastille de repli porte le symbole.
    function logoCrypto(idCrypto, taille) {
        taille = taille || 28;

        var cadre = document.createElement('span');
        cadre.className = 'logo-crypto';
        cadre.style.width = taille + 'px';
        cadre.style.height = taille + 'px';

        var repli = document.createElement('span');
        repli.className = 'logo-repli';
        repli.textContent = String(idCrypto).slice(0, 3);
        repli.hidden = true;

        var image = document.createElement('img');
        image.src = '/api/crypto/cryptos/' + encodeURIComponent(idCrypto) + '/logo';
        image.alt = '';
        image.width = taille;
        image.height = taille;
        image.loading = 'lazy';
        image.addEventListener('error', function () {
            image.remove();
            repli.hidden = false;
        });

        cadre.appendChild(repli);
        cadre.appendChild(image);
        return cadre;
    }

    // --- Mise en forme des montants ---------------------------------------
    function formaterMontant(valeur, deviseDemandee) {
        var nombre = Number(valeur);
        if (valeur === null || valeur === undefined || !isFinite(nombre)) return '—';
        // Les cryptos a faible valeur unitaire ont besoin de plus de decimales
        var decimales = nombre >= 100 ? 0 : (nombre >= 1 ? 2 : 6);
        return new Intl.NumberFormat('fr-FR', {
            style: 'currency',
            currency: deviseDemandee || deviseCourante,
            minimumFractionDigits: decimales,
            maximumFractionDigits: decimales,
        }).format(nombre);
    }

    // Les quantites arrivent en chaine decimale : on les met en forme sans jamais
    // passer par un flottant, qui perdrait les derniers chiffres significatifs.
    function formaterQuantite(valeur) {
        if (valeur === null || valeur === undefined) return '—';
        var texte = String(valeur).trim();
        if (!/^-?\d+(\.\d+)?$/.test(texte)) return texte;

        var signe = texte.charAt(0) === '-' ? '-' : '';
        if (signe) texte = texte.slice(1);

        var morceaux = texte.split('.');
        var entier = morceaux[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
        var decimal = (morceaux[1] || '').replace(/0+$/, '');

        return signe + entier + (decimal ? ',' + decimal : '');
    }

    // --- Devise d'affichage -----------------------------------------------
    // Hors connexion, le choix vit dans le navigateur. Une fois connecte, il est
    // porte par le compte : c'est lui qui fait foi et qui suit l'utilisateur.
    var CLE_DEVISE = 'crypto_devise';
    var SYMBOLES = { EUR: '€', USD: '$' };

    var deviseCourante = 'EUR';
    var abonnesDevise = [];

    function deviseValide(valeur) {
        var devise = String(valeur || '').toUpperCase();
        return SYMBOLES[devise] ? devise : null;
    }

    function lireDeviseLocale() {
        try { return deviseValide(localStorage.getItem(CLE_DEVISE)); } catch (e) { return null; }
    }
    function ecrireDeviseLocale(devise) {
        try { localStorage.setItem(CLE_DEVISE, devise); } catch (e) { /* choix non memorise */ }
    }

    function devise() { return deviseCourante; }
    function symboleDevise() { return SYMBOLES[deviseCourante]; }

    function rafraichirBoutonDevise() {
        var symbole = document.getElementById('devise-symbole');
        var bouton = document.getElementById('bouton-devise');
        if (symbole) symbole.textContent = SYMBOLES[deviseCourante];
        if (bouton) {
            var autre = deviseCourante === 'EUR' ? 'dollar' : 'euro';
            bouton.title = 'Montants en ' + (deviseCourante === 'EUR' ? 'euro' : 'dollar')
                + ' — afficher en ' + autre;
            bouton.setAttribute('aria-label', bouton.title);
        }
    }

    // enregistrer : true quand le changement vient de l'utilisateur, false quand
    // il vient du serveur (sinon on renverrait au serveur ce qu'il vient de dire)
    function definirDevise(valeur, options) {
        options = options || {};
        var nouvelle = deviseValide(valeur);
        if (!nouvelle) return;

        var change = nouvelle !== deviseCourante;
        deviseCourante = nouvelle;
        rafraichirBoutonDevise();
        ecrireDeviseLocale(nouvelle);

        if (options.enregistrer && lireJeton()) {
            appeler('/moi/devise', { method: 'PUT', corps: { devise: nouvelle } })
                .catch(function () { /* le choix reste applique a l'ecran pour cette visite */ });
        }

        if (change || options.forcer) {
            abonnesDevise.forEach(function (fn) { fn(nouvelle); });
        }
    }

    function surChangementDevise(fn) {
        if (typeof fn === 'function') abonnesDevise.push(fn);
    }

    function brancherBoutonDevise() {
        var bouton = document.getElementById('bouton-devise');
        if (!bouton) return;
        bouton.addEventListener('click', function () {
            definirDevise(deviseCourante === 'EUR' ? 'USD' : 'EUR', { enregistrer: true });
        });
    }

    deviseCourante = lireDeviseLocale() || 'EUR';
    brancherBoutonDevise();
    rafraichirBoutonDevise();

    // --- Horloge de l'en-tete ---------------------------------------------
    // Les horaires sont calcules par fuseau, jamais depuis l'heure du poste :
    // un visiteur hors de France doit voir la meme heure de Paris que les autres.
    // Les secondes defilent, pour un cout tenu au minimum :
    //   - les formateurs Intl sont construits une seule fois, pas a chaque battement ;
    //   - le DOM n'est ecrit que lorsque le texte affiche change reellement ;
    //   - le battement est arrete des que l'onglet passe en arriere-plan.
    var FUSEAUX = { paris: 'Europe/Paris', newYork: 'America/New_York' };

    var elementsHorloge = null;
    var formateurs = {};
    var attenteHorloge = null;
    var battementHorloge = null;

    function construireFormateur(options) {
        try {
            return new Intl.DateTimeFormat('fr-FR', options);
        } catch (e) {
            // Fuseau inconnu du navigateur : repli sur l'heure locale du poste
            var repli = Object.assign({}, options);
            delete repli.timeZone;
            return new Intl.DateTimeFormat('fr-FR', repli);
        }
    }

    function formateur(cle) {
        if (formateurs[cle]) return formateurs[cle];

        formateurs[cle] = cle === 'jour'
            ? construireFormateur({
                timeZone: FUSEAUX.paris,
                weekday: 'long',
                day: 'numeric',
                month: 'short',
                year: 'numeric',
            })
            : construireFormateur({
                timeZone: FUSEAUX[cle],
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hourCycle: 'h23',
            });

        return formateurs[cle];
    }

    function ecrireSiChange(element, texte) {
        if (element && element.textContent !== texte) element.textContent = texte;
    }

    function rafraichirHorloge() {
        if (!elementsHorloge) return;
        var maintenant = new Date();

        var jour = formateur('jour').format(maintenant);
        ecrireSiChange(elementsHorloge.jour, jour.charAt(0).toUpperCase() + jour.slice(1));
        ecrireSiChange(elementsHorloge.paris, formateur('paris').format(maintenant));
        ecrireSiChange(elementsHorloge.newYork, formateur('newYork').format(maintenant));
    }

    function arreterHorloge() {
        if (attenteHorloge) { clearTimeout(attenteHorloge); attenteHorloge = null; }
        if (battementHorloge) { clearInterval(battementHorloge); battementHorloge = null; }
    }

    function lancerHorloge() {
        arreterHorloge();
        rafraichirHorloge();
        // Recalage sur la seconde pleine : l'affichage change en meme temps que l'horloge systeme
        attenteHorloge = setTimeout(function () {
            attenteHorloge = null;
            rafraichirHorloge();
            battementHorloge = setInterval(rafraichirHorloge, 1000);
        }, 1000 - (Date.now() % 1000));
    }

    function demarrerHorloge() {
        if (!document.getElementById('horloge')) return;

        elementsHorloge = {
            jour: document.getElementById('horloge-jour'),
            paris: document.getElementById('horloge-paris'),
            newYork: document.getElementById('horloge-newyork'),
        };

        lancerHorloge();

        // Onglet en arriere-plan : plus rien a afficher, donc plus rien a calculer
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) arreterHorloge();
            else lancerHorloge();
        });
    }

    demarrerHorloge();

    window.Crypto = {
        appeler: appeler,
        lireJeton: lireJeton,
        ecrireJeton: ecrireJeton,
        effacerJeton: effacerJeton,
        vider: vider,
        initiales: initiales,
        afficherCompte: afficherCompte,
        seDeconnecter: seDeconnecter,
        devise: devise,
        symboleDevise: symboleDevise,
        definirDevise: definirDevise,
        formaterMontant: formaterMontant,
        formaterQuantite: formaterQuantite,
        logoCrypto: logoCrypto,
        formaterDateHeure: formaterDateHeure,
        fermerAuClicExterieur: fermerAuClicExterieur,
        surChangementDevise: surChangementDevise,
    };
})();
