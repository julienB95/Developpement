import 'package:flutter/material.dart';

import '../api/session.dart';
import '../composants/chargement.dart';
import 'connexion.dart';
import 'marche.dart';
import 'operations.dart';
import 'portefeuille.dart';
import 'profil.dart';

/// Aiguillage selon l'état de la session : démarrage, connexion ou application.
class Racine extends StatelessWidget {
  final EtatSession session;

  const Racine({super.key, required this.session});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: session,
      builder: (context, _) => switch (session.etat) {
        EtatConnexion.demarrage => const Scaffold(body: Center(child: CircularProgressIndicator())),
        EtatConnexion.horsLigne => Scaffold(
            body: SafeArea(
              child: Center(
                child: MessageErreur(
                  erreur: session.erreurDemarrage ?? 'Serveur injoignable',
                  surReessai: session.reessayer,
                ),
              ),
            ),
          ),
        EtatConnexion.deconnecte => EcranConnexion(session: session),
        EtatConnexion.connecte => EcranPrincipal(session: session),
      },
    );
  }
}

class EcranPrincipal extends StatefulWidget {
  final EtatSession session;

  const EcranPrincipal({super.key, required this.session});

  @override
  State<EcranPrincipal> createState() => _EcranPrincipalState();
}

class _EcranPrincipalState extends State<EcranPrincipal> {
  int _onglet = 0;

  @override
  Widget build(BuildContext context) {
    final session = widget.session;
    return Scaffold(
      body: IndexedStack(
        index: _onglet,
        children: [
          EcranPortefeuille(session: session),
          EcranMarche(session: session),
          EcranOperations(session: session),
          EcranProfil(session: session),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _onglet,
        onDestinationSelected: (index) => setState(() => _onglet = index),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.account_balance_wallet_outlined), label: 'Portefeuille'),
          NavigationDestination(icon: Icon(Icons.show_chart), label: 'Marché'),
          NavigationDestination(icon: Icon(Icons.swap_vert), label: 'Opérations'),
          NavigationDestination(icon: Icon(Icons.person_outline), label: 'Profil'),
        ],
      ),
    );
  }
}
