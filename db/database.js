const { Pool } = require('pg');
require('dotenv').config();

class Database {
  constructor() {
    // Si la instancia ya existe, no creamos una nueva
    if (!Database.instance) {
      this.pool = new Pool({ connectionString: process.env.DATABASE_URL });
      Database.instance = this;
    }
    return Database.instance;
  }

  // El pool elige una conexión para ejecutar una consulta independiente.
  async query(text, params) {
    return this.pool.query(text, params);
  }

  // Reserva una conexión para operaciones que deben compartir una transacción.
  async connect() {
    return this.pool.connect();
  }
}

// Congelamos el objeto para que nada lo modifique accidentalmente
const instance = new Database();
Object.freeze(instance);

module.exports = instance;