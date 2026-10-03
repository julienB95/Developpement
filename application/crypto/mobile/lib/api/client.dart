import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import '../config.dart';

/// Erreur renvoyée par l'API (`{ "erreur": "..." }`) ou par le réseau.
class ErreurApi implements Exception {
  final int code;
  final String message;

  const ErreurApi(this.code, this.message);

  bool get nonAutorise => code == 401;

  @override
  String toString() => message;
}

/// Accès à l'API crypto : JSON dans les deux sens, jeton de session en en-tête.
class ClientApi {
  final http.Client _http;
  final String _base;
  String? jeton;

  /// Appelé sur toute réponse 401 : la session a expiré ou a été fermée.
  void Function()? surNonAutorise;

  static const Duration _delai = Duration(seconds: 20);

  ClientApi({http.Client? client, String? base})
      : _http = client ?? http.Client(),
        _base = '${base ?? adresseApi}$cheminApi';

  Uri adresse(String chemin, [Map<String, Object?>? parametres]) {
    final filtres = <String, String>{};
    parametres?.forEach((cle, valeur) {
      if (valeur != null && valeur.toString().isNotEmpty) filtres[cle] = valeur.toString();
    });
    return Uri.parse('$_base$chemin').replace(queryParameters: filtres.isEmpty ? null : filtres);
  }

  Future<dynamic> lire(String chemin, [Map<String, Object?>? parametres]) =>
      _envoyer('GET', adresse(chemin, parametres));

  Future<dynamic> creer(String chemin, Object corps) => _envoyer('POST', adresse(chemin), corps);

  Future<dynamic> modifier(String chemin, Object corps) => _envoyer('PUT', adresse(chemin), corps);

  Future<dynamic> supprimer(String chemin) => _envoyer('DELETE', adresse(chemin));

  Future<dynamic> _envoyer(String methode, Uri uri, [Object? corps]) async {
    final requete = http.Request(methode, uri);
    requete.headers['Accept'] = 'application/json';
    if (jeton != null) requete.headers['Authorization'] = 'Bearer $jeton';
    if (corps != null) {
      requete.headers['Content-Type'] = 'application/json; charset=utf-8';
      requete.body = jsonEncode(corps);
    }

    final http.Response reponse;
    try {
      reponse = await http.Response.fromStream(await _http.send(requete).timeout(_delai));
    } on TimeoutException {
      throw const ErreurApi(0, 'Le serveur ne répond pas. Réessaie dans un instant.');
    } on SocketException {
      throw const ErreurApi(0, 'Serveur injoignable : vérifie la connexion internet.');
    } on http.ClientException catch (e) {
      throw ErreurApi(0, 'Échec de la connexion au serveur : ${e.message}');
    }

    dynamic donnees;
    try {
      donnees = reponse.body.isEmpty ? null : jsonDecode(utf8.decode(reponse.bodyBytes));
    } on FormatException {
      donnees = null;
    }

    if (reponse.statusCode >= 200 && reponse.statusCode < 300) return donnees;

    final message = donnees is Map && donnees['erreur'] is String
        ? donnees['erreur'] as String
        : 'Erreur inattendue du serveur (${reponse.statusCode})';
    // Un 401 sans jeton est un échec de connexion, pas une session perdue
    if (reponse.statusCode == 401 && jeton != null) surNonAutorise?.call();
    throw ErreurApi(reponse.statusCode, message);
  }
}
