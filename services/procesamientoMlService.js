const { vigente } = require('./politicasService');
const { evaluar, ml } = require('./panelMlService');
let ultimoEstado = { estado: 'sin_ejecutar' };
async function procesar(pool) {
  const politica = await vigente(pool),
    registro = await ml('api/v2/modelos/registro');
  const fin = new Date();
  fin.setUTCMinutes(0, 0, 0);
  const inicio = new Date(+fin - 3600000);
  const resultado = {
    estado: 'completado',
    periodo_inicio: inicio.toISOString(),
    politica_version: politica.version,
    resultados: [],
    errores: [],
  };
  for (const m of (registro.activos || registro.items.filter((m) => m.activo)).filter((m) =>
    ['calibracion', 'pronostico'].includes(m.proposito),
  )) {
    try {
      const r = await evaluar({
        sensorId: m.sensor.sensor_id,
        proposito: m.proposito,
        variable: m.variable,
        horizonteH: m.horizonte_h,
        horaInicio: inicio.toISOString(),
        guardarResultado: true,
      });
      resultado.resultados.push({
        sensor_id: m.sensor.sensor_id,
        proposito: m.proposito,
        horizonte_h: m.horizonte_h,
        estado: r.estado,
        resultado_id: r.resultado_id,
      });
    } catch {
      resultado.errores.push({
        sensor_id: m.sensor.sensor_id,
        proposito: m.proposito,
        horizonte_h: m.horizonte_h,
      });
    }
  }
  if (resultado.errores.length) resultado.estado = 'completado_con_errores';
  ultimoEstado = resultado;
  return resultado;
}
function iniciarProcesamiento(pool) {
  if (process.env.ML_RESULTADOS_AUTO !== 'true') return;
  let ejecutando = false;
  const revisar = async () => {
    if (ejecutando) return;
    ejecutando = true;
    try {
      await procesar(pool);
    } catch {
      ultimoEstado = { estado: 'dependencia_no_disponible', fecha: new Date().toISOString() };
    } finally {
      ejecutando = false;
    }
  };
  const t = setInterval(revisar, 300000);
  t.unref();
  revisar();
  return t;
}
module.exports = { procesar, iniciarProcesamiento, estado: () => ultimoEstado };
