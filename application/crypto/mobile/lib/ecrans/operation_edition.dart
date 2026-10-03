import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/modeles.dart';
import '../api/session.dart';
import '../composants/chargement.dart';
import '../composants/elements.dart';
import '../outils/decimal.dart';
import '../outils/format.dart';

class _Referentiels {
  final List<CryptoRef> cryptos;
  final List<Plateforme> plateformes;

  const _Referentiels(this.cryptos, this.plateformes);
}

/// Saisie ou modification d'une opération. On saisit le prix unitaire réellement
/// payé ou encaissé et les frais totaux : le montant est calculé par l'API.
class EcranOperationEdition extends StatelessWidget {
  final EtatSession session;
  final Operation? operation;

  const EcranOperationEdition({super.key, required this.session, this.operation});

  Future<_Referentiels> _charger() async {
    final reponses = await Future.wait([session.api.lire('/cryptos'), session.api.lire('/plateformes')]);
    return _Referentiels(
      (reponses[0] as List).cast<Map<String, dynamic>>().map(CryptoRef.json).toList(),
      (reponses[1] as List).cast<Map<String, dynamic>>().map(Plateforme.json).toList(),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(operation == null ? 'Nouvelle opération' : 'Modifier l\'opération')),
      body: VueChargee<_Referentiels>(
        charger: _charger,
        construire: (context, referentiels, _) => _Formulaire(
          session: session,
          operation: operation,
          referentiels: referentiels,
        ),
      ),
    );
  }
}

class _Formulaire extends StatefulWidget {
  final EtatSession session;
  final Operation? operation;
  final _Referentiels referentiels;

  const _Formulaire({required this.session, required this.operation, required this.referentiels});

  @override
  State<_Formulaire> createState() => _FormulaireState();
}

class _FormulaireState extends State<_Formulaire> {
  final _cle = GlobalKey<FormState>();
  late final TextEditingController _quantite;
  late final TextEditingController _prix;
  late final TextEditingController _frais;
  late String _type;
  String? _crypto;
  String? _plateforme;
  late DateTime _date;
  bool _enCours = false;

  bool get _creation => widget.operation == null;

  // En création, seuls les cryptos suivies et les plateformes actives sont proposées
  List<CryptoRef> get _cryptos =>
      widget.referentiels.cryptos.where((c) => !_creation || c.estSuivi || c.id == _crypto).toList();

  List<Plateforme> get _plateformes =>
      widget.referentiels.plateformes.where((p) => !_creation || p.estActif || p.libelle == _plateforme).toList();

  @override
  void initState() {
    super.initState();
    final op = widget.operation;
    _type = op?.type ?? 'achat';
    _crypto = op?.idCrypto;
    _date = lireDate(op?.horodatage) ?? DateTime.now();
    _quantite = TextEditingController(text: op == null ? '' : sansZerosInutiles(op.quantite));
    _prix = TextEditingController(text: op?.prixUnitaire == null ? '' : sansZerosInutiles(op!.prixUnitaire));
    _frais = TextEditingController(text: op == null ? '' : sansZerosInutiles(op.frais));

    if (op != null) {
      _plateforme = op.plateforme;
    } else {
      final defaut = widget.session.compte?.plateformeDefaut;
      if (_plateformes.any((p) => p.libelle == defaut)) _choisirPlateforme(defaut);
    }
    for (final champ in [_quantite, _prix, _frais]) {
      champ.addListener(() => setState(() {}));
    }
  }

  @override
  void dispose() {
    _quantite.dispose();
    _prix.dispose();
    _frais.dispose();
    super.dispose();
  }

  void _choisirPlateforme(String? libelle) {
    _plateforme = libelle;
    if (!_creation || _type == 'staking') return;
    final frais = widget.referentiels.plateformes.where((p) => p.libelle == libelle).firstOrNull?.fraisDefaut;
    if (frais != null) _frais.text = sansZerosInutiles(frais);
  }

