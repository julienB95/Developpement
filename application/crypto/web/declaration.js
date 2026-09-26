// Déclaration fiscale : les plus-values de cession année par année, présentées
// comme le bloc « Mes plus-values » de l'accueil. Chaque année ouvre la synthèse
// de ce qu'il faut reporter sur la déclaration de revenus.
//
// Page réservée aux administrateurs. La route vérifie le droit elle-même :
// renvoyer un visiteur vers l'accueil ne sert qu'à lui éviter une page vide.
(function () {
    'use strict';

    var C = window.Crypto;

    var contenu = document.getElementById('annees-contenu');
    var erreurPage = document.getElementById('erreur-page');

    function message(texte, classe) {
        C.vider(contenu);
        var p = document.createElement('p');
        p.className = classe || 'pv-vide';
        p.textContent = texte;
        contenu.appendChild(p);
    }

    function classePlusValue(montant) {
        if (montant === null || montant === undefined) return '';
        return String(montant).charAt(0) === '-' ? 'pv-perte' : 'pv-gain';
    }

    function ligneAnnee(annee) {
        var item = document.createElement('li');
        item.className = 'pv-ligne decl-annee';

        var repere = document.createElement('span');
        repere.className = 'decl-annee-repere';
        repere.textContent = annee.annee;
        item.appendChild(repere);

        var texte = document.createElement('span');
        texte.className = 'pv-texte';

        var libelle = document.createElement('span');
        libelle.className = 'pv-libelle';
        libelle.textContent = 'Revenus ' + annee.annee;

        var detail = document.createElement('span');
        detail.className = 'pv-detail';
        detail.textContent = (annee.cessions > 1 ? annee.cessions + ' ventes' : '1 vente')
            + ' · ' + C.formaterEuros(annee.prix_cession) + ' cédés'
            + ' · à déclarer en ' + (annee.annee + 1);

        texte.appendChild(libelle);
        texte.appendChild(detail);
        item.appendChild(texte);

        var droite = document.createElement('span');
        droite.className = 'decl-annee-droite';

        var montant = document.createElement('span');
        montant.className = 'pv-montant ' + classePlusValue(annee.plus_value);
        montant.textContent = C.formaterEuros(annee.plus_value, { signe: true });
        if (!annee.complet) {
            montant.title = 'Chiffre à vérifier : certaines ventes ne sont pas entièrement calculées';
            montant.textContent += ' *';
        }
        droite.appendChild(montant);

        var bouton = document.createElement('a');
        bouton.className = 'bouton bouton-discret bouton-petit';
        bouton.href = '/declaration-annee.html?annee=' + encodeURIComponent(annee.annee);
        bouton.textContent = 'Voir la déclaration';
        droite.appendChild(bouton);

        item.appendChild(droite);
        return item;
    }

    function rendre(donnees) {
        if (!donnees.annees.length) {
            return message('Aucune vente enregistrée : aucune plus-value à déclarer.');
        }

        C.vider(contenu);
        var liste = document.createElement('ul');
        liste.className = 'liste-pv';
        donnees.annees.forEach(function (annee) { liste.appendChild(ligneAnnee(annee)); });
        contenu.appendChild(liste);

        if (donnees.annees.some(function (annee) { return !annee.complet; })) {
            var alerte = document.createElement('p');
            alerte.className = 'pv-reserve';
            alerte.textContent = '* Chiffre à vérifier : le détail de l’année indique les ventes concernées.';
            contenu.appendChild(alerte);
        }
    }

    // --- Démarrage --------------------------------------------------------
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
            C.afficherCompte(compte, { masquerDeclaration: true });
            if (window.Marche) window.Marche.appliquer(true);
            return C.appeler('/administration/declaration').then(rendre);
        })
        .catch(function (erreur) {
            if (erreur.code === 401) {
                C.effacerJeton();
                window.location.href = '/';
                return;
            }
            message('Déclaration indisponible : ' + erreur.message, 'pv-reserve');
            erreurPage.hidden = true;
        });
})();
