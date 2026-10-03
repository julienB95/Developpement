import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/modeles.dart';
import '../outils/decimal.dart';
import '../outils/format.dart';
import 'chargement.dart';
import 'elements.dart';

/// Période proposée. L'API ne connaît que des jours entiers : la dernière heure
/// est extraite de l'historique sur 24 h, échantillonné toutes les cinq minutes.
class _Periode {
  final String libelle;
  final int jours;
  final Duration? limite;

  const _Periode(this.libelle, this.jours, [this.limite]);
}

const List<_Periode> _periodes = [
  _Periode('1 h', 1, Duration(hours: 1)),
  _Periode('24 h', 1),
  _Periode('7 j', 7),
  _Periode('1 mois', 30),
  _Periode('3 mois', 90),
  _Periode('1 an', 365),
];

/// Historique du cours d'une crypto, avec choix de la période.
/// [actif] est l'identifiant CoinGecko (« bitcoin »), pas le symbole.
class GraphiqueHistorique extends StatefulWidget {
  final ClientApi api;
  final String actif;
  final String devise;

  const GraphiqueHistorique({super.key, required this.api, required this.actif, required this.devise});

  @override
  State<GraphiqueHistorique> createState() => _GraphiqueHistoriqueState();
}

class _GraphiqueHistoriqueState extends State<GraphiqueHistorique> {
  _Periode _periode = _periodes[1]; // 24 h, comme sur le site
  late Future<Historique> _futur = _charger();

  Future<Historique> _charger() async => Historique.json(await widget.api.lire(
        '/marche/historique/${Uri.encodeComponent(widget.actif)}',
        {'jours': _periode.jours, 'devise': widget.devise},
      ) as Map<String, dynamic>);

  void _choisir(_Periode periode) {
    final memesDonnees = periode.jours == _periode.jours;
    setState(() {
      _periode = periode;
      // 1 h et 24 h partagent le même historique : inutile de le redemander
      if (!memesDonnees) _futur = _charger();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Row(
            children: [
              for (final periode in _periodes)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: ChoiceChip(
                    label: Text(periode.libelle),
                    selected: identical(_periode, periode),
                    onSelected: (_) => _choisir(periode),
                  ),
                ),
            ],
          ),
        ),
        SizedBox(
          height: 220,
          child: FutureBuilder<Historique>(
            future: _futur,
            builder: (context, instantane) {
              if (instantane.connectionState != ConnectionState.done) {
                return const Center(child: CircularProgressIndicator());
              }
              if (instantane.hasError) {
                return MessageErreur(
                  erreur: instantane.error!,
                  surReessai: () => setState(() => _futur = _charger()),
                );
              }
              return _Courbe(historique: instantane.data!, limite: _periode.limite);
            },
          ),
        ),
      ],
    );
  }
}

class _Courbe extends StatelessWidget {
  final Historique historique;
  final Duration? limite;

  const _Courbe({required this.historique, this.limite});

  /// Garde la fin de l'historique, mesurée depuis le dernier point reçu
  /// (et non depuis l'heure du téléphone, pour rester juste avec un cache).
  List<PointHistorique> _points() {
    final tous = historique.points;
    if (limite == null || tous.isEmpty) return tous;
    final depuis = lireDate(tous.last.horodatage)!.subtract(limite!);
    return tous.where((point) => !lireDate(point.horodatage)!.isBefore(depuis)).toList();
  }

  @override
  Widget build(BuildContext context) {
    final points = _points();
    if (points.length < 2) {
      return const Center(child: Text('Pas assez de points pour tracer la courbe.'));
    }

    // Le graphique travaille en double : c'est de l'affichage, jamais un calcul conservé
    final debut = lireDate(points.first.horodatage)!.millisecondsSinceEpoch.toDouble();
    final spots = [
      for (final point in points)
        FlSpot(
          (lireDate(point.horodatage)!.millisecondsSinceEpoch - debut) / 3600000,
          Decimal.lire(point.prix)!.versGraphique(),
        ),
    ];
    final evolution = Decimal.lire(points.last.prix)! - Decimal.lire(points.first.prix)!;
    final couleur = evolution.estNegatif ? couleurPerte : couleurGain;

    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 12, 16, 0),
      child: Column(
        children: [
          Expanded(
            child: LineChart(
              LineChartData(
                gridData: const FlGridData(show: false),
                borderData: FlBorderData(show: false),
                titlesData: const FlTitlesData(show: false),
                lineTouchData: LineTouchData(
                  touchTooltipData: LineTouchTooltipData(
                    getTooltipItems: (touches) => [
                      for (final touche in touches)
                        LineTooltipItem(
                          '${formaterCours(points[touche.spotIndex].prix, historique.devise)}\n'
                          '${formaterDateHeure(points[touche.spotIndex].horodatage)}',
                          const TextStyle(color: Colors.white, fontSize: 12),
                        ),
                    ],
                  ),
                ),
                lineBarsData: [
                  LineChartBarData(
                    spots: spots,
                    isCurved: false,
                    color: couleur,
                    barWidth: 2,
                    dotData: const FlDotData(show: false),
                    belowBarData: BarAreaData(show: true, color: couleur.withValues(alpha: 0.12)),
                  ),
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Horodatage(
              source: 'CoinGecko',
              releveLe: historique.releveLe,
              provenance: historique.provenance,
            ),
          ),
        ],
      ),
    );
  }
}
