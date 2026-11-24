const path = require('node:path');
const { Pool } = require('pg');

function fecha(valor) {
  return valor ? new Date(valor).toLocaleString('es-BO', { timeZone: 'America/La_Paz', hour12: false }) : 'No disponible';
}

function resumir(resultado, entrada = {}, id = null) {
  const m = resultado.modelo_metadatos || {};
  const valorEntrada = entrada.valores?.[resultado.variable] ?? resultado.entrada_fuente?.valores?.[resultado.variable];
  const tipo = resultado.proposito === 'calibracion' ? 'Valor corregido' : 'Valor pronosticado';
  const lineas = [
    '\n--- Resultado ML ---',
    `Sensor: ${resultado.sensor_id} | Variable: ${resultado.variable} | Propósito: ${resultado.proposito}`,
    `Estado: ${resultado.estado}`,
    `Modelo: ${m.algoritmo || 'No disponible'} | Versión: ${resultado.modelo_version || 'Sin modelo'}`,
    `Hora de entrada (Bolivia): ${fecha(resultado.periodo_inicio)}`,
  ];
  if (valorEntrada != null) lineas.push(`Valor de entrada: ${valorEntrada} ${resultado.unidad || ''}`);
  if (resultado.valor != null) lineas.push(`${tipo}: ${resultado.valor} ${resultado.unidad || ''}`);
  else lineas.push('Sin resultado numérico. Revisa la disponibilidad del modelo y la cobertura de las lecturas.');
  if (resultado.objetivo_inicio) lineas.push(`Periodo objetivo (Bolivia): ${fecha(resultado.objetivo_inicio)} a ${fecha(resultado.objetivo_fin)}`);
  if (resultado.cobertura) lineas.push(`Cobertura por variable: ${JSON.stringify(resultado.cobertura)}`);
  lineas.push(`Fuente de entrada: ${resultado.entrada_fuente ? 'Open-Meteo/CAMS (datos modelados)' : 'Lecturas registradas del sensor'}`);
  if (m.algoritmo === 'persistencia') lineas.push('Respaldo por persistencia: repite el valor de entrada; no demuestra mejora predictiva.');
  lineas.push(id != null ? `Guardado en PostgreSQL: sí | resultado_id: ${id}` : 'Evaluación de consulta: no se solicitó guardar.');
  lineas.push('Uso de demostración; no acredita calibración física.');
  return lineas.join('\n');
}

async function principal(args = process.argv.slice(2)) {
  require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
  if (args.includes('--ayuda')) {
    console.log('npm run ml:consola                      Monitor de modelos y resultados guardados (Ctrl+C para salir)\n'
      + 'npm run ml:consola -- --una-vez          Consultar y salir\n'
      + 'npm run ml:consola -- --sensor 1         Filtrar un sensor\n'
      + 'npm run ml:consola -- --evaluar          Evaluar el pronóstico activo de 1 h, sin guardar');
    return;
  }
  let sensor = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sensor') {
      sensor = Number(args[++i]);
      if (!Number.isSafeInteger(sensor) || sensor < 1) throw Error('Usa --sensor seguido de un número positivo.');
    } else if (!['--una-vez', '--evaluar'].includes(args[i])) throw Error('Opción desconocida. Consulta --ayuda.');
  }
  const clave = process.env.Iot__ApiKey || process.env.IOT_API_KEY;
  if (!clave) throw Error('Falta IOT_API_KEY en .env.');
  async function api(base, ruta, body) {
    let respuesta;
    try {
      respuesta = await fetch(new URL(ruta, base), {
        method: body ? 'POST' : 'GET',
        headers: { 'X-Api-Key': clave, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(45000),
      });
    } catch { throw Error('No se pudo contactar al servicio ML o a la API. Mantén node iniciar.js ejecutándose en otra terminal.'); }
    if (!respuesta.ok) throw Error(`La consulta ML falló (HTTP ${respuesta.status}). Revisa la terminal de node iniciar.js.`);
    return respuesta.json();
  }
  console.log('CONSOLA ML SCCA · Horarios de Bolivia · No modifica las lecturas originales.');
  const baseMl = process.env.Ml__BaseUrl || `http://127.0.0.1:${process.env.ML_PORT || 8000}/`;
  const registro = await api(baseMl, 'api/v2/modelos/registro');
  const activos = (registro.activos || registro.items.filter(m => m.activo)).filter(m => sensor == null || m.sensor.sensor_id === sensor);
  console.log('\nModelos en uso:');
  if (!activos.length) console.log('No hay modelos activos para esta selección.');
  else console.table(activos.map(m => ({ sensor: m.sensor.sensor_id, propósito: m.proposito,
    variable: m.variable, horizonte: m.horizonte_h ? `${m.horizonte_h} h` : '—', algoritmo: m.algoritmo, versión: m.version })));

  if (args.includes('--evaluar')) {
    const modelo = activos.find(m => m.proposito === 'pronostico' && m.horizonte_h === 1);
    if (!modelo) throw Error('No hay un pronóstico activo de 1 hora para esta selección.');
    const hora = new Date(Math.floor(Date.now() / 3600000) * 3600000 - 3600000);
    const r = await api(`http://127.0.0.1:${process.env.API_PORT || 5051}/`, 'api/modelo/evaluar', {
      sensorId: modelo.sensor.sensor_id, proposito: 'pronostico', variable: modelo.variable,
      horizonteH: 1, horaInicio: hora.toISOString(), guardarResultado: false,
    });
    console.log(resumir(r));
    return;
  }

  if (!process.env.DATABASE_URL) throw Error('Falta DATABASE_URL en .env.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000,
    query_timeout: 10000, options: '-c default_transaction_read_only=on', max: 1 });
  pool.on('error', () => console.error('Se interrumpió la conexión con PostgreSQL. Se intentará consultar nuevamente.'));
  const vistos = new Set();
  let detenido = false, timer, despertar;
  const detener = () => { detenido = true; clearTimeout(timer); despertar?.(); };
  process.once('SIGINT', detener);
  process.once('SIGTERM', detener);
  try {
    do {
      try {
        const { rows } = await pool.query(`SELECT r.id::text,r.resultado,r.entrada
          FROM ml_demo_resultado r JOIN ml_demo_version v ON v.version=r.version
          WHERE ($1::int IS NULL OR v.sensor_id=$1) ORDER BY r.id DESC LIMIT 10`, [sensor]);
        for (const r of rows.reverse()) if (!vistos.has(r.id)) {
          console.log(resumir(r.resultado, r.entrada, r.id));
          vistos.add(r.id);
        }
        if (!vistos.size) console.log('Todavía no hay resultados guardados. Usa Evaluar hora con Guardar en el panel.');
      } catch {
        if (args.includes('--una-vez')) throw Error('No se pudieron consultar los resultados. Revisa PostgreSQL y DATABASE_URL.');
        console.error('No se pudieron consultar resultados. Se reintentará en 15 segundos.');
      }
      if (args.includes('--una-vez') || detenido) break;
      if (!timer) console.log('\nEsperando resultados nuevos cada 15 segundos. El monitor muestra resultados guardados; no entrena modelos. Ctrl+C cierra solo esta consola.');
      await new Promise(resolve => { despertar = resolve; timer = setTimeout(resolve, 15000); });
    } while (!detenido);
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', detener);
    process.removeListener('SIGTERM', detener);
    await pool.end();
  }
}

if (require.main === module) principal().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { resumir, principal };
