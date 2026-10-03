import 'package:flutter/material.dart';

import '../api/modeles.dart';
import '../api/session.dart';
import '../composants/chargement.dart';
import '../composants/elements.dart';
import '../outils/format.dart';
import 'ma_crypto.dart';

/// Avoirs valorisés et plus-values de l'année. Les montants du portefeuille
/// sont toujours en euro : c'est la devise de valorisation de l'API.
class EcranPortefeuille extends StatefulWidget {
  final EtatSession session;

  const EcranPortefeuille({super.key, required this.session});

  @override
  State<EcranPortefeuille> createState() => _EcranPortefeuilleState();
}

class _EcranPortefeuilleState extends State<EcranPortefeuille> {
  int _generation = 0;

  Future<Portefeuille> _charger() async {
    _generation++;
    return Portefeuille.json(await widget.session.api.lire('/mon-portefeuille') as Map<String, dynamic>);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Mon portefeuille')),
      body: VueChargee<Portefeuille>(
        charger: _charger,
        construire: (context, portefeuille, _) => ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.only(bottom: 24),
          children: [
            _CarteTotal(portefeuille: portefeuille),
            if (portefeuille.lignes.isEmpty)
              const Padding(
                padding: EdgeInsets.all(24),
                child: Text('Aucune crypto détenue pour le moment.', textAlign: TextAlign.center),
              ),
            for (final ligne in portefeuille.lignes)
              ListTile(
                leading: LogoCrypto(ligne.idCrypto),
                title: Text(ligne.libelle),
                subtitle: Text(
                  '${formaterQuantite(ligne.quantite, ligne.idCrypto)}\n'
                  '${ligne.prix == null ? 'Cours indisponible' : '${formaterCours(ligne.prix, portefeuille.devise)} / ${ligne.idCrypto}'}',
                ),
                isThreeLine: true,
                trailing: Text(
                  formaterMontant(ligne.total, portefeuille.devise),
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
                onTap: () => Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => EcranMaCrypto(session: widget.session, idCrypto: ligne.idCrypto),
                  ),
                ),
              ),
            PlusValuesAnnee(key: ValueKey(_generation), session: widget.session),
          ],
        ),
      ),
    );
  }
}

class _CarteTotal extends StatelessWidget {
  final Portefeuille portefeuille;

  const _CarteTotal({required this.portefeuille});

  @override
  Widget build(BuildContext context) {
    final nombre = portefeuille.lignes.length;
    return Card(
      margin: const EdgeInsets.all(16),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Valeur totale', style: Theme.of(context).textTheme.labelLarge),
            const SizedBox(height: 4),
            Text(
              formaterMontant(portefeuille.total, portefeuille.devise),
              style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 4),
            Text(
              '$nombre crypto${nombre > 1 ? 's' : ''}'
              '${portefeuille.lignesSansCours > 0 ? ' · ${portefeuille.lignesSansCours} sans cours, hors total' : ''}',
            ),
            const SizedBox(height: 8),
            Horodatage(
              source: portefeuille.source,
              releveLe: portefeuille.releveLe,
              indisponible: portefeuille.coursIndisponible,
            ),
          ],
        ),
      ),
    );
  }
}

/// Plus-values d'une année, avec navigation d'une année à l'autre
/// et bascule entre montant en euro et rendement en pourcentage.
class PlusValuesAnnee extends StatefulWidget {
  final EtatSession session;

  const PlusValuesAnnee({super.key, required this.session});

  @override
  State<PlusValuesAnnee> createState() => _PlusValuesAnneeState();
}

class _PlusValuesAnneeState extends State<PlusValuesAnnee> {
  final int _anneeCourante = DateTime.now().year;
  late int _annee = _anneeCourante;
  bool _enPourcentage = false;
  late Future<PlusValues> _futur = _charger();

  Future<PlusValues> _charger() async =>
      PlusValues.json(await widget.session.api.lire('/plus-values', {'annee': _annee}) as Map<String, dynamic>);

