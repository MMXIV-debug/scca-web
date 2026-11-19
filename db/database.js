const { Pool } = require('pg');
require('dotenv').config();

class Database {
  constructor() {
    // Si la instancia ya existe, no creamos una nueva
    if (!Database.instance) {
      this.pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        connectionTimeoutMillis: 5000,
        query_timeout: 15000,
        statement_timeout: 15000,
        idleTimeoutMillis: 30000
      });
      // pg retira del pool una conexión inactiva rota. El evento no pertenece a
      // ninguna petición y, sin listener, Node termina el proceso completo.
      this.pool.on('error', error => {
        console.error('Conexión PostgreSQL interrumpida; se reintentará en la siguiente solicitud.', {
          codigo: error.code || 'CONEXION_INTERRUMPIDA'
        });
      });
      Database.instance = this;
    }
    return Database.instance;
  }

  async query(text, params) {
    return this.pool.query(text, params);
  }

  async connect() {
    return this.pool.connect();
  }
}

// Congelamos el objeto para que nada lo modifique accidentalmente
const instance = new Database();
Object.freeze(instance);

module.exports = instance;
