import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'api/session.dart';
import 'ecrans/racine.dart';

const Color couleurMarque = Color(0xFF1F6F5C);

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final session = EtatSession()..demarrer();
  runApp(ApplicationCrypto(session: session));
}

class ApplicationCrypto extends StatelessWidget {
  final EtatSession session;

  const ApplicationCrypto({super.key, required this.session});

  ThemeData _theme(Brightness luminosite) => ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: couleurMarque, brightness: luminosite),
        useMaterial3: true,
      );

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Suivi crypto',
      debugShowCheckedModeBanner: false,
      theme: _theme(Brightness.light),
      darkTheme: _theme(Brightness.dark),
      locale: const Locale('fr', 'FR'),
      supportedLocales: const [Locale('fr', 'FR')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      home: Racine(session: session),
    );
  }
}
