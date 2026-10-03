import 'package:flutter/material.dart';

import '../api/client.dart';

/// Charge une donnée, affiche l'attente puis le résultat ou l'erreur
/// avec un bouton « Réessayer ». Tirer vers le bas recharge.
class VueChargee<T> extends StatefulWidget {
  final Future<T> Function() charger;
  final Widget Function(BuildContext context, T donnees, Future<void> Function() recharger) construire;

  const VueChargee({super.key, required this.charger, required this.construire});

  @override
  State<VueChargee<T>> createState() => VueChargeeState<T>();
}

class VueChargeeState<T> extends State<VueChargee<T>> {
  late Future<T> _futur;

  @override
  void initState() {
    super.initState();
    _futur = widget.charger();
  }

  Future<void> recharger() {
    final futur = widget.charger();
    setState(() => _futur = futur);
    return futur.then((_) {}, onError: (_) {});
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<T>(
      future: _futur,
      builder: (context, instantane) {
        if (instantane.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        if (instantane.hasError) {
          return RefreshIndicator(
            onRefresh: recharger,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: [MessageErreur(erreur: instantane.error!, surReessai: recharger)],
            ),
          );
        }
        return RefreshIndicator(
          onRefresh: recharger,
          child: widget.construire(context, instantane.data as T, recharger),
        );
      },
    );
  }
}

class MessageErreur extends StatelessWidget {
  final Object erreur;
  final VoidCallback? surReessai;

  const MessageErreur({super.key, required this.erreur, this.surReessai});

  @override
  Widget build(BuildContext context) {
    final texte = erreur is ErreurApi ? (erreur as ErreurApi).message : 'Erreur inattendue : $erreur';
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        children: [
          Icon(Icons.error_outline, size: 40, color: Theme.of(context).colorScheme.error),
          const SizedBox(height: 12),
          Text(texte, textAlign: TextAlign.center),
          if (surReessai != null) ...[
            const SizedBox(height: 12),
            OutlinedButton(onPressed: surReessai, child: const Text('Réessayer')),
          ],
        ],
      ),
    );
  }
}

/// Message d'erreur affiché en bas de l'écran après une action.
void signalerErreur(BuildContext context, Object erreur) {
  final texte = erreur is ErreurApi ? erreur.message : 'Erreur inattendue : $erreur';
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(texte)));
}
