import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:google_sign_in/google_sign_in.dart';

import 'client.dart';
import 'modeles.dart';

enum EtatConnexion { demarrage, horsLigne, deconnecte, connecte }

/// Session de l'utilisateur : jeton conservé dans le Keystore Android
/// (jamais en clair), compte courant, connexion et déconnexion.
class EtatSession extends ChangeNotifier {
  static const String _cleJeton = 'crypto_jeton';

  final ClientApi api;
  final FlutterSecureStorage _coffre;

  EtatConnexion etat = EtatConnexion.demarrage;
  Compte? compte;
  String? erreurDemarrage;

  bool _googleInitialise = false;

  EtatSession({ClientApi? api, FlutterSecureStorage? coffre})
      : api = api ?? ClientApi(),
        _coffre = coffre ?? const FlutterSecureStorage() {
    this.api.surNonAutorise = _sessionPerdue;
  }

  String get devise => compte?.devise ?? 'EUR';

  /// Au lancement : reprend la session mémorisée si elle est encore valide.
  Future<void> demarrer() async {
    String? jeton;
    try {
      jeton = await _coffre.read(key: _cleJeton);
    } on Exception catch (e) {
      debugPrint('Lecture du jeton impossible : $e');
    }

    if (jeton == null) {
      _passer(EtatConnexion.deconnecte);
      return;
    }

    api.jeton = jeton;
    try {
      compte = Compte.json(await api.lire('/moi') as Map<String, dynamic>);
      erreurDemarrage = null;
      _passer(EtatConnexion.connecte);
    } on ErreurApi catch (e) {
      // Un 401 a déjà fermé la session (surNonAutorise). Sinon le serveur est
      // injoignable : le jeton est gardé et l'utilisateur pourra réessayer.
      if (e.nonAutorise) return;
      erreurDemarrage = e.message;
      _passer(EtatConnexion.horsLigne);
    }
  }

  Future<void> reessayer() {
    _passer(EtatConnexion.demarrage);
    return demarrer();
  }

  Future<void> connecter(String courriel, String motDePasse) async {
    final reponse = await api.creer('/connexion', {
      'courriel': courriel.trim().toLowerCase(),
      'mot_de_passe': motDePasse,
    });
    await _ouvrir(Session.json(reponse as Map<String, dynamic>));
  }

  /// Connexion Google : le jeton d'identité est émis pour le client web du site
  /// (serverClientId), que l'API vérifie déjà. Rien à changer côté serveur.
  Future<void> connecterGoogle() async {
    final configuration = await api.lire('/configuration') as Map<String, dynamic>;
    final clientWeb = configuration['google_client_id'] as String?;
    if (clientWeb == null || clientWeb.isEmpty) {
      throw const ErreurApi(0, 'La connexion Google n\'est pas configurée sur le serveur.');
    }

    final google = GoogleSignIn.instance;
    try {
      if (!_googleInitialise) {
        await google.initialize(serverClientId: clientWeb);
        _googleInitialise = true;
      }
      final compteGoogle = await google.authenticate();
      final jetonGoogle = compteGoogle.authentication.idToken;
      if (jetonGoogle == null) {
        throw const ErreurApi(0, 'Google n\'a pas fourni de jeton d\'identité.');
      }
      final reponse = await api.creer('/connexion/google', {'jeton': jetonGoogle});
      await _ouvrir(Session.json(reponse as Map<String, dynamic>));
    } on GoogleSignInException catch (e) {
      if (e.code == GoogleSignInExceptionCode.canceled) {
        throw const ErreurApi(0, 'Connexion Google annulée.');
      }
      throw ErreurApi(0, 'Connexion Google impossible : ${e.description ?? e.code.name}');
    }
  }

  Future<void> deconnecter() async {
    try {
      await api.creer('/deconnexion', const {});
    } on ErreurApi catch (e) {
      // La session locale est fermée dans tous les cas
      debugPrint('Déconnexion côté serveur non confirmée : ${e.message}');
    }
    if (_googleInitialise) {
      try {
        await GoogleSignIn.instance.signOut();
      } on Exception catch (e) {
        debugPrint('Déconnexion Google non confirmée : $e');
      }
    }
    await _fermer();
  }

  /// Après une modification du profil ou de la devise.
  void mettreAJourCompte(Compte nouveau) {
    compte = nouveau;
    notifyListeners();
  }

  Future<void> _ouvrir(Session session) async {
    api.jeton = session.jeton;
    compte = session.compte;
    try {
      await _coffre.write(key: _cleJeton, value: session.jeton);
    } on Exception catch (e) {
      // La session reste ouverte, elle ne sera simplement pas retrouvée au prochain lancement
      debugPrint('Jeton non mémorisé : $e');
    }
    _passer(EtatConnexion.connecte);
  }

  void _sessionPerdue() {
    if (etat == EtatConnexion.deconnecte) return;
    _fermer();
  }

  Future<void> _fermer() async {
    await _oublierJeton();
    compte = null;
    _passer(EtatConnexion.deconnecte);
  }

  Future<void> _oublierJeton() async {
    api.jeton = null;
    try {
      await _coffre.delete(key: _cleJeton);
    } on Exception catch (e) {
      debugPrint('Effacement du jeton impossible : $e');
    }
  }

  void _passer(EtatConnexion nouvel) {
    etat = nouvel;
    notifyListeners();
  }
}
