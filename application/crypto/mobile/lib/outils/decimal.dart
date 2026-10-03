// Nombres décimaux exacts, sans jamais passer par un double.
// L'API transmet montants, quantités et cours en chaînes décimales :
// on les garde ainsi, et l'arrondi n'a lieu qu'au moment de l'affichage.

final RegExp _formatSaisie = RegExp(r'^\d+(\.\d+)?$');
final RegExp _formatDecimal = RegExp(r'^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$');

/// Valeur décimale exacte : mantisse entière et nombre de décimales.
class Decimal implements Comparable<Decimal> {
  final BigInt mantisse;
  final int echelle;

  const Decimal._(this.mantisse, this.echelle);

  static final Decimal zero = Decimal._(BigInt.zero, 0);

  /// Lit une chaîne venue de l'API, y compris l'écriture scientifique
  /// (« 1.2e-7 ») que peut produire un cours de marché très faible.
  static Decimal? lire(Object? valeur) {
    if (valeur == null) return null;
    final texte = valeur.toString().trim();
    final morceaux = _formatDecimal.firstMatch(texte);
    if (morceaux == null) return null;

    final entier = morceaux.group(2) ?? '';
    final fraction = morceaux.group(3) ?? '';
    if (entier.isEmpty && fraction.isEmpty) return null;

    var echelle = fraction.length - int.parse(morceaux.group(4) ?? '0');
    var chiffres = BigInt.parse('${entier.isEmpty ? '0' : entier}$fraction');
    if (echelle < 0) {
      chiffres *= BigInt.from(10).pow(-echelle);
      echelle = 0;
    }
    if (morceaux.group(1) == '-') chiffres = -chiffres;
    return Decimal._(chiffres, echelle).simplifier();
  }

  bool get estNegatif => mantisse.isNegative;
  bool get estNul => mantisse == BigInt.zero;
  bool get estPositif => mantisse > BigInt.zero;

  Decimal abs() => Decimal._(mantisse.abs(), echelle);

  /// Retire les zéros inutiles en fin de partie décimale.
  Decimal simplifier() {
    var m = mantisse;
    var e = echelle;
    final dix = BigInt.from(10);
    while (e > 0 && m % dix == BigInt.zero) {
      m ~/= dix;
      e--;
    }
    return Decimal._(m, e);
  }

  /// Arrondi au plus proche (moitié éloignée de zéro), pour l'affichage seulement.
  Decimal arrondir(int decimales) {
    if (echelle <= decimales) return this;
    final diviseur = BigInt.from(10).pow(echelle - decimales);
    final valeurAbsolue = mantisse.abs();
    var quotient = valeurAbsolue ~/ diviseur;
    if ((valeurAbsolue % diviseur) * BigInt.two >= diviseur) quotient += BigInt.one;
    return Decimal._(mantisse.isNegative ? -quotient : quotient, decimales);
  }

  @override
  int compareTo(Decimal autre) {
    final e = echelle > autre.echelle ? echelle : autre.echelle;
    final a = mantisse * BigInt.from(10).pow(e - echelle);
    final b = autre.mantisse * BigInt.from(10).pow(e - autre.echelle);
    return a.compareTo(b);
  }

  bool operator >=(Decimal autre) => compareTo(autre) >= 0;

  Decimal operator +(Decimal autre) {
    final e = echelle > autre.echelle ? echelle : autre.echelle;
    final a = mantisse * BigInt.from(10).pow(e - echelle);
    final b = autre.mantisse * BigInt.from(10).pow(e - autre.echelle);
    return Decimal._(a + b, e).simplifier();
  }

  Decimal operator -() => Decimal._(-mantisse, echelle);

  Decimal operator -(Decimal autre) => this + (-autre);

  Decimal operator *(Decimal autre) =>
      Decimal._(mantisse * autre.mantisse, echelle + autre.echelle).simplifier();

  /// Écriture brute « -1234.5 », telle que l'API l'attend.
  @override
  String toString() {
    final texte = mantisse.abs().toString().padLeft(echelle + 1, '0');
    final signe = mantisse.isNegative ? '-' : '';
    if (echelle == 0) return '$signe$texte';
    final coupure = texte.length - echelle;
    return '$signe${texte.substring(0, coupure)}.${texte.substring(coupure)}';
  }

  /// Conversion approchée, réservée au tracé des graphiques.
  double versGraphique() => double.parse(toString());
}

/// Normalise une saisie utilisateur (virgule ou point, espaces) et renvoie
/// la chaîne décimale attendue par l'API, ou null si elle est invalide.
String? normaliserSaisie(String saisie) {
  final texte = saisie.trim().replaceAll(RegExp(r'[\s  ]'), '').replaceAll(',', '.');
  if (!_formatSaisie.hasMatch(texte)) return null;
  return texte;
}

/// Retire les zéros de fin d'une valeur venue de la base (« 0.500000000000000000 » → « 0.5 »).
String sansZerosInutiles(String? valeur) {
  final decimal = Decimal.lire(valeur);
  return decimal == null ? (valeur ?? '') : decimal.toString();
}
