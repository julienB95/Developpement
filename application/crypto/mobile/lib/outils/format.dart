import 'decimal.dart';

// Mise en forme à la française. L'arrondi ne se fait qu'ici, au dernier moment,
// et toute valeur monétaire porte son symbole.

const String _espaceFine = ' ';
const Map<String, String> _symboles = {'EUR': '€', 'USD': r'$'};

String symboleDevise(String devise) => _symboles[devise.toUpperCase()] ?? devise.toUpperCase();

String _separerMilliers(String entier) {
  final morceaux = <String>[];
  for (var fin = entier.length; fin > 0; fin -= 3) {
    morceaux.insert(0, entier.substring(fin - 3 < 0 ? 0 : fin - 3, fin));
  }
  return morceaux.join(_espaceFine);
}

/// « 1 234,56 » : décimales fixes, ou seulement les chiffres significatifs.
String _ecrire(Decimal valeur, {int? decimales, bool signePlus = false}) {
  final arrondi = decimales == null ? valeur.simplifier() : valeur.arrondir(decimales);
  final brut = arrondi.abs().toString();
  final morceaux = brut.split('.');
  var partieDecimale = morceaux.length > 1 ? morceaux[1] : '';
  if (decimales != null) partieDecimale = partieDecimale.padRight(decimales, '0');

  final signe = valeur.estNegatif ? '-' : (signePlus ? '+' : '');
  final texte = _separerMilliers(morceaux[0]);
  return partieDecimale.isEmpty ? '$signe$texte' : '$signe$texte,$partieDecimale';
}

/// Montant en devise, au centime par défaut. [signe] écrit le « + » d'un gain ;
/// une perte minuscule arrondie à zéro garde son « - » : le signe vient de la chaîne.
String formaterMontant(Object? valeur, String devise, {int decimales = 2, bool signe = false}) {
  final decimal = Decimal.lire(valeur);
  if (decimal == null) return '—';
  return '${_ecrire(decimal, decimales: decimales, signePlus: signe)}$_espaceFine${symboleDevise(devise)}';
}

/// Cours unitaire : les cryptos à faible valeur ont besoin de plus de décimales.
String formaterCours(Object? valeur, String devise) {
  final decimal = Decimal.lire(valeur);
  if (decimal == null) return '—';
  final absolu = decimal.abs();
  final decimales = absolu >= Decimal.lire('100')! ? 0 : (absolu >= Decimal.lire('1')! ? 2 : 6);
  return formaterMontant(decimal.toString(), devise, decimales: decimales);
}

/// Quantité de crypto, jamais arrondie : tous les chiffres significatifs restent.
String formaterQuantite(Object? valeur, [String? symbole]) {
  final decimal = Decimal.lire(valeur);
  if (decimal == null) return '—';
  final texte = _ecrire(decimal);
  return symbole == null ? texte : '$texte$_espaceFine$symbole';
}

String formaterPourcentage(Object? valeur, {bool signe = false}) {
  final decimal = Decimal.lire(valeur);
  if (decimal == null) return '—';
  return '${_ecrire(decimal, decimales: 2, signePlus: signe)}$_espaceFine%';
}

String formaterVariation(num? valeur) {
  if (valeur == null) return '—';
  return formaterPourcentage(valeur.toStringAsFixed(2), signe: true);
}

// --- Dates : reçues en UTC, affichées dans le fuseau du téléphone ---------

const List<String> _mois = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
];

DateTime? lireDate(String? iso) {
  if (iso == null || iso.isEmpty) return null;
  return DateTime.tryParse(iso)?.toLocal();
}

String _deuxChiffres(int n) => n.toString().padLeft(2, '0');

String formaterDate(DateTime? date) {
  if (date == null) return '—';
  return '${_deuxChiffres(date.day)} ${_mois[date.month - 1]} ${date.year}';
}

String formaterHeure(DateTime date) => '${_deuxChiffres(date.hour)}:${_deuxChiffres(date.minute)}';

String formaterDateHeure(String? iso) {
  final date = lireDate(iso);
  if (date == null) return '—';
  return '${formaterDate(date)} à ${formaterHeure(date)}';
}
