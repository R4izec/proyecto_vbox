// Llamada a la BD de MongoDB
const { MongoClient } = require('mongodb');
const uri = process.env.MONGO_URI;

let client;
let db;

async function connect() {
    if (db) return db;
    client = new MongoClient(uri, { ignoreUndefined: true });
    await client.connect();
    db = client.db(); 
    console.log('[MongoDB] Conectado:', db.databaseName);
    return db;
}

function getDb() {
    if (!db) throw new Error('DB no inicializada. Llama connect() primero.');
    return db;
}

function getCollection(name) {
    return getDb().collection(name);
}

async function close() {
    if (client) await client.close();
}

module.exports = { connect, getDb, getCollection, close };
