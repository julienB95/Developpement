-- Schéma de la base de données de l'application crypto
-- Toutes les valeurs monétaires sont en NUMERIC (jamais en flottant)
-- Tous les horodatages sont en TIMESTAMPTZ (stockés en UTC)

CREATE TABLE IF NOT EXISTS actif (
    id          SERIAL PRIMARY KEY,
    symbole     TEXT NOT NULL UNIQUE,
    nom         TEXT NOT NULL,
    decimales   SMALLINT NOT NULL DEFAULT 8 CHECK (decimales BETWEEN 0 AND 18),
    est_actif   BOOLEAN NOT NULL DEFAULT TRUE,
    cree_le     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cours (
    id          BIGSERIAL PRIMARY KEY,
    actif_id    INTEGER NOT NULL REFERENCES actif(id) ON DELETE CASCADE,
    devise      TEXT NOT NULL DEFAULT 'EUR',
    prix        NUMERIC(38, 18) NOT NULL CHECK (prix >= 0),
    source      TEXT NOT NULL,
    horodatage  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (actif_id, devise, source, horodatage)
);

CREATE INDEX IF NOT EXISTS idx_cours_actif_horodatage
    ON cours (actif_id, devise, horodatage DESC);

CREATE TABLE IF NOT EXISTS portefeuille (
    id                SERIAL PRIMARY KEY,
    nom               TEXT NOT NULL UNIQUE,
    devise_reference  TEXT NOT NULL DEFAULT 'EUR',
    cree_le           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operation (
    id               BIGSERIAL PRIMARY KEY,
    portefeuille_id  INTEGER NOT NULL REFERENCES portefeuille(id) ON DELETE CASCADE,
    actif_id         INTEGER NOT NULL REFERENCES actif(id),
    sens             TEXT NOT NULL CHECK (sens IN ('achat', 'vente')),
    quantite         NUMERIC(38, 18) NOT NULL CHECK (quantite > 0),
    prix_unitaire    NUMERIC(38, 18) NOT NULL CHECK (prix_unitaire >= 0),
    devise           TEXT NOT NULL DEFAULT 'EUR',
    frais            NUMERIC(38, 18) NOT NULL DEFAULT 0 CHECK (frais >= 0),
    horodatage       TIMESTAMPTZ NOT NULL DEFAULT now(),
    note             TEXT
);

CREATE INDEX IF NOT EXISTS idx_operation_portefeuille
    ON operation (portefeuille_id, horodatage DESC);

-- Positions calculées à partir des opérations (aucun stock dénormalisé)
CREATE OR REPLACE VIEW position AS
SELECT
    o.portefeuille_id,
    o.actif_id,
    a.symbole,
    SUM(CASE WHEN o.sens = 'achat' THEN o.quantite ELSE -o.quantite END) AS quantite,
    SUM(CASE WHEN o.sens = 'achat' THEN o.quantite * o.prix_unitaire + o.frais ELSE 0 END) AS cout_total,
    o.devise
FROM operation o
JOIN actif a ON a.id = o.actif_id
GROUP BY o.portefeuille_id, o.actif_id, a.symbole, o.devise;
