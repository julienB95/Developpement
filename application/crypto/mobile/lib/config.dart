// Adresse de l'API, fixée à la compilation et jamais écrite en dur pour la production :
//   flutter run --dart-define=API_URL=https://exemple.fr
// Par défaut, l'API locale de développement vue depuis l'émulateur Android
// (10.0.2.2 désigne le PC hôte). Le HTTP en clair n'est accepté qu'en debug.
const String adresseApi = String.fromEnvironment(
  'API_URL',
  defaultValue: 'http://10.0.2.2:9998',
);

const String cheminApi = '/api/crypto';
