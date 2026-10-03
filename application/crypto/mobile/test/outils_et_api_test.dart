import 'dart:convert';

import 'package:crypto_mobile/api/client.dart';
import 'package:crypto_mobile/outils/decimal.dart';
import 'package:crypto_mobile/outils/format.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  group('Decimal', () {
    test('lit les chaînes de l\'API sans perte', () {
      expect(Decimal.lire('0.500000000000000000').toString(), '0.5');
      expect(Decimal.lire('-12.340').toString(), '-12.34');
      expect(Decimal.lire('1.2e-7').toString(), '0.00000012');
      expect(Decimal.lire('3E2').toString(), '300');
      expect(Decimal.lire('abc'), isNull);
      expect(Decimal.lire(null), isNull);
    });

    test('calcule exactement là où un double se tromperait', () {
      expect((Decimal.lire('0.1')! + Decimal.lire('0.2')!).toString(), '0.3');
      expect((Decimal.lire('0.00012345')! * Decimal.lire('65432.1')!).toString(), '8.077592745');
      expect((Decimal.lire('1')! - Decimal.lire('1.5')!).toString(), '-0.5');
    });

    test('arrondit à l\'affichage seulement, moitié éloignée de zéro', () {
      expect(Decimal.lire('2.345')!.arrondir(2).toString(), '2.35');
      expect(Decimal.lire('-2.345')!.arrondir(2).toString(), '-2.35');
      expect(Decimal.lire('2.344')!.arrondir(2).toString(), '2.34');
      expect(Decimal.lire('0.004')!.arrondir(2).toString(), '0.00');
    });

    test('normalise la saisie française', () {
      expect(normaliserSaisie('0,25'), '0.25');
      expect(normaliserSaisie(' 1 234,5 '), '1234.5');
      expect(normaliserSaisie('-1'), isNull);
      expect(normaliserSaisie('1,2,3'), isNull);
    });
  });

  group('Format', () {
    test('montants avec symbole et séparateur de milliers', () {
      expect(formaterMontant('1234567.891', 'EUR'), '1 234 567,89 €');
      expect(formaterMontant('12.5', 'USD', signe: true), '+12,50 \$');
      expect(formaterMontant('-0.001', 'EUR'), '-0,00 €');
      expect(formaterMontant(null, 'EUR'), '—');
    });

    test('quantités jamais arrondies', () {
      expect(formaterQuantite('0.123456789012345678', 'BTC'), '0,123456789012345678 BTC');
      expect(formaterQuantite('1500.000000000000000000'), '1 500');
    });

    test('cours avec décimales adaptées', () {
      expect(formaterCours('95432.17', 'EUR'), '95 432 €');
      expect(formaterCours('0.0000123', 'EUR'), '0,000012 €');
    });
  });

  group('ClientApi', () {
    test('envoie le jeton et lit le JSON', () async {
      final client = MockClient((requete) async {
        expect(requete.headers['Authorization'], 'Bearer abc');
        expect(requete.url.toString(), 'https://exemple.fr/api/crypto/operations?page=2');
        return http.Response(jsonEncode({'total': 0}), 200);
      });
      final api = ClientApi(client: client, base: 'https://exemple.fr')..jeton = 'abc';
      expect(await api.lire('/operations', {'page': 2, 'annee': null}), {'total': 0});
    });

    test('transforme une erreur de l\'API et signale la session perdue', () async {
      var perdue = false;
      final client = MockClient((_) async => http.Response(
            jsonEncode({'erreur': 'Authentification requise'}),
            401,
            headers: {'content-type': 'application/json; charset=utf-8'},
          ));
      final api = ClientApi(client: client, base: 'https://exemple.fr')
        ..jeton = 'perime'
        ..surNonAutorise = () => perdue = true;

      await expectLater(
        api.lire('/moi'),
        throwsA(isA<ErreurApi>().having((e) => e.message, 'message', 'Authentification requise')),
      );
      expect(perdue, isTrue);
    });
  });
}
