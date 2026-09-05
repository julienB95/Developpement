-- Schéma de la base de données de l'application crypto
-- Toutes les valeurs monétaires sont en NUMERIC (jamais en flottant)
-- Tous les horodatages sont en TIMESTAMPTZ (stockés en UTC)

-- --------------------------------------------------------------------------
-- Retrait des tables de la première ébauche, remplacées par crypto / crypto_valeur
-- --------------------------------------------------------------------------

-- L'ancienne table operation était rattachée à un portefeuille ; la nouvelle est
-- rattachée à l'utilisateur. Le test sur portefeuille_id ne retire que l'ancienne
-- forme : une base déjà migrée garde ses opérations, même si ce fichier est rejoué.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'operation'
          AND column_name = 'portefeuille_id'
    ) THEN
        DROP TABLE operation CASCADE;
    END IF;
END $$;

DROP TABLE IF EXISTS cours CASCADE;
DROP TABLE IF EXISTS portefeuille CASCADE;
DROP TABLE IF EXISTS actif CASCADE;

-- --------------------------------------------------------------------------
-- Référentiel
-- --------------------------------------------------------------------------

-- Crypto-actifs suivis. L'identifiant est le symbole d'usage (BTC, ETH...).
-- identifiant_coingecko est indispensable : le symbole seul ne permet pas
-- d'interroger l'API des cours, qui attend 'bitcoin' et non 'BTC'.
CREATE TABLE IF NOT EXISTS crypto (
    id                     TEXT PRIMARY KEY,
    libelle                TEXT NOT NULL,
    identifiant_coingecko  TEXT UNIQUE,
    est_suivi              BOOLEAN NOT NULL DEFAULT TRUE,
    cree_le                TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT crypto_id_majuscules CHECK (id = upper(id))
);

-- Adresse du logo, renseignee au premier affichage puis reutilisee : la table
-- n'a plus besoin d'interroger la source des cours pour retrouver l'image.
ALTER TABLE crypto ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Paire Binance en euro, utilisee pour relever la valeur moyenne journaliere
ALTER TABLE crypto ADD COLUMN IF NOT EXISTS paire_binance TEXT;

-- Plateformes d'échange sur lesquelles les opérations sont passées.
-- Le libellé fait office de clé : une plateforme n'a rien d'autre à porter,
-- un identifiant technique à côté du nom n'aurait fait qu'alourdir la saisie.
CREATE TABLE IF NOT EXISTS plateforme (
    libelle  TEXT PRIMARY KEY,
    cree_le  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Une plateforme inactive n'est plus proposée à la saisie d'une opération,
-- mais reste rattachée aux opérations déjà enregistrées.
ALTER TABLE plateforme ADD COLUMN IF NOT EXISTS est_actif BOOLEAN NOT NULL DEFAULT TRUE;

-- La clé primaire distingue déjà « Kraken » de « Kraken », mais pas de « kraken ».
-- Deux plateformes qui ne diffèrent que par la casse sont un doublon.
CREATE UNIQUE INDEX IF NOT EXISTS idx_plateforme_libelle_unique
    ON plateforme (lower(libelle));

-- Passage de l'ancienne forme (identifiant technique + libellé) à la nouvelle.
-- Les opérations pointaient l'identifiant : elles doivent pointer le libellé.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'plateforme' AND column_name = 'id'
    ) THEN
        ALTER TABLE operation DROP CONSTRAINT IF EXISTS operation_plateforme_id_fkey;

        UPDATE operation o
        SET plateforme_id = p.libelle
        FROM plateforme p
        WHERE o.plateforme_id = p.id;

        ALTER TABLE plateforme DROP CONSTRAINT plateforme_pkey CASCADE;
        ALTER TABLE plateforme DROP COLUMN id;
        ALTER TABLE plateforme ADD PRIMARY KEY (libelle);
    END IF;
END $$;


-- --------------------------------------------------------------------------
-- Valeurs quotidiennes
-- --------------------------------------------------------------------------

