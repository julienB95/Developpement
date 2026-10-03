import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/modeles.dart';
import '../api/session.dart';
import '../composants/chargement.dart';
import '../composants/elements.dart';
import '../outils/format.dart';

/// Préférences du compte. Le nom et le courriel se modifient sur le site web.
class EcranProfil extends StatefulWidget {
  final EtatSession session;

  const EcranProfil({super.key, required this.session});

  @override
  State<EcranProfil> createState() => _EcranProfilState();
}

class _EcranProfilState extends State<EcranProfil> {
  late Future<List<Plateforme>> _plateformes = _chargerPlateformes();
  late final Future<Map<String, dynamic>> _version = _chargerVersion();
  bool _enCours = false;

  Future<List<Plateforme>> _chargerPlateformes() async => (await widget.session.api.lire('/plateformes') as List)
      .cast<Map<String, dynamic>>()
      .map(Plateforme.json)
      .toList();

  Future<Map<String, dynamic>> _chargerVersion() async =>
      await widget.session.api.lire('/version') as Map<String, dynamic>;

  Future<void> _appliquer(Future<dynamic> Function() requete) async {
    setState(() => _enCours = true);
    try {
      widget.session.mettreAJourCompte(Compte.json(await requete() as Map<String, dynamic>));
    } on ErreurApi catch (e) {
      if (mounted) signalerErreur(context, e);
    } finally {
      if (mounted) setState(() => _enCours = false);
    }
  }

  void _changerDevise(String devise) =>
      _appliquer(() => widget.session.api.modifier('/moi/devise', {'devise': devise}));

  // PUT /moi attend le profil complet : on renvoie l'existant avec la préférence modifiée
  void _changerPreferences(Compte compte, {String? plateforme, String? staking, bool viderPlateforme = false}) {
    _appliquer(() => widget.session.api.modifier('/moi', {
          'courriel': compte.courriel,
          'nom': compte.nom,
          'prenom': compte.prenom,
          'devise': compte.devise,
          'plateforme_defaut': viderPlateforme ? null : (plateforme ?? compte.plateformeDefaut),
          'staking_acquisition': staking ?? compte.stakingAcquisition,
        }));
  }

  Future<void> _seDeconnecter() async {
    setState(() => _enCours = true);
    await widget.session.deconnecter();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Profil')),
      body: ListenableBuilder(
        listenable: widget.session,
        builder: (context, _) {
          final compte = widget.session.compte;
          if (compte == null) return const SizedBox.shrink();
          return ListView(
            padding: const EdgeInsets.only(bottom: 24),
            children: [
              ListTile(
                leading: CircleAvatar(child: Text(compte.initiales)),
                title: Text(compte.nomComplet),
                subtitle: Text(compte.courriel),
                trailing: compte.estAdmin ? const Chip(label: Text('Administrateur')) : null,
              ),
              if (_enCours) const LinearProgressIndicator(),
              const TitreSection('Devise d\'affichage des cours'),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: SegmentedButton<String>(
                  segments: [
                    for (final devise in const ['EUR', 'USD'])
                      ButtonSegment(value: devise, label: Text('$devise (${symboleDevise(devise)})')),
                  ],
                  selected: {compte.devise},
                  onSelectionChanged: _enCours ? null : (choix) => _changerDevise(choix.first),
                ),
              ),
              const TitreSection('Plateforme par défaut'),
              FutureBuilder<List<Plateforme>>(
                future: _plateformes,
                builder: (context, instantane) {
                  if (instantane.hasError) {
                    return MessageErreur(
                      erreur: instantane.error!,
                      surReessai: () => setState(() => _plateformes = _chargerPlateformes()),
                    );
                  }
                  final plateformes = (instantane.data ?? const <Plateforme>[])
                      .where((p) => p.estActif || p.libelle == compte.plateformeDefaut)
                      .toList();
                  return Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: DropdownButtonFormField<String?>(
                      key: ValueKey('${compte.plateformeDefaut}-${plateformes.length}'),
                      initialValue: plateformes.any((p) => p.libelle == compte.plateformeDefaut)
                          ? compte.plateformeDefaut
                          : null,
                      decoration: const InputDecoration(border: OutlineInputBorder()),
                      items: [
                        const DropdownMenuItem(value: null, child: Text('Aucune')),
                        for (final p in plateformes) DropdownMenuItem(value: p.libelle, child: Text(p.libelle)),
                      ],
                      onChanged: _enCours
                          ? null
                          : (valeur) => _changerPreferences(compte, plateforme: valeur, viderPlateforme: valeur == null),
                    ),
                  );
                },
              ),
              const TitreSection('Staking : prix d\'acquisition retenu'),
              RadioGroup<String>(
                groupValue: compte.stakingAcquisition,
                onChanged: (valeur) {
                  if (!_enCours && valeur != null) _changerPreferences(compte, staking: valeur);
                },
                child: const Column(
                  children: [
                    RadioListTile<String>(value: 'nulle', title: Text('Nul — la récompense n\'a rien coûté')),
                    RadioListTile<String>(value: 'valeur_recue', title: Text('Sa valeur à la réception')),
                  ],
                ),
              ),
              const Divider(height: 32),
              ListTile(
                leading: const Icon(Icons.logout),
                title: const Text('Se déconnecter'),
                onTap: _enCours ? null : _seDeconnecter,
              ),
              FutureBuilder<Map<String, dynamic>>(
                future: _version,
                builder: (context, instantane) {
                  final infos = instantane.data;
                  final texte = instantane.hasError
                      ? 'Version du serveur indisponible'
                      : infos == null
                          ? ''
                          : 'Serveur : ${formaterDateHeure(infos['date_version'] as String?)}'
                              '${infos['commit'] == null ? '' : ' (${infos['commit']})'}';
                  return Padding(
                    padding: const EdgeInsets.all(16),
                    child: Text(texte, style: Theme.of(context).textTheme.bodySmall, textAlign: TextAlign.center),
                  );
                },
              ),
            ],
          );
        },
      ),
    );
  }
}
