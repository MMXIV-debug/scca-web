const fs = require('node:fs');
const path = require('node:path');
const INTERVALO_MS = 15 * 60 * 1000;

function condicion(codigo, esDia = true) {
  if (codigo === 0) return esDia ? 'Soleado' : 'Despejado';
  if (codigo === 1) return 'Mayormente despejado';
  if (codigo === 2) return 'Parcialmente nublado';
  if (codigo === 3) return 'Nublado';
  if ([45, 48].includes(codigo)) return 'Niebla';
  if ([51, 53, 55].includes(codigo)) return 'Llovizna';
  if ([56, 57, 66, 67].includes(codigo)) return 'Precipitación helada';
  if ([61, 63, 65, 80, 81, 82].includes(codigo)) return 'Lluvioso';
  if ([71, 73, 75, 77, 85, 86].includes(codigo)) return 'Nevada';
  if ([95, 96, 99].includes(codigo)) return 'Tormenta eléctrica';
  return 'Condición desconocida';
}

function normalizar(respuesta, desdeMs) {
  const { current: actual, hourly: horas } = respuesta;
  const fecha = t => {
    if (!Number.isFinite(t) || t <= 0) throw new Error('Fecha meteorológica inválida');
    return new Date(t * 1000).toISOString();
  };
  const dato = (tipo, t, temperatura, codigo, dia, lluvia = null) => {
    if (!Number.isFinite(temperatura) || !Number.isInteger(codigo) || ![0, 1].includes(dia)
      || (lluvia !== null && (!Number.isFinite(lluvia) || lluvia < 0 || lluvia > 100))) {
      throw new Error('Datos meteorológicos incompletos');
    }
    return { tipo, valido_en: fecha(t), temperatura_c: temperatura, codigo_wmo: codigo,
      es_dia: dia === 1, probabilidad_lluvia_pct: lluvia };
  };
  if (!actual || !Array.isArray(horas?.time)) throw new Error('Respuesta meteorológica incompleta');
  const datos = [dato('actual', actual.time, actual.temperature_2m, actual.weather_code, actual.is_day)];
  const desde = desdeMs === undefined ? actual.time : Math.max(actual.time, desdeMs / 1000);
  for (let i = 0; i < horas.time.length; i++) {
    if (horas.time[i] <= desde) continue;
    datos.push(dato('pronostico', horas.time[i], horas.temperature_2m?.[i], horas.weather_code?.[i],
      horas.is_day?.[i], horas.precipitation_probability?.[i]));
    if (datos.length === 25) break;
  }
  if (datos.length !== 25) throw new Error('El proveedor no entregó 24 horas de pronóstico');
  if (Date.parse(datos[1].valido_en) - desde * 1000 > 3600000
    || datos.slice(2).some((d, i) => Date.parse(d.valido_en) - Date.parse(datos[i + 1].valido_en) !== 3600000)) {
    throw new Error('El pronóstico tiene huecos horarios');
  }
  return datos;
}

function normalizarDiario(dias) {
  if (!dias) return [];
  if (!Array.isArray(dias.time)) throw new Error('Pronóstico diario incompleto');
  return dias.time.map((t, i) => {
    const min = dias.temperature_2m_min?.[i], max = dias.temperature_2m_max?.[i];
    const codigo = dias.weather_code?.[i], lluvia = dias.precipitation_probability_max?.[i];
    if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(min) || !Number.isFinite(max)
      || min > max || !Number.isInteger(codigo)
      || (lluvia != null && (!Number.isFinite(lluvia) || lluvia < 0 || lluvia > 100))) {
      throw new Error('Pronóstico diario inválido');
    }
    return { valido_en: new Date(t * 1000).toISOString(), minima_c: min, maxima_c: max,
      codigo_wmo: codigo, condicion: condicion(codigo), probabilidad_lluvia_pct: lluvia ?? null };
  });
}