  void _changerAnnee(int annee) {
    setState(() {
      _annee = annee;
      _futur = _charger();
    });
  }

  String _valeur(String? plusValue, String? rendement) => _enPourcentage
      ? formaterPourcentage(rendement, signe: true)
      : formaterMontant(plusValue, 'EUR', signe: true);

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<PlusValues>(
      future: _futur,
      builder: (context, instantane) {
        final donnees = instantane.data;
        final premiere = donnees?.premiereAnnee;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TitreSection(
              'Plus-values $_annee',
              action: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  IconButton(
                    tooltip: 'Année précédente',
                    icon: const Icon(Icons.chevron_left),
                    onPressed: premiere != null && _annee > premiere ? () => _changerAnnee(_annee - 1) : null,
                  ),
                  IconButton(
                    tooltip: 'Année suivante',
                    icon: const Icon(Icons.chevron_right),
                    onPressed: _annee < _anneeCourante ? () => _changerAnnee(_annee + 1) : null,
                  ),
                  SegmentedButton<bool>(
                    showSelectedIcon: false,
                    segments: const [
                      ButtonSegment(value: false, label: Text('€')),
                      ButtonSegment(value: true, label: Text('%')),
                    ],
                    selected: {_enPourcentage},
                    onSelectionChanged: (choix) => setState(() => _enPourcentage = choix.first),
                  ),
                ],
              ),
            ),
            if (instantane.connectionState != ConnectionState.done)
              const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()))
            else if (instantane.hasError)
              MessageErreur(erreur: instantane.error!, surReessai: () => _changerAnnee(_annee))
            else
              ..._contenu(context, donnees!),
          ],
        );
      },
    );
  }

  List<Widget> _contenu(BuildContext context, PlusValues pv) {
    final cessions = '${pv.cessions} cession${pv.cessions > 1 ? 's' : ''}'
        '${pv.ventesSimulees > 0 ? ' · ${pv.ventesSimulees} simulée${pv.ventesSimulees > 1 ? 's' : ''}' : ''}';
    final reserves = pv.cryptos.expand((c) => c.reserves).toSet();

    return [
      ListTile(
        title: Row(
          children: [
            const Text('Total'),
            if (pv.estimation) ...[
              const SizedBox(width: 8),
              const Chip(label: Text('Estimées'), visualDensity: VisualDensity.compact),
            ],
          ],
        ),
        subtitle: Text(cessions),
        trailing: Text(
          _valeur(pv.plusValue, pv.rendement),
          style: TextStyle(fontWeight: FontWeight.bold, color: couleurSigne(pv.plusValue)),
        ),
      ),
      for (final crypto in pv.cryptos)
        ListTile(
          leading: LogoCrypto(crypto.idCrypto, taille: 28),
          title: Text(crypto.libelle),
          subtitle: Text(
            '${formaterMontant(crypto.prixCession, 'EUR')} '
            '${crypto.venteSimulee ? 'au cours actuel' : 'cédés'}',
          ),
          trailing: Text(
            _valeur(crypto.plusValue, crypto.rendement),
            style: TextStyle(color: couleurSigne(crypto.plusValue)),
          ),
        ),
      if (pv.cryptos.isEmpty)
        const Padding(
          padding: EdgeInsets.all(16),
          child: Text('Aucune cession sur cette année.', textAlign: TextAlign.center),
        ),
      if (pv.estimation)
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          child: Text('Les avoirs encore détenus sont estimés comme s\'ils étaient vendus au cours actuel.'),
        ),
      if (!pv.complet && reserves.isNotEmpty)
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          child: Text('Calcul incomplet : ${reserves.join(' ; ')}', style: const TextStyle(color: couleurPerte)),
        ),
      if (pv.operationsStaking > 0)
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          child: Text(
            'Staking : ${pv.operationsStaking} opération${pv.operationsStaking > 1 ? 's' : ''}, '
            'acquises ${pv.conventionStaking == 'nulle' ? 'à coût nul' : 'à la valeur reçue'}.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ),
    ];
  }
}
