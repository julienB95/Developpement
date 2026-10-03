import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/session.dart';
import '../composants/chargement.dart';

class EcranConnexion extends StatefulWidget {
  final EtatSession session;

  const EcranConnexion({super.key, required this.session});

  @override
  State<EcranConnexion> createState() => _EcranConnexionState();
}

class _EcranConnexionState extends State<EcranConnexion> {
  final _formulaire = GlobalKey<FormState>();
  final _courriel = TextEditingController();
  final _motDePasse = TextEditingController();
  bool _enCours = false;
  bool _masquer = true;
  String? _erreur;

  @override
  void dispose() {
    _courriel.dispose();
    _motDePasse.dispose();
    super.dispose();
  }

  Future<void> _executer(Future<void> Function() action) async {
    setState(() {
      _enCours = true;
      _erreur = null;
    });
    try {
      await action();
    } on ErreurApi catch (e) {
      if (mounted) setState(() => _erreur = e.message);
    } finally {
      if (mounted) setState(() => _enCours = false);
    }
  }

  void _seConnecter() {
    if (!_formulaire.currentState!.validate()) return;
    _executer(() => widget.session.connecter(_courriel.text, _motDePasse.text));
  }

  Future<void> _motDePasseOublie() async {
    final saisie = TextEditingController(text: _courriel.text.trim());
    final courriel = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Mot de passe oublié'),
        content: TextField(
          controller: saisie,
          keyboardType: TextInputType.emailAddress,
          decoration: const InputDecoration(labelText: 'Adresse de courriel'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Annuler')),
          FilledButton(
            onPressed: () => Navigator.pop(context, saisie.text.trim()),
            child: const Text('Recevoir un lien'),
          ),
        ],
      ),
    );
    saisie.dispose();
    if (courriel == null || courriel.isEmpty || !mounted) return;

    try {
      final reponse = await widget.session.api.creer('/mot-de-passe/oubli', {'courriel': courriel.toLowerCase()});
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text((reponse as Map)['statut'] as String? ?? 'Demande envoyée.')),
      );
    } on ErreurApi catch (e) {
      if (mounted) signalerErreur(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formulaire,
                child: AutofillGroup(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Center(
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(16),
                          child: Image.asset('assets/icone/icone.png', height: 72, width: 72),
                        ),
                      ),
                      const SizedBox(height: 16),
                      Text(
                        'Suivi crypto',
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.headlineSmall,
                      ),
                      const SizedBox(height: 32),
                      TextFormField(
                        controller: _courriel,
                        keyboardType: TextInputType.emailAddress,
                        autofillHints: const [AutofillHints.email],
                        textInputAction: TextInputAction.next,
                        decoration: const InputDecoration(labelText: 'Courriel', border: OutlineInputBorder()),
                        validator: (v) => (v == null || !v.contains('@')) ? 'Adresse de courriel invalide' : null,
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: _motDePasse,
                        obscureText: _masquer,
                        autofillHints: const [AutofillHints.password],
                        onFieldSubmitted: (_) => _seConnecter(),
                        decoration: InputDecoration(
                          labelText: 'Mot de passe',
                          border: const OutlineInputBorder(),
                          suffixIcon: IconButton(
                            tooltip: _masquer ? 'Afficher le mot de passe' : 'Masquer le mot de passe',
                            icon: Icon(_masquer ? Icons.visibility : Icons.visibility_off),
                            onPressed: () => setState(() => _masquer = !_masquer),
                          ),
                        ),
                        validator: (v) => (v == null || v.isEmpty) ? 'Mot de passe requis' : null,
                      ),
                      if (_erreur != null) ...[
                        const SizedBox(height: 16),
                        Text(_erreur!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                      ],
                      const SizedBox(height: 24),
                      FilledButton(
                        onPressed: _enCours ? null : _seConnecter,
                        child: _enCours
                            ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                            : const Text('Se connecter'),
                      ),
                      const SizedBox(height: 12),
                      OutlinedButton.icon(
                        onPressed: _enCours ? null : () => _executer(widget.session.connecterGoogle),
                        icon: const Icon(Icons.account_circle_outlined),
                        label: const Text('Se connecter avec Google'),
                      ),
                      TextButton(
                        onPressed: _enCours ? null : _motDePasseOublie,
                        child: const Text('Mot de passe oublié ?'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