-- Une ligne par crypto et par jour. Le VWAP est la valeur de référence retenue :
-- c'est la cotation moyenne journalière admise par le BOFiP pour la déclaration.
-- La bougie complète est conservée parce qu'elle arrive dans la même réponse d'API
-- et qu'elle sera irrécupérable si la paire disparaît de la plateforme.
CREATE TABLE IF NOT EXISTS crypto_valeur (
    id_crypto      TEXT NOT NULL REFERENCES crypto(id) ON DELETE CASCADE,
    date           DATE NOT NULL,
    devise         TEXT NOT NULL DEFAULT 'EUR',
    source         TEXT NOT NULL,
    vwap           NUMERIC(38, 18) CHECK (vwap >= 0),
    ouverture      NUMERIC(38, 18) CHECK (ouverture >= 0),
    haut           NUMERIC(38, 18) CHECK (haut >= 0),
    bas            NUMERIC(38, 18) CHECK (bas >= 0),
    cloture        NUMERIC(38, 18) CHECK (cloture >= 0),
    volume         NUMERIC(38, 18) CHECK (volume >= 0),
    volume_devise  NUMERIC(38, 18) CHECK (volume_devise >= 0),
    releve_le      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id_crypto, date),
    -- Un VWAP hors de la fourchette du jour ne peut venir que d'un import cassé
    CONSTRAINT crypto_valeur_vwap_coherent CHECK (
        vwap IS NULL OR bas IS NULL OR haut IS NULL OR (vwap >= bas AND vwap <= haut)
    ),
    CONSTRAINT crypto_valeur_fourchette CHECK (
        bas IS NULL OR haut IS NULL OR bas <= haut
    )
);

CREATE INDEX IF NOT EXISTS idx_crypto_valeur_date
    ON crypto_valeur (date DESC);

