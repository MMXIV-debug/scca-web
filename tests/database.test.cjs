const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function cargarDatabase() {
  const mensajes = [];
  class Pool extends EventEmitter {
    constructor(config) { super(); this.config = config; }
    async connect() {
      const c = this.client ||= new EventEmitter();
      if (this.idle) c.removeListener('error', this.idle);
      c.release = error => {
        c.descartado = Boolean(error);
        this.idle = e => this.emit('error', e);
        c.on('error', this.idle);
      };
      return c;
    }
    async query() { return { rows: [{ n: 1 }] }; }
  }
  const contexto = { module: { exports: {} }, process: { env: {} },
    console: { error: (...args) => mensajes.push(args) },
    require(nombre) {
      if (nombre === 'pg') return { Pool };
      if (nombre === 'dotenv') return { config() {} };
      throw new Error('Dependencia inesperada');
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../db/database.js'), 'utf8'), contexto);
  return { db: contexto.module.exports, mensajes };
}

test('PostgreSQL: un corte entre consultas del cliente prestado no produce un error sin manejar', async () => {
  const { db, mensajes } = cargarDatabase();
  const c = await db.connect();
  const corte = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
  assert.doesNotThrow(() => c.emit('error', corte));
  assert.equal(mensajes.length, 1);
  assert.equal(mensajes[0][1].codigo, 'ECONNRESET');
  c.release(corte);
  assert.equal(c.descartado, true);
  assert.equal(c.listenerCount('error'), 1); // Vuelve a quedar solo el listener del pool.
  assert.equal((await db.query('SELECT 1')).rows[0].n, 1);
});

test('PostgreSQL: al reutilizar un cliente no se acumulan listeners y los errores libres siguen manejados', async () => {
  const { db, mensajes } = cargarDatabase();
  for (let i = 0; i < 20; i++) {
    const c = await db.connect();
    assert.equal(c.listenerCount('error'), 1);
    c.release();
    assert.equal(c.listenerCount('error'), 1);
  }
  assert.doesNotThrow(() => db.pool.client.emit('error', new Error('Conexión cerrada')));
  assert.equal(mensajes.length, 1);
});
