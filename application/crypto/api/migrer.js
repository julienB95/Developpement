// Création / mise à jour du schéma : node application/crypto/api/migrer.js
const fs = require('fs');
const path = require('path');
const env = require('../../_commun/api/env');

// L'API se connecte avec un rôle limité à la lecture et à l'écriture (PGUSER).
// La migration, elle, modifie la structure : elle prend le compte propriétaire
// du schéma quand PGUSER_MIGRATION est renseigné, avant l'ouverture du pool.
env.charger();
if (process.env.PGUSER_MIGRATION) {
    if (!process.env.PGPASSWORD_MIGRATION) {
        throw new Error('PGUSER_MIGRATION est renseigné sans PGPASSWORD_MIGRATION');
    }
    process.env.PGUSER = process.env.PGUSER_MIGRATION;
    process.env.PGPASSWORD = process.env.PGPASSWORD_MIGRATION;
}

const db = require('../../_commun/api/db');

async function migrer() {
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
    await db.requete(sql);
    console.log('Schéma appliqué sur %s/%s par %s', process.env.PGHOST, process.env.PGDATABASE, process.env.PGUSER);
}

migrer()
    .catch((err) => {
        console.error('Échec de la migration :', err.message);
        process.exitCode = 1;
    })
    .finally(() => db.fermer());
