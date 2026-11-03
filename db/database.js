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