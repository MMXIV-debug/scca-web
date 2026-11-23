const assert = require('node:assert/strict');
const { Client } = require('pg');
const database = process.env.SCCA_TEST_DATABASE,
  port = Number(process.env.SCCA_TEST_PORT);
if (!database?.startsWith('scca_test_') || !Number.isInteger(port) || port < 1024)
  throw Error('Base temporal local requerida.');
process.env.DATABASE_URL = `postgresql://scca_test@127.0.0.1:${port}/${database}`;
const db = require('../db/database');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    const pid = (await db.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await c.connect();
    await c.query('SELECT pg_terminate_backend($1)', [pid]);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal((await db.query('SELECT 1 AS n')).rows[0].n, 1);
    console.log('OK: la desconexión del pool no termina Node y la siguiente consulta reconecta.');
    const prestado = await db.connect();
    try {
      const pidPrestado = (await prestado.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      // Sin ninguna consulta activa: reproduce la espera de una API dentro de una transacción.
      await c.query('SELECT pg_terminate_backend($1)', [pidPrestado]);
      await new Promise(r => setTimeout(r, 150));
      await assert.rejects(prestado.query('SELECT 1'));
    } finally { prestado.release(new Error('Conexión de prueba interrumpida')); }
    assert.equal((await db.query('SELECT 1 AS n')).rows[0].n, 1);
    console.log('OK: el cliente prestado maneja el corte entre consultas y el pool se recupera.');
  } finally {
    await c.end();
    await db.pool.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
