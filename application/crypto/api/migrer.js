// Création / mise à jour du schéma : node application/crypto/api/migrer.js
const fs = require('fs');
const path = require('path');
const db = require('./db');

async function migrer() {
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
    await db.requete(sql);
    console.log('Schéma appliqué sur %s/%s', process.env.PGHOST, process.env.PGDATABASE);
}

migrer()
    .catch((err) => {
        console.error('Échec de la migration :', err.message);
        process.exitCode = 1;
    })
    .finally(() => db.fermer());
