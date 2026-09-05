// Connexion à la base PostgreSQL hébergée sur le NAS Synology
const { Pool, types } = require('pg');
const env = require('./env');

env.charger();

// NUMERIC et BIGINT sont conservés en chaîne : aucune perte de précision sur les montants
types.setTypeParser(1700, (valeur) => valeur); // numeric
types.setTypeParser(20, (valeur) => valeur);   // int8

// DATE est conservé en chaîne AAAA-MM-JJ. Converti en objet Date, il serait
// interprété à minuit heure locale : sérialisé en UTC, il reculerait d'un jour
// pour tout fuseau à l'est de Greenwich — le 1er septembre s'afficherait le 31 août.
types.setTypeParser(1082, (valeur) => valeur); // date

const pool = new Pool({
    host: env.requis('PGHOST'),
    port: Number(process.env.PGPORT || 5432),
    database: env.requis('PGDATABASE'),
    user: env.requis('PGUSER'),
    password: env.requis('PGPASSWORD'),
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
    max: Number(process.env.PGPOOL_MAX || 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
    console.error('Erreur du pool PostgreSQL :', err.message);
});

// Toutes les requêtes passent par des paramètres liés ($1, $2, ...)
function requete(texte, parametres = []) {
    return pool.query(texte, parametres);
}

async function transaction(travail) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const resultat = await travail(client);
        await client.query('COMMIT');
        return resultat;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function fermer() {
    await pool.end();
}

module.exports = { pool, requete, transaction, fermer };
