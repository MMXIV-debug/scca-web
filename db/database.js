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
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000,
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
    const client = await this.pool.connect();
    // pg-pool solo escucha los errores de clientes libres. Una transacción
    // puede perder la red entre consultas (por ejemplo mientras espera una API).
    // Mantener el listener durante todo el préstamo evita un 'error' sin manejar;
    // las consultas siguen rechazándose para que el servicio aborte la operación.
    const onError = error => {
      console.error('Conexión PostgreSQL en uso interrumpida; la operación no pudo completarse.', {
        codigo: error.code || 'CONEXION_INTERRUMPIDA'
      });
    };
    client.on('error', onError);
    const release = client.release;
    client.release = (...args) => {
      try { return release(...args); }
      finally { client.removeListener('error', onError); }
    };
    return client;
  }
}

// Congelamos el objeto para que nada lo modifique accidentalmente
const instance = new Database();
Object.freeze(instance);

module.exports = instance;
