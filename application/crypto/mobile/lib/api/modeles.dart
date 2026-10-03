// Objets renvoyés par l'API. Montants, quantités et cours restent des chaînes
// décimales : aucun double, l'arrondi se fait à l'affichage (outils/format.dart).

String? _texte(Object? valeur) => valeur?.toString();

List<Map<String, dynamic>> _liste(Object? valeur) =>
    (valeur as List? ?? const []).cast<Map<String, dynamic>>();

class Compte {
  final int id;
  final String courriel;
  final String nom;
  final String prenom;
  final bool estAdmin;
  final String devise;
  final String? plateformeDefaut;
  final String stakingAcquisition;

  Compte.json(Map<String, dynamic> j)
      : id = j['id'] as int,
        courriel = j['courriel'] as String,
        nom = j['nom'] as String? ?? '',
        prenom = j['prenom'] as String? ?? '',
        estAdmin = j['est_admin'] == true,
        devise = j['devise'] as String? ?? 'EUR',
        plateformeDefaut = j['plateforme_defaut'] as String?,
        stakingAcquisition = j['staking_acquisition'] as String? ?? 'nulle';

  String get nomComplet => '$prenom $nom'.trim();

  String get initiales {
    final texte = '${prenom.isEmpty ? '' : prenom[0]}${nom.isEmpty ? '' : nom[0]}';
    return (texte.isEmpty ? courriel[0] : texte).toUpperCase();
  }
}

class Session {
  final Compte compte;
  final String jeton;

  Session.json(Map<String, dynamic> j)
      : compte = Compte.json(j['utilisateur'] as Map<String, dynamic>),
        jeton = j['jeton'] as String;
}

// --- Marché -------------------------------------------------------------

class Actif {
  final String id; // identifiant CoinGecko, utilisé pour l'historique
  final String symbole;
  final String nom;
  final String? prix;
  final num? variation24h;
  final String? misAJourLe;

  Actif.json(Map<String, dynamic> j)
      : id = j['id'] as String,
        symbole = j['symbole'] as String,
        nom = j['nom'] as String? ?? j['symbole'] as String,
        prix = _texte(j['prix']),
        variation24h = j['variation_24h'] as num?,
        misAJourLe = j['mis_a_jour_le'] as String?;
}

class Cours {
  final String devise;
  final String releveLe;
  final String source;
  final String provenance;
  final List<Actif> actifs;

  Cours.json(Map<String, dynamic> j)
      : devise = j['devise'] as String,
        releveLe = j['releve_le'] as String,
        source = j['source'] as String? ?? '',
        provenance = j['provenance'] as String? ?? 'source',
        actifs = _liste(j['actifs']).map(Actif.json).toList();
}

class PointHistorique {
  final String horodatage;
  final String prix;

  PointHistorique.json(Map<String, dynamic> j)
      : horodatage = j['horodatage'] as String,
        prix = _texte(j['prix'])!;
}

class Historique {
  final String devise;
  final String releveLe;
  final String provenance;
  final List<PointHistorique> points;

  Historique.json(Map<String, dynamic> j)
      : devise = j['devise'] as String,
        releveLe = j['releve_le'] as String,
        provenance = j['provenance'] as String? ?? 'source',
        points = _liste(j['points']).map(PointHistorique.json).toList();
}

class Article {
  final String titre;
  final String lien;
  final String source;
  final String? publieLe;

  Article.json(Map<String, dynamic> j)
      : titre = j['titre'] as String,
        lien = j['lien'] as String,
        source = j['source'] as String? ?? '',
        publieLe = j['publie_le'] as String?;
}

class Actualites {
  final String releveLe;
  final String provenance;
  final List<Article> articles;

  Actualites.json(Map<String, dynamic> j)
      : releveLe = j['releve_le'] as String,
        provenance = j['provenance'] as String? ?? 'source',
        articles = _liste(j['articles']).map(Article.json).toList();
}

// --- Référentiels ---------------------------------------------------------

class CryptoRef {
  final String id;
  final String libelle;
  final bool estSuivi;

  CryptoRef.json(Map<String, dynamic> j)
      : id = j['id'] as String,
        libelle = j['libelle'] as String? ?? j['id'] as String,
        estSuivi = j['est_suivi'] == true;
}

class Plateforme {
  final String libelle;
  final bool estActif;
  final String? fraisDefaut;

  Plateforme.json(Map<String, dynamic> j)
      : libelle = j['libelle'] as String,
        estActif = j['est_actif'] == true,
        fraisDefaut = _texte(j['frais_defaut']);
}

// --- Opérations -----------------------------------------------------------

const List<String> typesOperation = ['achat', 'vente', 'staking'];

String libelleType(String type) => switch (type) {
      'achat' => 'Achat',
      'vente' => 'Vente',
      'staking' => 'Staking',
      _ => type,
    };

class Operation {
  final String id;
  final String horodatage;
  final String type;
  final String idCrypto;
  final String libelle;
  final String quantite;
  final String? plateforme;
  final String? prixUnitaire;
  final String frais;
  final String? montant;

