// Synthèse de la déclaration fiscale d'une année : le total à reporter sur la
// 2042-C et sa case, puis le formulaire 2086 vente par vente, case par case.
//
// Le formulaire range chaque vente dans une colonne et chaque grandeur dans une
// ligne numérotée ; ce tableau fait l'inverse, une vente par ligne, pour rester
// lisible sur des dizaines de ventes. Les numéros de ligne du formulaire sont
// repris en tête de colonne : c'est eux qui disent où reporter chaque montant.
(function () {
    'use strict';

    var C = window.Crypto;

    var erreurPage = document.getElementById('erreur-page');
    var synthese = document.getElementById('synthese');
    var reportContenu = document.getElementById('report-contenu');

    // Lignes du formulaire 2086, dans l'ordre du formulaire
    var LIGNES = [
        { cle: 'l211', numero: '211', court: 'Date de cession',
          libelle: 'Date de la cession',
          aide: 'Jour de la vente, heure de Paris.' },
        { cle: 'l212', numero: '212', court: 'Valeur du portefeuille',
          libelle: 'Valeur globale du portefeuille au moment de la cession',
          aide: 'Valeur de toutes les cryptos détenues juste avant la vente, au cours moyen du jour (Binance, à défaut Kraken ou Bitstamp).' },
        { cle: 'l213', numero: '213', court: 'Prix de cession',
          libelle: 'Prix de cession',
          aide: 'Montant de la vente, avant déduction des frais.' },
        { cle: 'l214', numero: '214', court: 'Frais',
          libelle: 'Frais de cession',
          aide: 'Frais prélevés par la plateforme sur la vente.' },
        { cle: 'l215', numero: '215', court: 'Net des frais',
          libelle: 'Prix de cession net des frais',
          aide: 'Ligne 213 moins ligne 214.' },
        { cle: 'l216', numero: '216', court: 'Soulte',
          libelle: 'Soulte reçue ou versée lors de la cession',
          aide: 'Zéro : les ventes se font contre des euros, sans échange entre cryptos.' },
        { cle: 'l217', numero: '217', court: 'Net des soultes',
          libelle: 'Prix de cession net des soultes',
          aide: 'Ligne 213 corrigée de la ligne 216 : identique à la ligne 213, faute de soulte.' },
        { cle: 'l218', numero: '218', court: 'Net frais et soultes',
          libelle: 'Prix de cession net des frais et soultes',
          aide: 'Ligne 213 moins la ligne 214, corrigée de la ligne 216 : identique à la ligne 215.' },
        { cle: 'l220', numero: '220', court: 'Prix total d’acquisition',
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
          aide: 'Ligne 220 moins les lignes 221 et 222.' },
        { cle: 'l224', numero: '224', court: 'Plus ou moins-value',
          libelle: 'Plus-value ou moins-value',
          aide: 'Ligne 218 − (ligne 223 × ligne 217 ÷ ligne 212).' },
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
            montant.appendChild(element('span', 'decl-case-valeur ' + classePlusValue(total.plus_value),
                C.formaterEuros(total.montant_case, { arrondi: true })));
            montant.appendChild(element('span', 'decl-case-exact',
                'montant exact : ' + C.formaterEuros(total.plus_value, { signe: true })));
            carte.appendChild(montant);

            reportContenu.appendChild(carte);
        }

        var faits = element('ul', 'decl-faits');
        [
            [total.cessions > 1 ? total.cessions + ' ventes' : '1 vente', 'à détailler sur le formulaire 2086'],
            [C.formaterEuros(total.prix_cession), 'de ventes, avant frais (total ligne 213)'],
            [C.formaterEuros(total.frais), 'de frais de cession (total ligne 214)'],
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
    function enteteColonne(ligne) {
        var th = element('th', 'cellule-nombre');
        th.scope = 'col';
        th.title = 'Ligne ' + ligne.numero + ' — ' + ligne.libelle;
        th.appendChild(element('span', 'ligne-2086', ligne.numero));
        th.appendChild(element('span', 'ligne-2086-libelle', ligne.court));
        return th;
    }

    function valeurCellule(ligne, cession) {
        var td = element('td', 'cellule-nombre');
        var valeur = cession[ligne.cle];
        if (ligne.cle === 'l211') {
            td.textContent = jourFrancais(valeur);
        } else if (ligne.cle === 'l224') {
            td.className += ' decl-pv ' + classePlusValue(valeur);
            td.textContent = C.formaterEuros(valeur, { arrondi: true, signe: true });
        } else {
            td.textContent = C.formaterEuros(valeur, { arrondi: true });
        }
        return td;
    }

    function rendre2086(donnees) {
        var tete = document.getElementById('tete-2086');
        var corps = document.getElementById('corps-2086');
        var pied = document.getElementById('pied-2086');
        C.vider(tete);
        C.vider(corps);
        C.vider(pied);

        var compteur = document.getElementById('compteur-cessions');
        compteur.textContent = donnees.cessions.length;
        compteur.hidden = !donnees.cessions.length;

        if (!donnees.cessions.length) {
            var vide = element('tr');
            var cellule = element('td', 'pv-vide', 'Aucune vente cette année.');
            cellule.colSpan = LIGNES.length + 1;
            vide.appendChild(cellule);
            corps.appendChild(vide);
            return;
        }

        var ligneTete = element('tr');
        var thVente = element('th', 'decl-vente', 'Vente');
        thVente.scope = 'col';
        ligneTete.appendChild(thVente);
        LIGNES.forEach(function (ligne) { ligneTete.appendChild(enteteColonne(ligne)); });
        tete.appendChild(ligneTete);

        donnees.cessions.forEach(function (cession) {
            var tr = element('tr');
            if (!cession.complet) {
                tr.className = 'decl-incomplete';
                tr.title = cession.reserves.join(' ; ');
            }

            var vente = element('th', 'decl-vente');
            vente.scope = 'row';
            var identite = element('span', 'cellule-identite');
            identite.appendChild(element('span', 'decl-numero', '#' + cession.numero));
            identite.appendChild(C.logoCrypto(cession.id_crypto));
            var nom = element('span', 'decl-vente-texte');
            nom.appendChild(element('span', 'decl-vente-crypto', cession.id_crypto));
            nom.appendChild(element('span', 'decl-vente-quantite', C.formaterQuantite(cession.quantite)));
            identite.appendChild(nom);
            vente.appendChild(identite);
            tr.appendChild(vente);

            LIGNES.forEach(function (ligne) { tr.appendChild(valeurCellule(ligne, cession)); });
            corps.appendChild(tr);
        });

        // Totaux utiles à la déclaration : le seuil d'exonération se lit sur
        // la ligne 213, la case 3AN ou 3BN sur la ligne 224.
        var total = donnees.total;
        var ligneTotal = element('tr', 'decl-total');
        var thTotal = element('th', 'decl-vente', 'Total');
        thTotal.scope = 'row';
        ligneTotal.appendChild(thTotal);
        LIGNES.forEach(function (ligne) {
            var td = element('td', 'cellule-nombre');
            if (ligne.cle === 'l213') td.textContent = C.formaterEuros(total.prix_cession, { arrondi: true });
            else if (ligne.cle === 'l214') td.textContent = C.formaterEuros(total.frais, { arrondi: true });
            else if (ligne.cle === 'l224') {
                td.className += ' decl-pv ' + classePlusValue(total.plus_value);
                td.textContent = C.formaterEuros(total.plus_value, { arrondi: true, signe: true });
                if (total.case) td.title = 'À reporter en case ' + total.case + ' de la 2042-C';
            }
            ligneTotal.appendChild(td);
        });
        pied.appendChild(ligneTotal);
    }

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
