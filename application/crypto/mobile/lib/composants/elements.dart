import 'package:flutter/material.dart';

import '../config.dart';
import '../outils/decimal.dart';
import '../outils/format.dart';

const Color couleurGain = Color(0xFF1B7F3B);
const Color couleurPerte = Color(0xFFC0392B);

/// Couleur d'une valeur signée : le signe vient de la chaîne décimale.
Color? couleurSigne(Object? valeur) {
  final decimal = Decimal.lire(valeur);
  if (decimal == null || decimal.estNul) return null;
  return decimal.estNegatif ? couleurPerte : couleurGain;
}

/// Logo d'une crypto, servi par l'API ; pastille avec le symbole en repli.
class LogoCrypto extends StatelessWidget {
  final String idCrypto;
  final double taille;

  const LogoCrypto(this.idCrypto, {super.key, this.taille = 32});

  @override
  Widget build(BuildContext context) {
    final repli = CircleAvatar(
      radius: taille / 2,
      backgroundColor: Theme.of(context).colorScheme.primaryContainer,
      child: Text(
        idCrypto.length > 3 ? idCrypto.substring(0, 3) : idCrypto,
        style: TextStyle(fontSize: taille / 3.2, fontWeight: FontWeight.bold),
      ),
    );
    return ClipOval(
      child: Image.network(
        '$adresseApi$cheminApi/cryptos/${Uri.encodeComponent(idCrypto)}/logo',
        width: taille,
        height: taille,
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) => repli,
      ),
    );
  }
}

/// Horodatage obligatoire de toute donnée de marché, avec un avertissement
/// quand l'API a servi une valeur périmée faute de source joignable.
class Horodatage extends StatelessWidget {
  final String? source;
  final String? releveLe;
  final String? provenance;
  final String? indisponible;

  const Horodatage({super.key, this.source, this.releveLe, this.provenance, this.indisponible});

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme.bodySmall;
    if (indisponible != null) {
      return Text('Cours indisponibles : $indisponible', style: style?.copyWith(color: couleurPerte));
    }
    if (releveLe == null) return const SizedBox.shrink();
    final perime = provenance == 'cache_perime';
    return Text(
      'Cours ${source ?? ''} du ${formaterDateHeure(releveLe)}'
      '${perime ? ' — source injoignable, dernière valeur connue' : ''}',
      style: perime ? style?.copyWith(color: couleurPerte) : style,
    );
  }
}

class TitreSection extends StatelessWidget {
  final String texte;
  final Widget? action;

  const TitreSection(this.texte, {super.key, this.action});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 20, 8, 8),
      child: Row(
        children: [
          Expanded(child: Text(texte, style: Theme.of(context).textTheme.titleMedium)),
          ?action,
        ],
      ),
    );
  }
}

/// Ligne « libellé : valeur » des écrans de détail.
class LigneValeur extends StatelessWidget {
  final String libelle;
  final String valeur;
  final Color? couleur;

  const LigneValeur(this.libelle, this.valeur, {super.key, this.couleur});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Row(
        children: [
          Expanded(child: Text(libelle)),
          Text(valeur, style: TextStyle(fontWeight: FontWeight.w600, color: couleur)),
        ],
      ),
    );
  }
}