  Operation.json(Map<String, dynamic> j)
      : id = j['id'].toString(),
        horodatage = j['horodatage'] as String,
        type = j['type'] as String,
        idCrypto = j['id_crypto'] as String,
        libelle = j['libelle'] as String? ?? j['id_crypto'] as String,
        quantite = _texte(j['quantite'])!,
        plateforme = j['plateforme'] as String?,
        prixUnitaire = _texte(j['prix_unitaire']),
        frais = _texte(j['frais']) ?? '0',
        montant = _texte(j['montant']);
}

class PageOperations {
  final List<Operation> lignes;
  final int total;
  final int page;
  final int pages;

  PageOperations.json(Map<String, dynamic> j)
      : lignes = _liste(j['lignes']).map(Operation.json).toList(),
        total = j['total'] as int,
        page = j['page'] as int,
        pages = j['pages'] as int;
}

// --- Portefeuille ---------------------------------------------------------

class LignePortefeuille {
  final String idCrypto;
  final String libelle;
  final String quantite;
  final String? prix;
  final String? total;

  LignePortefeuille.json(Map<String, dynamic> j)
      : idCrypto = j['id_crypto'] as String,
        libelle = j['libelle'] as String? ?? j['id_crypto'] as String,
        quantite = _texte(j['quantite'])!,
        prix = _texte(j['prix']),
        total = _texte(j['total']);
}

class Portefeuille {
  final List<LignePortefeuille> lignes;
  final String? total;
  final int lignesSansCours;
  final String devise;
  final String? source;
  final String? releveLe;
  final String? coursIndisponible;

  Portefeuille.json(Map<String, dynamic> j)
      : lignes = _liste(j['lignes']).map(LignePortefeuille.json).toList(),
        total = _texte(j['total']),
        lignesSansCours = j['lignes_sans_cours'] as int? ?? 0,
        devise = j['devise'] as String? ?? 'EUR',
        source = j['source'] as String?,
        releveLe = j['releve_le'] as String?,
        coursIndisponible = j['cours_indisponible'] as String?;
}

class DetailCrypto {
  final String idCrypto;
  final String libelle;
  final String? identifiantCoingecko;
  final String devise;
  final int operations;
  final String quantite;
  final String coutAcquisition;
  final String? prixMoyen;
  final String? cours;
  final String? valeur;
  final String? performance;
  final String? performancePourcentage;
  final num? variation24h;
  final String? source;
  final String? releveLe;
  final String? coursIndisponible;

  DetailCrypto.json(Map<String, dynamic> j)
      : idCrypto = j['id_crypto'] as String,
        libelle = j['libelle'] as String? ?? j['id_crypto'] as String,
        identifiantCoingecko = j['identifiant_coingecko'] as String?,
        devise = j['devise'] as String? ?? 'EUR',
        operations = j['operations'] as int? ?? 0,
        quantite = _texte(j['quantite'])!,
        coutAcquisition = _texte(j['cout_acquisition']) ?? '0',
        prixMoyen = _texte(j['prix_moyen']),
        cours = _texte(j['cours']),
        valeur = _texte(j['valeur']),
        performance = _texte(j['performance']),
        performancePourcentage = _texte(j['performance_pourcentage']),
        variation24h = j['variation_24h'] as num?,
        source = j['source'] as String?,
        releveLe = j['releve_le'] as String?,
        coursIndisponible = j['cours_indisponible'] as String?;
}

// --- Plus-values ----------------------------------------------------------

class PlusValueCrypto {
  final String idCrypto;
  final String libelle;
  final int cessions;
  final bool venteSimulee;
  final String prixCession;
  final String? plusValue;
  final String? rendement;
  final List<String> reserves;

  PlusValueCrypto.json(Map<String, dynamic> j)
      : idCrypto = j['id_crypto'] as String,
        libelle = j['libelle'] as String? ?? j['id_crypto'] as String,
        cessions = j['cessions'] as int? ?? 0,
        venteSimulee = j['vente_simulee'] == true,
        prixCession = _texte(j['prix_cession']) ?? '0',
        plusValue = _texte(j['plus_value']),
        rendement = _texte(j['rendement']),
        reserves = _liste(j['lignes'])
            .expand((ligne) => (ligne['reserves'] as List? ?? const []).cast<String>())
            .toSet()
            .toList();
}

class PlusValues {
  final int annee;
  final List<PlusValueCrypto> cryptos;
  final int cessions;
  final int ventesSimulees;
  final String? plusValue;
  final String? rendement;
  final bool complet;
  final int? premiereAnnee;
  final bool estimation;
  final String conventionStaking;
  final int operationsStaking;

  PlusValues.json(Map<String, dynamic> j)
      : annee = j['annee'] as int,
        cryptos = _liste(j['cryptos']).map(PlusValueCrypto.json).toList(),
        cessions = (j['total'] as Map<String, dynamic>)['cessions'] as int? ?? 0,
        ventesSimulees = (j['total'] as Map<String, dynamic>)['ventes_simulees'] as int? ?? 0,
        plusValue = _texte((j['total'] as Map<String, dynamic>)['plus_value']),
        rendement = _texte((j['total'] as Map<String, dynamic>)['rendement']),
        complet = j['complet'] != false,
        premiereAnnee = j['premiere_annee'] as int?,
        estimation = j['estimation'] != null,
        conventionStaking = (j['staking'] as Map<String, dynamic>?)?['convention'] as String? ?? 'nulle',
        operationsStaking = (j['staking'] as Map<String, dynamic>?)?['operations'] as int? ?? 0;
}
