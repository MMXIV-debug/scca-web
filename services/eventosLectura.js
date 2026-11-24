const { EventEmitter } = require('node:events');

class LecturaEmitter extends EventEmitter {
  constructor() {
    super({ captureRejections: true });
    this.setMaxListeners(0); // Cada panel abierto se suscribe y se retira al cerrar la conexión.
    this.on('error', e => console.error('Observer: no se pudo procesar un aviso.', e?.code || e?.message || 'ERROR_OBSERVADOR'));
  }
  async publicar(nombre, datos) {
    const resultados = await Promise.allSettled(this.rawListeners(nombre)
      .map(fn => Promise.resolve().then(() => fn.call(this, datos))));
    for (const r of resultados) if (r.status === 'rejected') this.emit('error', r.reason);
  }
}
const lecturaEventos = new LecturaEmitter();
const eventosRecepcion = ['NuevaLecturaConfirmada', 'MuestraEnCuarentena', 'RecepcionRestablecida'];
const eventosPanel = [...eventosRecepcion, 'AlertasActualizadas'];

function iniciarObservadores(pool, { eventos = lecturaEventos, canal = 'scca_lecturas',
  ambientales = () => require('./alertasAmbientalesService').comprobarAmbientales(pool),
  tecnicas = () => require('./alertasService').crearAlertasService(pool).comprobar(null,
    process.env.ML_POLITICA_VERSIONADA === 'true' ? null : Number(process.env.ALERTAS_SIN_DATOS_S || 300)) } = {}) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(canal)) throw new Error('Canal de notificaciones inválido.');
  let cerrado = false, cliente = null, conectando = false, reintento;
  let ejecutando = false, pendiente = false;
  async function evaluarAlertas() {
    pendiente = true;
    if (ejecutando) return;
    ejecutando = true;
    try {
      while (pendiente && !cerrado) {
        pendiente = false;
        const tareas = [];
        if (process.env.ALERTAS_AMBIENTALES_AUTO === 'true') tareas.push(Promise.resolve().then(ambientales));
        if (process.env.ALERTAS_TECNICAS_HABILITADAS === 'true' && process.env.ALERTAS_TECNICAS_AUTO === 'true') tareas.push(Promise.resolve().then(tecnicas));
        const resultados = await Promise.allSettled(tareas);
        for (const r of resultados) if (r.status === 'rejected') eventos.emit('error', r.reason);
        if (resultados.some(r => r.status === 'fulfilled')) await eventos.publicar('AlertasActualizadas', {});
      }
    } finally { ejecutando = false; }
  }
  eventosRecepcion.forEach(nombre => eventos.on(nombre, evaluarAlertas));

  async function conectar() {
    if (cerrado || conectando) return;
    conectando = true;
    let c, liberado = false;
    const notificar = mensaje => {
      if (mensaje.channel !== canal) return;
      try {
        const dato = JSON.parse(mensaje.payload);
        if (!Number.isSafeInteger(dato.sensor_id) || dato.sensor_id <= 0
          || !/^[1-9]\d*$/.test(String(dato.id_muestra)) || !['guardada', 'cuarentena'].includes(dato.estado)) return;
        void eventos.publicar(dato.estado === 'guardada' ? 'NuevaLecturaConfirmada' : 'MuestraEnCuarentena', dato);
      } catch { /* Ignorar notificaciones ajenas al contrato. */ }
    };
    const desconectar = error => {
      if (liberado) return;
      liberado = true;
      if (c) {
        c.removeListener('notification', notificar);
        c.removeListener('error', desconectar);
        c.removeListener('end', fin);
        if (cliente?.c === c) cliente = null;
        c.release(error || new Error('Suscripción PostgreSQL cerrada'));
      }
      if (!cerrado) {
        reintento = setTimeout(conectar, 5000);
        reintento.unref();
      }
    };
    const fin = () => desconectar(new Error('Conexión de notificaciones finalizada'));
    try {
      c = await pool.connect();
      if (cerrado) { desconectar(); return; }
      cliente = { c, desconectar };
      c.on('notification', notificar);
      c.on('error', desconectar);
      c.on('end', fin);
      await c.query(`LISTEN "${canal}"`);
      if (!liberado) void eventos.publicar('RecepcionRestablecida', {});
    } catch (e) {
      eventos.emit('error', e);
      desconectar(e);
    } finally { conectando = false; }
  }
  void conectar();
  return () => {
    cerrado = true;
    clearTimeout(reintento);
    eventosRecepcion.forEach(nombre => eventos.removeListener(nombre, evaluarAlertas));
    cliente?.desconectar();
  };
}

function suscribirPanel(req, res, eventos = lecturaEventos) {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const avisar = () => {
    if (!res.write('data: {"tipo":"lecturas_actualizadas"}\n\n')) res.end();
  };
  eventosPanel.forEach(nombre => eventos.on(nombre, avisar));
  const pulso = setInterval(() => res.write(': mantener conexion\n\n'), 15000);
  const renovar = setTimeout(() => res.end(), 60000);
  res.once('close', () => {
    clearInterval(pulso);
    clearTimeout(renovar);
    eventosPanel.forEach(nombre => eventos.removeListener(nombre, avisar));
  });
  avisar();
}

module.exports = lecturaEventos;
module.exports.LecturaEmitter = LecturaEmitter;
module.exports.iniciarObservadores = iniciarObservadores;
module.exports.suscribirPanel = suscribirPanel;
