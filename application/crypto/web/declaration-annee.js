// Synthèse de la déclaration fiscale d'une année : le total à reporter sur la
// 2042-C et sa case, puis le formulaire 2086 vente par vente, case par case.
//
// Le tableau suit la présentation du formulaire en ligne : chaque cession dans
// une colonne, cinq par page, et chaque case dans une ligne numérotée. Les
// montants s'écrivent sans espace, pour se coller tels quels sur impots.gouv.fr.
(function () {
    'use strict';

    var C = window.Crypto;

    var erreurPage = document.getElementById('erreur-page');
    var synthese = document.getElementById('synthese');
    var reportContenu = document.getElementById('report-contenu');
    var pagination = document.getElementById('pagination-2086');
    var position = document.getElementById('position-2086');
    var precedent = document.getElementById('precedent-2086');
    var suivant = document.getElementById('suivant-2086');
    var remplissage = document.getElementById('remplissage-2086');
    var boutonCopier = document.getElementById('copier-cessions');
    var favori = document.getElementById('favori-2086');

    // Cinq cessions par page, comme sur le formulaire en ligne
    var PAR_PAGE = 5;
    var cessions = [];
    var page = 0;

    // Lignes du formulaire 2086, dans l'ordre du formulaire. groupe : la ligne
    // ouvre un bloc du formulaire, séparé du précédent.
    var LIGNES = [
        { cle: 'l211', numero: '211', court: 'Date de cession',
          libelle: 'Date de la cession',
          aide: 'Jour de la vente, heure de Paris.' },
        { cle: 'l212', numero: '212', court: 'Valeur du portefeuille',
          libelle: 'Valeur globale du portefeuille au moment de la cession',
          aide: 'Valeur de toutes les cryptos détenues juste avant la vente : la crypto vendue à son prix de vente réel, les autres à leur cours d’ouverture du jour (0 h UTC, Binance, à défaut Kraken ou Bitstamp), comme le calcule Waltio.' },
        { cle: 'l213', numero: '213', court: 'Prix de cession', groupe: true,
          libelle: 'Prix de cession',
          aide: 'Montant de la vente, avant déduction des frais.' },
        { cle: 'l214', numero: '214', court: 'Frais',
          libelle: 'Frais de cession',
          aide: 'Frais prélevés par la plateforme sur la vente.' },
        { cle: 'l215', numero: '215', court: 'Net des frais',
          libelle: 'Prix de cession net des frais',
          aide: 'Ligne 213 moins ligne 214, calculée par le formulaire : rien à saisir.' },
        { cle: 'l216', numero: '216', court: 'Soulte',
          libelle: 'Soulte reçue ou versée lors de la cession',
          aide: 'Zéro : les ventes se font contre des euros, sans échange entre cryptos.' },
        { cle: 'l217', numero: '217', court: 'Net des soultes',
          libelle: 'Prix de cession net des soultes',
          aide: 'Ligne 213 corrigée de la ligne 216 : identique à la ligne 213, faute de soulte. Calculée par le formulaire.' },
        { cle: 'l218', numero: '218', court: 'Net frais et soultes',
          libelle: 'Prix de cession net des frais et soultes',
          aide: 'Ligne 213 moins la ligne 214, corrigée de la ligne 216 : identique à la ligne 215. Calculée par le formulaire.' },
        { cle: 'l220', numero: '220', court: 'Prix total d’acquisition', groupe: true,
          libelle: 'Prix total d’acquisition du portefeuille',
          aide: 'Total payé pour toutes les cryptos acquises depuis l’origine jusqu’à cette vente, frais d’achat compris.' },
        { cle: 'l221', numero: '221', court: 'Fractions déjà imputées',
          libelle: 'Fractions de capital initial contenues dans le prix total d’acquisition',
          aide: 'Part du prix d’acquisition déjà imputée aux ventes précédentes, toutes années confondues.' },
        { cle: 'l222', numero: '222', court: 'Soultes antérieures',
          libelle: 'Soultes reçues en cas d’échanges antérieurs à la cession',
          aide: 'Zéro : aucun échange antérieur avec soulte.' },
        { cle: 'l223', numero: '223', court: 'Acquisition nette',
          libelle: 'Prix total d’acquisition net',
          aide: 'Ligne 220 moins les lignes 221 et 222, sur les montants arrondis, comme le calcule le formulaire.' },
        { cle: 'l224', numero: '224', court: 'Plus ou moins-value', groupe: true,
          libelle: 'Plus-value ou moins-value',
          aide: 'Ligne 218 − (ligne 223 × ligne 217 ÷ ligne 212), sur les montants arrondis, comme le calcule le formulaire.' },
    ];

    var CASES = {
        '3AN': 'Plus-value nette de cession d’actifs numériques',
        '3BN': 'Moins-value nette de cession d’actifs numériques',
    };

    function afficherErreur(texte) {
        erreurPage.textContent = texte;
        erreurPage.hidden = false;
        synthese.hidden = true;
    }

    function jourFrancais(jour) {
        var morceaux = String(jour || '').split('-');
        return morceaux.length === 3 ? morceaux[2] + '/' + morceaux[1] + '/' + morceaux[0] : '—';
    }

    function classePlusValue(montant) {
        if (montant === null || montant === undefined) return '';
        return String(montant).charAt(0) === '-' ? 'pv-perte' : 'pv-gain';
    }

    function element(balise, classe, texte) {
        var noeud = document.createElement(balise);
        if (classe) noeud.className = classe;
        if (texte !== undefined) noeud.textContent = texte;
        return noeud;
    }

    // Une chaîne de chiffres augmentée de un, retenue comprise
    function plusUn(chiffres) {
        var resultat = '';
        var retenue = 1;
        for (var rang = chiffres.length - 1; rang >= 0; rang -= 1) {
            var chiffre = Number(chiffres.charAt(rang)) + retenue;
            retenue = chiffre > 9 ? 1 : 0;
            resultat = String(chiffre % 10) + resultat;
        }
        return (retenue ? '1' : '') + resultat;
    }

    // Montant arrondi à l'euro le plus proche — 0,50 € et plus comptent pour un
    // euro, comme le veut le formulaire —, sans espace ni séparateur, et avec
    // un trait d'union pour signe. L'arrondi se fait sur la chaîne décimale,
    // sans passer par un flottant.
    function euroEntier(valeur) {
        var forme = String(valeur === null || valeur === undefined ? '' : valeur).trim()
            .match(/^(-?)(\d+)(?:\.(\d*))?$/);
        if (!forme) return null;
        var chiffres = forme[2].replace(/^0+(?=\d)/, '');
        if ((forme[3] || '').charAt(0) >= '5') chiffres = plusUn(chiffres);
        return (forme[1] && chiffres !== '0' ? '-' : '') + chiffres;
    }

    // Une valeur à reporter sur impots.gouv.fr : un clic la sélectionne en
    // entier — signe moins et barres de la date compris, qu'une sélection de
    // mot laisserait de côté — et la copie dans le presse-papiers.
    function valeurCopiable(texte) {
        var valeur = element('span', 'valeur-copiable', texte);
        valeur.title = 'Cliquez pour copier';
        return valeur;
    }

    // Le symbole suit le montant sans être sélectionnable : copier la case ne
    // prend que le nombre.
    function montantCopiable(valeur) {
        var entier = euroEntier(valeur);
        var bloc = element('span', 'montant-copiable');
        if (entier === null) {
            bloc.textContent = '—';
            return bloc;
        }
        bloc.appendChild(valeurCopiable(entier));
        bloc.appendChild(element('span', 'montant-unite', ' €'));
        return bloc;
    }

    // Confirmation à côté de la valeur copiée : un seul toast, déplacé et
    // relancé à chaque copie
    var toast = null;
    var minuteurToast = null;
    var ECART_TOAST = 8;

    function afficherToast(texte, erreur, valeur) {
        if (!toast) {
            toast = element('div', 'toast');
            toast.setAttribute('role', 'status');
            document.body.appendChild(toast);
        }
        toast.textContent = texte;
        toast.classList.toggle('toast-erreur', Boolean(erreur));

        // À droite de la valeur, à sa hauteur ; à gauche si le bord de la
        // fenêtre est trop près. Le texte posé, la largeur du toast est connue.
        var cadre = valeur.getBoundingClientRect();
        var gauche = cadre.right + ECART_TOAST;
        if (gauche + toast.offsetWidth > window.innerWidth - ECART_TOAST) {
            gauche = cadre.left - ECART_TOAST - toast.offsetWidth;
        }
        toast.style.left = Math.max(ECART_TOAST, gauche) + 'px';
        toast.style.top = (cadre.top + cadre.height / 2) + 'px';

        toast.classList.add('toast-visible');
        window.clearTimeout(minuteurToast);
        minuteurToast = window.setTimeout(function () {
            toast.classList.remove('toast-visible');
        }, 1500);
    }

    // Un seul écouteur pour toute la page : le tableau est reconstruit à
    // chaque changement de page. Le clic sélectionne déjà la valeur entière ;
    // elle part en plus dans le presse-papiers. Sans presse-papiers
    // accessible, elle reste sélectionnée et se copie avec Ctrl+C.
    function copierAuClic(evenement) {
        var valeur = evenement.target.closest ? evenement.target.closest('.valeur-copiable') : null;
        if (!valeur) return;

        if (!navigator.clipboard || !navigator.clipboard.writeText) {
            afficherToast('Copie automatique indisponible : faites Ctrl+C', true, valeur);
            return;
        }
        navigator.clipboard.writeText(valeur.textContent)
            .then(function () {
                valeur.classList.add('valeur-copiee');
                window.setTimeout(function () { valeur.classList.remove('valeur-copiee'); }, 1200);
                afficherToast('Copié', false, valeur);
            })
            .catch(function (erreur) {
                console.error('Copie dans le presse-papiers refusée :', erreur.message);
                afficherToast('Copie refusée par le navigateur : faites Ctrl+C', true, valeur);
            });
    }

    // --- Report sur la 2042-C ---------------------------------------------
    function rendreReport(donnees) {
        C.vider(reportContenu);
        var total = donnees.total;

        if (!total.cessions) {
            reportContenu.appendChild(element('p', 'pv-vide',
                'Aucune vente en ' + donnees.annee + ' : aucune plus-value d’actifs numériques à déclarer.'));
            return;
        }

        if (total.case) {
            var carte = element('div', 'decl-case-carte');

            var repere = element('span', 'decl-case', total.case);
            repere.title = 'Case ' + total.case + ' de la déclaration 2042-C';
            carte.appendChild(repere);

            var texte = element('div', 'decl-case-texte');
            texte.appendChild(element('span', 'decl-case-libelle',
                'Case ' + total.case + ' — ' + CASES[total.case]));
            texte.appendChild(element('span', 'decl-case-aide',
                'Déclaration complémentaire 2042-C, rubrique des plus-values de cession d’actifs numériques.'));
            carte.appendChild(texte);

            var montant = element('div', 'decl-case-montant');
            var valeur = element('span', 'decl-case-valeur ' + classePlusValue(total.plus_value));
            valeur.appendChild(montantCopiable(total.montant_case));
            montant.appendChild(valeur);
            montant.appendChild(element('span', 'decl-case-exact',
                'calculé comme le formulaire ; sans ses arrondis : '
                + C.formaterEuros(total.plus_value_exacte, { signe: true, groupes: false })));
            carte.appendChild(montant);

            reportContenu.appendChild(carte);
        }

        var faits = element('ul', 'decl-faits');
        [
            [total.cessions > 1 ? total.cessions + ' ventes' : '1 vente', 'à détailler sur le formulaire 2086'],
            [C.formaterEuros(total.prix_cession, { groupes: false }), 'de ventes, avant frais (total ligne 213)'],
            [C.formaterEuros(total.frais, { groupes: false }), 'de frais de cession (total ligne 214)'],
        ].forEach(function (fait) {
            var item = element('li');
            item.appendChild(element('strong', null, fait[0]));
            item.appendChild(document.createTextNode(' ' + fait[1]));
            faits.appendChild(item);
        });
        reportContenu.appendChild(faits);

        if (total.exoneree) {
            reportContenu.appendChild(element('p', 'decl-exoneration',
                'Le total des ventes de l’année ne dépasse pas ' + total.seuil_exoneration
                + ' € : ces plus-values sont exonérées, rien n’est à déclarer à ce titre.'));
        } else {
            reportContenu.appendChild(element('p', 'aide decl-note',
                'Le formulaire 2086 accompagne la déclaration : il détaille le calcul de la case '
                + (total.case || '3AN ou 3BN') + ', vente par vente (tableau ci-dessous). '
                + 'Pensez aussi au formulaire 3916-bis pour les comptes d’actifs numériques ouverts à l’étranger.'));
        }

        if (!donnees.complet) {
            reportContenu.appendChild(element('p', 'pv-reserve',
                'Chiffre à vérifier : ' + donnees.reserves.join(' ; ') + '.'));
        }

        if (donnees.staking && donnees.staking.operations) {
            reportContenu.appendChild(element('p', 'aide decl-note', donnees.staking.convention === 'valeur_recue'
                ? 'Récompenses de staking comptées à leur valeur à la réception dans le prix d’acquisition (réglage du profil).'
                : 'Récompenses de staking comptées à un prix d’acquisition nul (réglage du profil).'));
        }
    }

    // --- Formulaire 2086 --------------------------------------------------
    // Une cession signalée incomplète est marquée sur toute sa colonne
    function marquerIncomplete(cellule, cession) {
        if (!cession || cession.complet) return;
        cellule.className += ' decl-incomplete';
        cellule.title = cession.reserves.join(' ; ');
    }

    function enteteCession(cession) {
        var th = element('th', 'decl-cession');
        th.scope = 'col';
        if (!cession) return th;

        th.appendChild(element('span', 'decl-cession-numero', 'Cession ' + cession.numero));
        var identite = element('span', 'decl-cession-crypto');
        identite.appendChild(C.logoCrypto(cession.id_crypto));
        var nom = element('span', 'decl-vente-texte');
        nom.appendChild(element('span', 'decl-vente-crypto', cession.id_crypto));
        nom.appendChild(element('span', 'decl-vente-quantite', C.formaterQuantite(cession.quantite)));
        identite.appendChild(nom);
        th.appendChild(identite);
        marquerIncomplete(th, cession);
        return th;
    }

    function enteteLigne(ligne) {
        var th = element('th', 'decl-ligne');
        th.scope = 'row';
        th.title = ligne.aide;
        th.appendChild(element('span', 'ligne-2086', ligne.numero));
        th.appendChild(element('span', 'decl-ligne-libelle', ligne.libelle));
        return th;
    }

    function valeurCellule(ligne, cession) {
        var td = element('td', 'cellule-nombre');
        if (!cession) return td;

        var valeur = cession[ligne.cle];
        if (ligne.cle === 'l211') {
            var jour = jourFrancais(valeur);
            td.appendChild(jour === '—' ? document.createTextNode(jour) : valeurCopiable(jour));
        } else {
            td.appendChild(montantCopiable(valeur));
        }
        if (ligne.cle === 'l224') td.className += ' decl-pv ' + classePlusValue(valeur);
        marquerIncomplete(td, cession);
        return td;
    }

    function rendrePage() {
        var tete = document.getElementById('tete-2086');
        var corps = document.getElementById('corps-2086');
        C.vider(tete);
        C.vider(corps);

        var pages = Math.ceil(cessions.length / PAR_PAGE);
        var debut = page * PAR_PAGE;
        var visibles = cessions.slice(debut, debut + PAR_PAGE);
        var derniere = debut + visibles.length;
        // La dernière page garde ses cinq colonnes : la mise en page ne saute pas
        while (visibles.length < PAR_PAGE) visibles.push(null);

        var ligneTete = element('tr');
        var coin = element('th', 'decl-ligne', 'Case');
        coin.scope = 'col';
        ligneTete.appendChild(coin);
        visibles.forEach(function (cession) { ligneTete.appendChild(enteteCession(cession)); });
        tete.appendChild(ligneTete);

        LIGNES.forEach(function (ligne) {
            var tr = element('tr', ligne.groupe ? 'decl-groupe' : '');
            tr.appendChild(enteteLigne(ligne));
            visibles.forEach(function (cession) { tr.appendChild(valeurCellule(ligne, cession)); });
            corps.appendChild(tr);
        });

        pagination.hidden = pages <= 1;
        position.textContent = 'Page ' + (page + 1) + ' sur ' + pages
            + ' · cessions ' + (debut + 1) + ' à ' + derniere;
        precedent.disabled = page === 0;
        suivant.disabled = page >= pages - 1;
        boutonCopier.textContent = derniere > debut + 1
            ? 'Copier les cessions ' + (debut + 1) + ' à ' + derniere
            : 'Copier la cession ' + derniere;
    }

    function rendre2086(donnees) {
        var compteur = document.getElementById('compteur-cessions');
        compteur.textContent = donnees.cessions.length;
        compteur.hidden = !donnees.cessions.length;

        cessions = donnees.cessions;
        page = 0;
        remplissage.hidden = !cessions.length;

        if (!cessions.length) {
            var corps = document.getElementById('corps-2086');
            C.vider(document.getElementById('tete-2086'));
            C.vider(corps);
            var vide = element('tr');
            var cellule = element('td', 'pv-vide', 'Aucune vente cette année.');
            cellule.colSpan = PAR_PAGE + 1;
            vide.appendChild(cellule);
            corps.appendChild(vide);
            pagination.hidden = true;
            return;
        }

        rendrePage();
    }

    // --- Favori de remplissage d'impots.gouv.fr ---------------------------
    // Une page ne peut pas écrire dans une autre : le remplissage passe par un
    // favori, que le navigateur exécute sur la page des impôts. La fonction
    // ci-dessous n'est jamais appelée ici : son texte devient le favori. Elle
    // doit donc se suffire à elle-même, sans rien emprunter à ce fichier, et
    // ne contenir ni commentaire de fin de ligne ni signe pourcent.
    //
    // Elle lit dans le presse-papiers les cessions copiées par le bouton
    // « Copier les 5 cessions », retrouve chaque ligne à saisir du formulaire
    // (211 à 214, 220, 221) par son numéro, puis remplit chaque colonne avec
    // la cession dont le numéro figure en tête. Les événements d'une saisie
    // sont rejoués, pour que le formulaire recalcule ses autres lignes ; rien
    // n'est validé.
    function remplir2086() {
        var FORMAT = 'suivi-crypto-2086';
        var LIGNES = ['211', '212', '213', '214', '220', '221'];
        var liste = function (noeuds) { return Array.prototype.slice.call(noeuds); };

        function demanderTexte() {
            return window.prompt('Collez ici (Ctrl+V) les cessions copiées sur Suivi crypto :') || '';
        }

        function lirePressePapiers() {
            if (!navigator.clipboard || !navigator.clipboard.readText) return Promise.resolve(demanderTexte());
            return navigator.clipboard.readText().then(null, demanderTexte);
        }

        function champsDesLignes() {
            var trouves = {};
            liste(document.querySelectorAll('tr')).forEach(function (rangee) {
                var champs = liste(rangee.querySelectorAll('input')).filter(function (champ) {
                    return ['', 'text', 'tel', 'number'].indexOf(champ.type) !== -1;
                });
                var texte = (rangee.textContent || '').replace(/\s+/g, ' ').trim();
                var numero = (texte.match(/^(\d{3})(?!\d)/) || [])[1];
                if (!champs.length || LIGNES.indexOf(numero) === -1) return;
                if (!trouves[numero] || champs.length < trouves[numero].length) trouves[numero] = champs;
            });
            return trouves;
        }

        function numerosEnTete() {
            return liste(document.querySelectorAll('body *')).filter(function (noeud) {
                return !noeud.children.length && /^Cession\s+\d+$/i.test((noeud.textContent || '').trim());
            }).map(function (noeud) { return Number(noeud.textContent.replace(/\D/g, '')); });
        }

        function saisir(champ, valeur) {
            var ecrire = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            champ.focus();
            ecrire.call(champ, valeur);
            ['input', 'change', 'keyup', 'blur'].forEach(function (type) {
                champ.dispatchEvent(new Event(type, { bubbles: true }));
            });
        }

        function numeros(serie) {
            return serie.map(function (cession) { return cession.numero; }).join(', ');
        }

        lirePressePapiers().then(function (texte) {
            var donnees = null;
            try {
                donnees = JSON.parse(texte);
            } catch (erreur) {
                donnees = null;
            }
            if (!donnees || donnees.format !== FORMAT || !donnees.cessions || !donnees.cessions.length) {
                window.alert('Rien à coller : sur Suivi crypto, cliquez d\'abord sur « Copier les 5 cessions ».');
                return;
            }

            var champs = champsDesLignes();
            var absentes = LIGNES.filter(function (numero) { return !champs[numero]; });
            if (absentes.length) {
                window.alert('Formulaire 2086 non reconnu sur cette page : ligne(s) ' + absentes.join(', ')
                    + ' introuvable(s). Rien n\'a été rempli.');
                return;
            }

            var parNumero = {};
            donnees.cessions.forEach(function (cession) { parNumero[cession.numero] = cession; });
            var enTete = numerosEnTete();
            var lues = enTete.length === champs['211'].length;
            var colonnes = lues
                ? enTete.map(function (numero) { return parNumero[numero] || null; })
                : donnees.cessions.slice(0, champs['211'].length);
            var remplies = colonnes.filter(Boolean);
            if (!remplies.length) {
                window.alert('Cette page porte les cessions ' + enTete.join(', ') + ', mais les cessions copiées sont les '
                    + numeros(donnees.cessions) + '. Copiez la bonne page sur Suivi crypto. Rien n\'a été rempli.');
                return;
            }

            LIGNES.forEach(function (numero) {
                champs[numero].forEach(function (champ, rang) {
                    var cession = colonnes[rang];
                    if (cession) saisir(champ, String(cession['l' + numero]));
                });
            });
            window.alert('Cessions ' + numeros(remplies) + ' collées.'
                + (lues ? '' : ' Numéros de cession non lus sur la page : collées dans l\'ordre.')
                + ' Vérifiez chaque case avant de valider.');
        }, function (erreur) {
            window.alert('Lecture du presse-papiers impossible : ' + erreur.message);
        });
    }

    // Ce que le favori colle : les lignes à saisir des cessions affichées,
    // telles que le tableau les montre. Une ligne 221 nulle reste vide, comme
    // on la laisse sur le formulaire.
    function cessionsAffichees() {
        var debut = page * PAR_PAGE;
        return cessions.slice(debut, debut + PAR_PAGE).map(function (cession) {
            var fractions = euroEntier(cession.l221);
            return {
                numero: cession.numero,
                l211: jourFrancais(cession.l211),
                l212: euroEntier(cession.l212) || '',
                l213: euroEntier(cession.l213) || '',
                l214: euroEntier(cession.l214) || '',
                l220: euroEntier(cession.l220) || '',
                l221: fractions && fractions !== '0' ? fractions : '',
            };
        });
    }

    boutonCopier.addEventListener('click', function () {
        var affichees = cessionsAffichees();
        var texte = JSON.stringify({ format: 'suivi-crypto-2086', cessions: affichees });
        if (!navigator.clipboard || !navigator.clipboard.writeText) {
            afficherToast('Copie automatique indisponible dans ce navigateur', true, boutonCopier);
            return;
        }
        navigator.clipboard.writeText(texte)
            .then(function () {
                afficherToast(affichees.length > 1 ? affichees.length + ' cessions copiées' : 'Cession copiée',
                    false, boutonCopier);
            })
            .catch(function (erreur) {
                console.error('Copie des cessions refusée :', erreur.message);
                afficherToast('Copie refusée par le navigateur', true, boutonCopier);
            });
    });

    // Le texte du favori, encodé : décodé à l'exécution, il redonne la fonction
    favori.setAttribute('href', 'javascript:' + encodeURIComponent('(' + remplir2086.toString() + ')();'));
    // Exécuté ici, il ne trouverait aucun formulaire : il sert seulement à être glissé
    favori.addEventListener('click', function (evenement) {
        evenement.preventDefault();
        afficherToast('Glissez ce lien dans la barre de favoris : il sert sur impots.gouv.fr', true, favori);
    });

    synthese.addEventListener('click', copierAuClic);

    precedent.addEventListener('click', function () {
        if (page === 0) return;
        page -= 1;
        rendrePage();
    });

    suivant.addEventListener('click', function () {
        if ((page + 1) * PAR_PAGE >= cessions.length) return;
        page += 1;
        rendrePage();
    });

    function rendreLegende() {
        var legende = document.getElementById('legende');
        C.vider(legende);
        LIGNES.forEach(function (ligne) {
            var dt = element('dt');
            dt.appendChild(element('span', 'ligne-2086', ligne.numero));
            dt.appendChild(document.createTextNode(' ' + ligne.libelle));
            legende.appendChild(dt);
            legende.appendChild(element('dd', null, ligne.aide));
        });
    }

    function rendre(donnees) {
        document.title = 'Déclaration fiscale ' + donnees.annee + ' — Suivi crypto';
        document.getElementById('titre-page').textContent = 'Déclaration fiscale ' + donnees.annee;
        document.getElementById('fil-annee').textContent = String(donnees.annee);
        document.getElementById('sous-titre').textContent = 'Revenus ' + donnees.annee
            + ', déclarés en ' + (donnees.annee + 1) + ' — plus-values de cession d’actifs numériques.';

        rendreReport(donnees);
        rendre2086(donnees);
        rendreLegende();
        synthese.hidden = false;
    }

    // --- Démarrage --------------------------------------------------------
    var annee = new URLSearchParams(window.location.search).get('annee');
    if (!/^\d{4}$/.test(annee || '')) {
        window.location.href = '/declaration.html';
        return;
    }

    if (!C.lireJeton()) {
        window.location.href = '/';
        return;
    }

    C.appeler('/moi')
        .then(function (compte) {
            if (!compte.est_admin) {
                window.location.href = '/';
                return null;
            }
            C.afficherCompte(compte);
            if (window.Marche) window.Marche.appliquer(true);
            return C.appeler('/administration/declaration/' + annee).then(rendre);
        })
        .catch(function (erreur) {
            if (erreur.code === 401) {
                C.effacerJeton();
                window.location.href = '/';
                return;
            }
            afficherErreur('Déclaration indisponible : ' + erreur.message);
        });
})();