-- --------------------------------------------------------------------------
-- Comptes utilisateurs
-- --------------------------------------------------------------------------
-- Deux modes d'authentification possibles, cumulables sur un meme compte :
--   - mot de passe local : mot_de_passe_hash renseigne (empreinte scrypt, jamais le mot de passe)
--   - compte Google      : google_sub renseigne (claim "sub" du jeton Google, stable et unique)
CREATE TABLE IF NOT EXISTS utilisateur (
    id                 SERIAL PRIMARY KEY,
    courriel           TEXT NOT NULL UNIQUE,
    nom                TEXT NOT NULL,
    prenom             TEXT NOT NULL,
    mot_de_passe_hash  TEXT,
    google_sub         TEXT UNIQUE,
    est_actif          BOOLEAN NOT NULL DEFAULT TRUE,
    cree_le            TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Le courriel est toujours stocke en minuscules pour que l'unicite soit reelle
    CONSTRAINT utilisateur_courriel_minuscules CHECK (courriel = lower(courriel)),
    CONSTRAINT utilisateur_courriel_forme CHECK (courriel LIKE '%_@_%._%'),
    -- Un compte doit disposer d'au moins un moyen de connexion
    CONSTRAINT utilisateur_authentification CHECK (
        mot_de_passe_hash IS NOT NULL OR google_sub IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_utilisateur_actif
    ON utilisateur (est_actif);

-- Droit d'administration. Ajout separe pour rester applicable
-- sur une base ou la table utilisateur existe deja.
ALTER TABLE utilisateur
    ADD COLUMN IF NOT EXISTS est_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Devise d'affichage choisie par l'utilisateur. Ne concerne que l'affichage :
-- les valeurs retenues pour la déclaration restent en euro.
ALTER TABLE utilisateur
    ADD COLUMN IF NOT EXISTS devise TEXT NOT NULL DEFAULT 'EUR';

ALTER TABLE utilisateur
    DROP CONSTRAINT IF EXISTS utilisateur_devise;
ALTER TABLE utilisateur
    ADD CONSTRAINT utilisateur_devise CHECK (devise IN ('EUR', 'USD'));

-- Autorisation explicite de se connecter par Google. Par défaut fermée :
-- un compte Google inconnu ne doit pas pouvoir se créer un accès tout seul.
-- L'administrateur ouvre le droit, la première connexion rattache google_sub.
ALTER TABLE utilisateur
    ADD COLUMN IF NOT EXISTS autorise_google BOOLEAN NOT NULL DEFAULT FALSE;

-- Blocage après échecs de connexion par mot de passe.
-- Ne concerne pas la connexion Google, qui ne passe pas par un mot de passe.
ALTER TABLE utilisateur
    ADD COLUMN IF NOT EXISTS est_bloque BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE utilisateur
    ADD COLUMN IF NOT EXISTS tentatives_echouees SMALLINT NOT NULL DEFAULT 0;

-- Valeurs reprises par défaut à la saisie d'une opération. Facultatives :
-- un compte qui ne les renseigne pas saisit tout à la main comme avant.
ALTER TABLE utilisateur
    ADD COLUMN IF NOT EXISTS plateforme_defaut TEXT;

ALTER TABLE utilisateur
    ADD COLUMN IF NOT EXISTS frais_defaut NUMERIC(38, 18);

ALTER TABLE utilisateur DROP CONSTRAINT IF EXISTS utilisateur_frais_defaut;
ALTER TABLE utilisateur
    ADD CONSTRAINT utilisateur_frais_defaut CHECK (frais_defaut IS NULL OR frais_defaut >= 0);

-- Renommer une plateforme suit dans les préférences, comme dans les opérations
ALTER TABLE utilisateur DROP CONSTRAINT IF EXISTS utilisateur_plateforme_defaut_fkey;
ALTER TABLE utilisateur
    ADD CONSTRAINT utilisateur_plateforme_defaut_fkey
    FOREIGN KEY (plateforme_defaut) REFERENCES plateforme(libelle)
    ON UPDATE CASCADE ON DELETE SET NULL;

-- Compte créé par un administrateur dont le mot de passe reste à définir
-- par la personne elle-même, via le lien qui lui est transmis.
ALTER TABLE utilisateur
    ADD COLUMN IF NOT EXISTS mot_de_passe_a_definir BOOLEAN NOT NULL DEFAULT FALSE;

-- Un compte doit toujours annoncer par où on y entre, même si l'accès
-- n'est pas encore utilisable : mot de passe posé, compte Google rattaché,
-- droit Google ouvert, ou mot de passe en attente de définition.
ALTER TABLE utilisateur
    DROP CONSTRAINT IF EXISTS utilisateur_authentification;
ALTER TABLE utilisateur
    ADD CONSTRAINT utilisateur_authentification CHECK (
        mot_de_passe_hash IS NOT NULL
        OR google_sub IS NOT NULL
        OR autorise_google
        OR mot_de_passe_a_definir
    );

-- Demandes de réinitialisation de mot de passe. Comme pour les sessions,
-- seule l'empreinte du jeton est stockée : le lien envoyé par courriel
-- n'est reconstituable depuis la base par personne.
CREATE TABLE IF NOT EXISTS reinitialisation (
    jeton_hash      TEXT PRIMARY KEY,
    utilisateur_id  INTEGER NOT NULL REFERENCES utilisateur(id) ON DELETE CASCADE,
    cree_le         TIMESTAMPTZ NOT NULL DEFAULT now(),
    expire_le       TIMESTAMPTZ NOT NULL,
    utilise_le      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reinitialisation_utilisateur
    ON reinitialisation (utilisateur_id);

CREATE INDEX IF NOT EXISTS idx_reinitialisation_expiration
    ON reinitialisation (expire_le);

-- Sessions ouvertes. Seule l'empreinte du jeton est stockee :
-- une fuite de la base ne permet pas de rejouer une session.
CREATE TABLE IF NOT EXISTS session (
    jeton_hash      TEXT PRIMARY KEY,
    utilisateur_id  INTEGER NOT NULL REFERENCES utilisateur(id) ON DELETE CASCADE,
    cree_le         TIMESTAMPTZ NOT NULL DEFAULT now(),
    expire_le       TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_utilisateur
    ON session (utilisateur_id);

CREATE INDEX IF NOT EXISTS idx_session_expiration
    ON session (expire_le);

-- --------------------------------------------------------------------------
-- Opérations
-- --------------------------------------------------------------------------

-- Achats et ventes simples, par utilisateur. Volontairement limité à ce cas :
-- ni transfert, ni staking, ni échange d'une crypto contre une autre.
CREATE TABLE IF NOT EXISTS operation (
    id              BIGSERIAL PRIMARY KEY,
    utilisateur_id  INTEGER NOT NULL REFERENCES utilisateur(id) ON DELETE CASCADE,
    horodatage      TIMESTAMPTZ NOT NULL,
    sens            TEXT NOT NULL CHECK (sens IN ('achat', 'vente')),
    id_crypto       TEXT NOT NULL REFERENCES crypto(id),
    quantite        NUMERIC(38, 18) NOT NULL CHECK (quantite > 0),
    plateforme      TEXT,
    -- Hors de ta liste, mais laissé facultatif : sans le prix réellement payé ou
    -- encaissé en euro, aucune plus-value ne peut être calculée pour la 2086.
    prix_unitaire   NUMERIC(38, 18) CHECK (prix_unitaire >= 0),
    frais           NUMERIC(38, 18) NOT NULL DEFAULT 0 CHECK (frais >= 0),
    cree_le         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- La colonne porte désormais le libellé de la plateforme, plus un identifiant.
-- Le renommage n'a lieu que sur une base créée avant ce changement.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'operation' AND column_name = 'plateforme_id'
    ) THEN
        ALTER TABLE operation RENAME COLUMN plateforme_id TO plateforme;
    END IF;
END $$;

-- ON UPDATE CASCADE : renommer une plateforme suit dans les opérations,
-- puisque c'est le libellé lui-même qui sert de clé.
ALTER TABLE operation DROP CONSTRAINT IF EXISTS operation_plateforme_id_fkey;
ALTER TABLE operation DROP CONSTRAINT IF EXISTS operation_plateforme_fkey;
ALTER TABLE operation
    ADD CONSTRAINT operation_plateforme_fkey
    FOREIGN KEY (plateforme) REFERENCES plateforme(libelle) ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS idx_operation_utilisateur
    ON operation (utilisateur_id, horodatage DESC);

CREATE INDEX IF NOT EXISTS idx_operation_crypto
    ON operation (utilisateur_id, id_crypto);

-- Positions calculées à partir des opérations (aucun stock dénormalisé)
DROP VIEW IF EXISTS position CASCADE;
CREATE OR REPLACE VIEW position AS
SELECT
    o.utilisateur_id,
    o.id_crypto,
    c.libelle,
    SUM(CASE WHEN o.sens = 'achat' THEN o.quantite ELSE -o.quantite END) AS quantite,
    SUM(CASE WHEN o.sens = 'achat'
             THEN o.quantite * COALESCE(o.prix_unitaire, 0) + o.frais
             ELSE 0 END) AS cout_total
FROM operation o
JOIN crypto c ON c.id = o.id_crypto
GROUP BY o.utilisateur_id, o.id_crypto, c.libelle;

-- --------------------------------------------------------------------------
-- Données de référence
-- --------------------------------------------------------------------------

INSERT INTO crypto (id, libelle, identifiant_coingecko) VALUES
    ('BTC',  'Bitcoin',   'bitcoin'),
    ('ETH',  'Ethereum',  'ethereum'),
    ('SOL',  'Solana',    'solana'),
    ('XRP',  'XRP',       'ripple'),
    ('ADA',  'Cardano',   'cardano'),
    ('BNB',  'BNB',       'binancecoin'),
    ('DOGE', 'Dogecoin',  'dogecoin'),
    ('LINK', 'Chainlink', 'chainlink')
ON CONFLICT (id) DO UPDATE
    SET libelle = EXCLUDED.libelle,
        identifiant_coingecko = EXCLUDED.identifiant_coingecko;

UPDATE crypto SET paire_binance = id || 'EUR' WHERE paire_binance IS NULL;

INSERT INTO plateforme (libelle) VALUES
    ('Binance'),
    ('Kraken'),
    ('Coinbase'),
    ('Bitstamp'),
    ('Bitpanda'),
    ('Autre')
ON CONFLICT (libelle) DO NOTHING;