function crearClimaService(pool, { fetchApi = fetch, ahora = () => Date.now() } = {}) {
  let ejecutando = false;
  async function preparar() {
    const { rows } = await pool.query(
      "SELECT to_regclass('public.clima_consulta') IS NOT NULL AND to_regclass('public.clima_dato') IS NOT NULL AS listas",
    );
    if (rows[0]?.listas) return;
    await pool.query(fs.readFileSync(path.join(__dirname, '../db/13_pronostico_clima.sql'), 'utf8'));
  }
  async function actualizarSitio(sitio) {
    const c = await pool.connect();
    let fallo;
    try {
      await c.query('BEGIN');
      const lock = await c.query('SELECT pg_try_advisory_xact_lock(193839, $1) AS adquirido', [sitio.id]);
      if (!lock.rows[0].adquirido) { await c.query('ROLLBACK'); return; }
      const previa = await c.query(`SELECT id FROM clima_consulta WHERE sitio_id=$1 AND latitud=$2 AND longitud=$3
        AND consultado_en > $4::timestamptz AND respuesta ? 'daily' LIMIT 1`,
      [sitio.id, sitio.latitud, sitio.longitud, new Date(ahora() - INTERVALO_MS).toISOString()]);
      if (previa.rowCount) { await c.query('COMMIT'); return; }
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.search = new URLSearchParams({ latitude: sitio.latitud, longitude: sitio.longitud,
        current: 'temperature_2m,weather_code,is_day',
        hourly: 'temperature_2m,weather_code,is_day,precipitation_probability',
        daily: 'temperature_2m_min,temperature_2m_max,weather_code,precipitation_probability_max',
        forecast_days: '7', timezone: 'America/La_Paz', timeformat: 'unixtime', temperature_unit: 'celsius' }).toString();
      const r = await fetchApi(url, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`Proveedor HTTP ${r.status}`);
      const respuesta = await r.json();
      const datos = normalizar(respuesta, ahora());
      normalizarDiario(respuesta.daily);
      const insert = await c.query(`INSERT INTO clima_consulta(sitio_id,latitud,longitud,respuesta,consultado_en)
        VALUES($1,$2,$3,$4::jsonb,$5) RETURNING id`,
      [sitio.id, sitio.latitud, sitio.longitud, JSON.stringify(respuesta), new Date(ahora()).toISOString()]);
      await c.query(`INSERT INTO clima_dato(consulta_id,tipo,valido_en,temperatura_c,codigo_wmo,es_dia,probabilidad_lluvia_pct)
        SELECT $1,tipo,valido_en,temperatura_c,codigo_wmo,es_dia,probabilidad_lluvia_pct
        FROM jsonb_to_recordset($2::jsonb) AS d(tipo text,valido_en timestamptz,temperatura_c double precision,
          codigo_wmo integer,es_dia boolean,probabilidad_lluvia_pct double precision)`, [insert.rows[0].id, JSON.stringify(datos)]);
      await c.query('COMMIT');
    } catch (e) {
      fallo = e;
      // La conexión puede haber muerto mientras se consultaba al proveedor.
      // Un ROLLBACK fallido no debe ocultar el error original ni reciclar el cliente.
      try { await c.query('ROLLBACK'); } catch { /* Se descarta al liberar. */ }
      throw e;
    } finally { c.release(fallo); }
  }
  async function actualizar() {
    if (ejecutando) return;
    ejecutando = true;
    try {
      const { rows } = await pool.query('SELECT id,latitud,longitud FROM sitio ORDER BY id');
      for (const sitio of rows) {
        try { await actualizarSitio(sitio); }
        catch (e) { console.error(`Clima: no se pudo actualizar el sitio ${sitio.id}.`, e.code || e.message); }
      }
    } finally { ejecutando = false; }
  }
  async function listar() {
    const { rows } = await pool.query(`SELECT s.id AS sitio_id,s.nombre,s.latitud,s.longitud,
      c.id::text AS consulta_id,c.proveedor,c.consultado_en,c.respuesta->'daily' AS diario_original,
      COALESCE((SELECT jsonb_agg(to_jsonb(d) - 'consulta_id' ORDER BY d.valido_en,d.tipo)
        FROM clima_dato d WHERE d.consulta_id=c.id),'[]'::jsonb) AS datos
      FROM sitio s LEFT JOIN LATERAL (SELECT * FROM clima_consulta cc
        WHERE cc.sitio_id=s.id AND cc.latitud=s.latitud AND cc.longitud=s.longitud
        ORDER BY cc.consultado_en DESC,cc.id DESC LIMIT 1) c ON true ORDER BY s.id`);
    return { intervalo_s: INTERVALO_MS / 1000, items: rows.map(({ diario_original, ...s }) => ({ ...s,
      diario: normalizarDiario(diario_original),
      desactualizado: !s.consultado_en || ahora() - new Date(s.consultado_en).getTime() > INTERVALO_MS * 2
        || !s.datos.some(d => d.tipo === 'actual' && Math.abs(ahora() - Date.parse(d.valido_en)) <= 3600000),
      datos: s.datos.map(d => ({ ...d, condicion: condicion(d.codigo_wmo, d.es_dia) })) })) };
  }
  return { preparar, actualizar, listar };
}

function iniciarClima(servicio) {
  let preparado = false;
  async function ciclo() {
    try {
      if (!preparado) { await servicio.preparar(); preparado = true; }
      await servicio.actualizar();
    } catch (e) { console.error('Clima: sincronización pendiente.', e.code || e.message); }
  }
  ciclo();
  // Reintenta fallos cada minuto; las consultas exitosas se espacian 15 minutos en PostgreSQL.
  const timer = setInterval(ciclo, 60000);
  timer.unref();
  return timer;
}
module.exports = { crearClimaService, iniciarClima, normalizar, normalizarDiario, condicion };
