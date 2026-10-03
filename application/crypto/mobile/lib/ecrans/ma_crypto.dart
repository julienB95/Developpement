import 'package:flutter/material.dart';

import '../api/modeles.dart';
import '../api/session.dart';
import '../composants/chargement.dart';
import '../composants/elements.dart';
import '../composants/graphique.dart';
import '../outils/format.dart';

/// Détail d'une crypto détenue : position, prix de revient, performance et cours.
class EcranMaCrypto extends StatelessWidget {
  final EtatSession session;
  final String idCrypto;

  const EcranMaCrypto({super.key, required this.session, required this.idCrypto});

  Future<DetailCrypto> _charger() async => DetailCrypto.json(
        await session.api.lire('/mon-portefeuille/${Uri.encodeComponent(idCrypto)}') as Map<String, dynamic>,
      );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(idCrypto)),
      body: VueChargee<DetailCrypto>(
        charger: _charger,
        construire: (context, d, _) => ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.only(bottom: 24),
          children: [
            ListTile(
              leading: LogoCrypto(d.idCrypto, taille: 44),
              title: Text(d.libelle, style: Theme.of(context).textTheme.titleLarge),
              subtitle: Text('${d.operations} opération${d.operations > 1 ? 's' : ''}'),
            ),
            const TitreSection('Ma position'),
            LigneValeur('Quantité détenue', formaterQuantite(d.quantite, d.idCrypto)),
            LigneValeur('Coût d\'acquisition', formaterMontant(d.coutAcquisition, d.devise)),
            LigneValeur('Prix moyen d\'achat', formaterCours(d.prixMoyen, d.devise)),
            LigneValeur('Valeur actuelle', formaterMontant(d.valeur, d.devise)),
            LigneValeur(
              'Plus ou moins-value latente',
              formaterMontant(d.performance, d.devise, signe: true),
              couleur: couleurSigne(d.performance),
            ),
            LigneValeur(
              'Performance',
              formaterPourcentage(d.performancePourcentage, signe: true),
              couleur: couleurSigne(d.performancePourcentage),
            ),
            const TitreSection('Cours'),
            LigneValeur('Cours actuel', formaterCours(d.cours, d.devise)),
            LigneValeur(
              'Variation sur 24 h',
              formaterVariation(d.variation24h),
              couleur: couleurSigne(d.variation24h),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              child: Horodatage(source: d.source, releveLe: d.releveLe, indisponible: d.coursIndisponible),
            ),
            if (d.identifiantCoingecko != null) ...[
              const TitreSection('Historique'),
              GraphiqueHistorique(api: session.api, actif: d.identifiantCoingecko!, devise: d.devise),
            ],
          ],
        ),
      ),
    );
  }
}
