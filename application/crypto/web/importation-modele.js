// Page « Modèle » : le détail des colonnes attendues, servi par l'API pour que
// le tableau affiché et le fichier téléchargé ne puissent pas diverger.
// Le téléchargement lui-même est un lien ordinaire vers /importation/modele.
(function () {
    'use strict';

    var C = window.Crypto;
    var corpsTableau = document.getElementById('colonnes-modele');

    function cellule(contenu, classe) {
        var td = document.createElement('td');
        if (classe) td.className = classe;
        if (contenu) td.appendChild(contenu);
        return td;
    }

    function texte(valeur, balise, classe) {
        var element = document.createElement(balise || 'span');
        if (classe) element.className = classe;
        element.textContent = valeur;
        return element;
    }

    function rendreColonnes(colonnes) {
        C.vider(corpsTableau);

        colonnes.forEach(function (colonne) {
            var rangee = document.createElement('tr');

            rangee.appendChild(cellule(texte(colonne.colonne, 'code')));

            rangee.appendChild(cellule(texte(
                colonne.obligatoire ? 'Oui' : 'Non',
                'span',
                'etiquette-sens ' + (colonne.obligatoire ? 'etiquette-requis' : 'etiquette-libre')
            )));

            var exemple = document.createElement('td');
            exemple.appendChild(texte(colonne.exemple, 'code'));
            if (colonne.liste) {
                exemple.appendChild(texte('liste déroulante', 'span', 'colonne-alias'));
            }
            rangee.appendChild(exemple);

            var aide = document.createElement('td');
            aide.appendChild(texte(colonne.aide, 'span'));

            // Les autres en-têtes acceptés : un fichier venant d'ailleurs passe
            // souvent sans être renommé colonne par colonne.
            var autres = colonne.alias.slice(1);
            if (autres.length) {
                aide.appendChild(texte(
                    'Accepté aussi : ' + autres.join(', ') + '.',
                    'span',
                    'colonne-alias'
                ));
            }
            rangee.appendChild(aide);

            corpsTableau.appendChild(rangee);
        });
    }

    C.pageConnectee(function () {
        document.getElementById('zone-modele').hidden = false;
        return C.appeler('/importation/colonnes').then(rendreColonnes);
    });
})();
