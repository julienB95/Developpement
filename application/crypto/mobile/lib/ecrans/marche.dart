import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api/modeles.dart';
import '../api/session.dart';
import '../composants/chargement.dart';
import '../composants/elements.dart';
import '../composants/graphique.dart';
import '../outils/format.dart';

/// Cours des cryptos suivies, dans la devise du compte, et actualités.
class EcranMarche extends StatefulWidget {
  final EtatSession session;

  const EcranMarche({super.key, required this.session});

  @override
  State<EcranMarche> createState() => _EcranMarcheState();
}

class _EcranMarcheState extends State<EcranMarche> {
  int _generation = 0;

  Future<Cours> _charger() async {
    _generation++;
    return Cours.json(
      await widget.session.api.lire('/marche/cours', {'devise': widget.session.devise}) as Map<String, dynamic>,
    );
  }

  void _ouvrirGraphique(Actif actif, String devise) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.only(bottom: 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ListTile(
                leading: LogoCrypto(actif.symbole),
                title: Text(actif.nom),
                subtitle: Text(formaterCours(actif.prix, devise)),
              ),
              GraphiqueHistorique(api: widget.session.api, actif: actif.id, devise: devise),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Marché')),
      body: ListenableBuilder(
        // La devise peut changer depuis le profil : les cours sont alors rechargés
        listenable: widget.session,
        builder: (context, _) => VueChargee<Cours>(
          key: ValueKey(widget.session.devise),
          charger: _charger,
          construire: (context, cours, _) => ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.only(bottom: 24),
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                child: Horodatage(source: cours.source, releveLe: cours.releveLe, provenance: cours.provenance),
              ),
              for (final actif in cours.actifs)
                ListTile(
                  leading: LogoCrypto(actif.symbole),
                  title: Text(actif.nom),
                  subtitle: Text(actif.symbole),
                  trailing: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(formaterCours(actif.prix, cours.devise), style: const TextStyle(fontWeight: FontWeight.w600)),
                      Text(formaterVariation(actif.variation24h), style: TextStyle(color: couleurSigne(actif.variation24h))),
                    ],
                  ),
                  onTap: () => _ouvrirGraphique(actif, cours.devise),
                ),
              _Actualites(key: ValueKey(_generation), session: widget.session),
            ],
          ),
        ),
      ),
    );
  }
}

/// Actualités chargées à part : une source en panne ne prive pas l'écran des cours.
class _Actualites extends StatefulWidget {
  final EtatSession session;

  const _Actualites({super.key, required this.session});

  @override
  State<_Actualites> createState() => _ActualitesState();
}

class _ActualitesState extends State<_Actualites> {
  late Future<Actualites> _futur = _charger();

  Future<Actualites> _charger() async =>
      Actualites.json(await widget.session.api.lire('/actualites', {'limite': 15}) as Map<String, dynamic>);

  Future<void> _copierLien(Article article) async {
    await Clipboard.setData(ClipboardData(text: article.lien));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Lien de l\'article copié dans le presse-papiers')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Actualites>(
      future: _futur,
      builder: (context, instantane) {
        final enfants = <Widget>[const TitreSection('Actualités')];
        if (instantane.connectionState != ConnectionState.done) {
          enfants.add(const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator())));
        } else if (instantane.hasError) {
          enfants.add(MessageErreur(
            erreur: instantane.error!,
            surReessai: () => setState(() => _futur = _charger()),
          ));
        } else {
          for (final article in instantane.data!.articles) {
            enfants.add(ListTile(
              title: Text(article.titre, maxLines: 3, overflow: TextOverflow.ellipsis),
              subtitle: Text('${article.source} · ${formaterDateHeure(article.publieLe)}'),
              trailing: const Icon(Icons.link),
              onTap: () => _copierLien(article),
            ));
          }
        }
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: enfants);
      },
    );
  }
}
