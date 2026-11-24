// Integración optativa: canal aislado, sin insertar lecturas ni modificar tablas.
require('dotenv').config({ quiet: true });
const assert = require('node:assert/strict');
const { once } = require('node:events');
const db = require('../db/database');
const { LecturaEmitter, iniciarObservadores } = require('../services/eventosLectura');
const esperar = ms => new Promise(r => setTimeout(r, ms));
const recibir = (bus, nombre) => once(bus, nombre, { signal: AbortSignal.timeout(12000) });

(async () => {
  const eventos = new LecturaEmitter(), conexiones = [];
  const canal = `scca_prueba_observer_${process.pid}`;
  const pool = { async connect() { const c = await db.connect(); conexiones.push(c); return c; } };
  const listo = recibir(eventos, 'RecepcionRestablecida');
  const detener = iniciarObservadores(pool, { eventos, canal, ambientales: async () => {}, tecnicas: async () => {} });
  let emisor;
  try {
    await listo;
    emisor = await db.connect();
    let recibidas = 0;
    eventos.on('NuevaLecturaConfirmada', () => { recibidas++; });
    const payload = JSON.stringify({ sensor_id: 1, id_muestra: '123', estado: 'guardada' });
    await emisor.query('BEGIN');
    await emisor.query('SELECT pg_notify($1,$2)', [canal, payload]);
    await esperar(200);
    assert.equal(recibidas, 0, 'No debe notificar antes del commit');
    const confirmada = recibir(eventos, 'NuevaLecturaConfirmada');
    await emisor.query('COMMIT');
    await confirmada;
    await emisor.query('BEGIN');
    await emisor.query('SELECT pg_notify($1,$2)', [canal, payload]);
    await emisor.query('ROLLBACK');
    await esperar(200);
    assert.equal(recibidas, 1, 'No debe notificar un rollback');
    const recuperada = recibir(eventos, 'RecepcionRestablecida');
    conexiones[0].connection.stream.destroy(Object.assign(new Error('Corte controlado de prueba'), { code: 'ECONNRESET' }));
    await recuperada;
    const posterior = recibir(eventos, 'NuevaLecturaConfirmada');
    await emisor.query('SELECT pg_notify($1,$2)', [canal, payload]);
    await posterior;
    assert.equal(recibidas, 2);
    console.log('OK: Observer recibe solo tras COMMIT, ignora ROLLBACK y reconecta después de ECONNRESET.');
  } finally {
    detener();
    emisor?.release();
    await db.pool.end();
  }
})().catch(e => { console.error(e.code || e.message); process.exitCode = 1; });