  Future<void> _choisirDate() async {
    final jour = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(2009),
      lastDate: DateTime.now(),
    );
    if (jour == null || !mounted) return;
    final heure = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(_date));
    if (!mounted) return;
    setState(() {
      _date = DateTime(jour.year, jour.month, jour.day, heure?.hour ?? _date.hour, heure?.minute ?? _date.minute);
    });
  }

  /// Aperçu du montant, calculé comme l'API : décimaux exacts, signe selon le sens.
  String? _apercu() {
    if (_type == 'staking') return null;
    final quantite = Decimal.lire(normaliserSaisie(_quantite.text));
    final prix = Decimal.lire(normaliserSaisie(_prix.text));
    final frais = Decimal.lire(normaliserSaisie(_frais.text.isEmpty ? '0' : _frais.text));
    if (quantite == null || prix == null || frais == null) return null;
    final brut = quantite * prix;
    return (_type == 'achat' ? -(brut + frais) : brut - frais).toString();
  }

  String? _validerDecimal(String? saisie, {bool requis = true, bool positif = false}) {
    if (saisie == null || saisie.trim().isEmpty) return requis ? 'Valeur requise' : null;
    final valeur = normaliserSaisie(saisie);
    if (valeur == null) return 'Nombre invalide (ex. 0,25)';
    if (positif && !Decimal.lire(valeur)!.estPositif) return 'Doit être supérieur à zéro';
    return null;
  }

  Future<void> _enregistrer() async {
    if (!_cle.currentState!.validate()) return;
    final prix = _prix.text.trim().isEmpty ? null : normaliserSaisie(_prix.text);
    final corps = {
      'type': _type,
      'id_crypto': _crypto,
      'quantite': normaliserSaisie(_quantite.text),
      'prix_unitaire': prix,
      'frais': _type == 'staking' ? '0' : (normaliserSaisie(_frais.text.isEmpty ? '0' : _frais.text)),
      'horodatage': _date.toUtc().toIso8601String(),
      'plateforme': _plateforme,
    };

    setState(() => _enCours = true);
    try {
      if (_creation) {
        await widget.session.api.creer('/operations', corps);
      } else {
        await widget.session.api.modifier('/operations/${widget.operation!.id}', corps);
      }
      if (mounted) Navigator.pop(context, true);
    } on ErreurApi catch (e) {
      if (mounted) signalerErreur(context, e);
    } finally {
      if (mounted) setState(() => _enCours = false);
    }
  }

  Future<void> _supprimer() async {
    final confirme = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Supprimer l\'opération ?'),
        content: const Text('Cette suppression est définitive et modifie le calcul des plus-values.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Annuler')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Supprimer')),
        ],
      ),
    );
    if (confirme != true || !mounted) return;

    setState(() => _enCours = true);
    try {
      await widget.session.api.supprimer('/operations/${widget.operation!.id}');
      if (mounted) Navigator.pop(context, true);
    } on ErreurApi catch (e) {
      if (mounted) signalerErreur(context, e);
    } finally {
      if (mounted) setState(() => _enCours = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final apercu = _apercu();
    const espace = SizedBox(height: 16);
    const clavier = TextInputType.numberWithOptions(decimal: true);

    return Form(
      key: _cle,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          SegmentedButton<String>(
            segments: [
              for (final type in typesOperation) ButtonSegment(value: type, label: Text(libelleType(type))),
            ],
            selected: {_type},
            onSelectionChanged: (choix) => setState(() {
              _type = choix.first;
              if (_type == 'staking') _frais.text = '0';
            }),
          ),
          espace,
          DropdownButtonFormField<String>(
            initialValue: _crypto,
            decoration: const InputDecoration(labelText: 'Crypto', border: OutlineInputBorder()),
            items: [
              for (final crypto in _cryptos)
                DropdownMenuItem(value: crypto.id, child: Text('${crypto.libelle} (${crypto.id})')),
            ],
            onChanged: (valeur) => setState(() => _crypto = valeur),
            validator: (valeur) => valeur == null ? 'Choisis une crypto' : null,
          ),
          espace,
          InkWell(
            onTap: _choisirDate,
            child: InputDecorator(
              decoration: const InputDecoration(labelText: 'Date et heure', border: OutlineInputBorder()),
              child: Text('${formaterDate(_date)} à ${formaterHeure(_date)}'),
            ),
          ),
          espace,
          TextFormField(
            controller: _quantite,
            keyboardType: clavier,
            decoration: InputDecoration(
              labelText: 'Quantité',
              suffixText: _crypto,
              border: const OutlineInputBorder(),
            ),
            validator: (v) => _validerDecimal(v, positif: true),
          ),
          espace,
          TextFormField(
            controller: _prix,
            keyboardType: clavier,
            decoration: InputDecoration(
              labelText: 'Prix unitaire',
              helperText: 'Le prix réellement payé ou encaissé, pas le cours du marché',
              suffixText: '€',
              border: const OutlineInputBorder(),
            ),
            validator: (v) => _validerDecimal(v, requis: _type != 'staking'),
          ),
          espace,
          TextFormField(
            controller: _frais,
            enabled: _type != 'staking',
            keyboardType: clavier,
            decoration: InputDecoration(
              labelText: 'Frais totaux',
              helperText: _type == 'staking' ? 'Une opération de staking ne porte pas de frais' : null,
              suffixText: '€',
              border: const OutlineInputBorder(),
            ),
            validator: (v) => _validerDecimal(v, requis: false),
          ),
          espace,
          DropdownButtonFormField<String?>(
            initialValue: _plateforme,
            decoration: const InputDecoration(labelText: 'Plateforme', border: OutlineInputBorder()),
            items: [
              const DropdownMenuItem(value: null, child: Text('Aucune')),
              for (final plateforme in _plateformes)
                DropdownMenuItem(value: plateforme.libelle, child: Text(plateforme.libelle)),
            ],
            onChanged: (valeur) => setState(() => _choisirPlateforme(valeur)),
          ),
          if (apercu != null) ...[
            espace,
            LigneValeur('Montant', formaterMontant(apercu, 'EUR', signe: true), couleur: couleurSigne(apercu)),
          ],
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _enCours ? null : _enregistrer,
            child: Text(_creation ? 'Enregistrer l\'opération' : 'Enregistrer les modifications'),
          ),
          if (!_creation) ...[
            const SizedBox(height: 8),
            TextButton.icon(
              onPressed: _enCours ? null : _supprimer,
              icon: const Icon(Icons.delete_outline),
              label: const Text('Supprimer'),
              style: TextButton.styleFrom(foregroundColor: Theme.of(context).colorScheme.error),
            ),
          ],
        ],
      ),
    );
  }
}
