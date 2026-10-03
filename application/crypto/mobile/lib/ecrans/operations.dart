import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/modeles.dart';
import '../api/session.dart';
import '../composants/chargement.dart';
import '../composants/elements.dart';
import '../outils/format.dart';
import 'operation_edition.dart';

/// Liste paginée des opérations, filtrable par année et par type.
class EcranOperations extends StatefulWidget {
  final EtatSession session;

  const EcranOperations({super.key, required this.session});

  @override
  State<EcranOperations> createState() => _EcranOperationsState();
}

class _EcranOperationsState extends State<EcranOperations> {
  static const int _taille = 20;

  final _defilement = ScrollController();
  final List<Operation> _lignes = [];
  List<int> _annees = const [];
  int? _annee;
  String? _type;
  int _page = 0;
  int _pages = 1;
  int _total = 0;
  bool _enCours = false;
  Object? _erreur;

  @override
  void initState() {
    super.initState();
    _defilement.addListener(() {
      if (_defilement.position.extentAfter < 400) _chargerSuite();
    });
    _recharger();
  }

  @override
  void dispose() {
    _defilement.dispose();
    super.dispose();
  }

  // Un changement de filtre invalide les pages encore en route
  int _requete = 0;

  Future<void> _recharger() async {
    final requete = ++_requete;
    setState(() {
      _lignes.clear();
      _page = 0;
      _pages = 1;
      _enCours = false;
      _erreur = null;
    });
    try {
      final annees = await widget.session.api.lire('/operations/annees') as List;
      if (mounted && requete == _requete) setState(() => _annees = annees.cast<int>());
    } on ErreurApi catch (e) {
      if (mounted && requete == _requete) setState(() => _erreur = e);
      return;
    }
    await _chargerSuite();
  }

  Future<void> _chargerSuite() async {
    if (_enCours || _page >= _pages || _erreur != null) return;
    final requete = _requete;
    setState(() => _enCours = true);
    try {
      final page = PageOperations.json(await widget.session.api.lire('/operations', {
        'annee': _annee,
        'type': _type,
        'page': _page + 1,
        'taille': _taille,
      }) as Map<String, dynamic>);
      if (!mounted || requete != _requete) return;
      setState(() {
        _lignes.addAll(page.lignes);
        _page = page.page;
        _pages = page.pages;
        _total = page.total;
        _erreur = null;
      });
    } on ErreurApi catch (e) {
      if (mounted && requete == _requete) setState(() => _erreur = e);
    } finally {
      if (mounted && requete == _requete) setState(() => _enCours = false);
    }
  }

  Future<void> _editer([Operation? operation]) async {
    final modifie = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => EcranOperationEdition(session: widget.session, operation: operation)),
    );
    if (modifie == true) _recharger();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Opérations')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _editer(),
        icon: const Icon(Icons.add),
        label: const Text('Ajouter'),
      ),
      body: Column(
        children: [
          _filtres(),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _recharger,
              child: ListView.builder(
                controller: _defilement,
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.only(bottom: 88),
                itemCount: _lignes.length + 1,
                itemBuilder: (context, index) {
                  if (index < _lignes.length) return _ligne(_lignes[index]);
                  if (_erreur != null) return MessageErreur(erreur: _erreur!, surReessai: _recharger);
                  if (_enCours) {
                    return const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()));
                  }
                  return Padding(
                    padding: const EdgeInsets.all(16),
                    child: Text(
                      _total == 0 ? 'Aucune opération.' : '$_total opération${_total > 1 ? 's' : ''}',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _filtres() {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 4),
      child: Row(
        children: [
          DropdownButton<int?>(
            value: _annee,
            underline: const SizedBox.shrink(),
            items: [
              const DropdownMenuItem(value: null, child: Text('Toutes les années')),
              for (final annee in _annees) DropdownMenuItem(value: annee, child: Text('$annee')),
            ],
            onChanged: (annee) {
              _annee = annee;
              _recharger();
            },
          ),
          const SizedBox(width: 8),
          for (final type in typesOperation)
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: FilterChip(
                label: Text(libelleType(type)),
                selected: _type == type,
                onSelected: (choisi) {
                  _type = choisi ? type : null;
                  _recharger();
                },
              ),
            ),
        ],
      ),
    );
  }

  Widget _ligne(Operation operation) {
    return ListTile(
      leading: LogoCrypto(operation.idCrypto),
      title: Text('${libelleType(operation.type)} · ${formaterQuantite(operation.quantite, operation.idCrypto)}'),
      subtitle: Text(
        '${formaterDateHeure(operation.horodatage)}'
        '${operation.plateforme == null ? '' : ' · ${operation.plateforme}'}',
      ),
      trailing: Text(
        operation.montant == null ? '—' : formaterMontant(operation.montant, 'EUR', signe: true),
        style: TextStyle(fontWeight: FontWeight.w600, color: couleurSigne(operation.montant)),
      ),
      onTap: () => _editer(operation),
    );
  }
}
