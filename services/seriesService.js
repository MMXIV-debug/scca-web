const { vigente } = require('./politicasService');
function filtros(q) {
  const result = {};
  for (const k of ['sensorId', 'nodoId']) {
    if (q[k] != null) {
      const n = Number(q[k]);
      if (!Number.isSafeInteger(n) || n <= 0)
        throw Object.assign(Error('Filtro de fuente inválido.'), { status: 400 });
      result[k] = n;
    }
  }
  return result;
}
async function horas(pool, cantidad, q = {}, incluirHoraActual = false) {
  const p = await vigente(pool),
    f = filtros(q);
  const { rows } = await pool.query(
    `
 WITH fuentes AS (SELECT s.id AS sensor_id,s.nodo_id,s.origen,s.modelo,v.id AS variable_id,v.codigo,u.simbolo AS unidad,
 CASE WHEN $1::jsonb ? s.id::text THEN ($1::jsonb->>s.id::text)::int WHEN s.origen='real' THEN n.intervalo_muestreo_s ELSE NULL END AS intervalo
 FROM sensor s JOIN nodo n ON n.id=s.nodo_id JOIN sensor_variable sv ON sv.sensor_id=s.id JOIN variable v ON v.id=sv.variable_id JOIN unidad u ON u.id=v.unidad_id
 WHERE s.activo AND ($4::int IS NULL OR s.id=$4) AND ($5::int IS NULL OR n.id=$5)),
 slots AS (SELECT f.sensor_id,f.codigo,date_bin(make_interval(secs=>f.intervalo),l.medido_en,TIMESTAMPTZ '1970-01-01 00:00:00+00') AS slot,AVG(l.valor) AS valor
 FROM fuentes f JOIN lectura_original l ON l.sensor_id=f.sensor_id AND l.variable_id=f.variable_id
 WHERE f.intervalo BETWEEN 1 AND 3600 AND 3600%f.intervalo=0 AND l.calidad='valida' AND l.medido_en>=(date_trunc('hour',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')-make_interval(hours=>$2) AND l.medido_en<(date_trunc('hour',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')+CASE WHEN $6::boolean THEN interval '1 hour' ELSE interval '0 hours' END AND l.medido_en<=now()
 GROUP BY f.sensor_id,f.codigo,slot),
 h AS (SELECT sensor_id,codigo,date_trunc('hour',slot AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS hora,AVG(valor)::float AS valor,COUNT(*) AS n FROM slots GROUP BY sensor_id,codigo,hora)
 SELECT f.sensor_id,f.nodo_id,f.origen,f.modelo,f.codigo,f.unidad,f.intervalo,g.hora,
 CASE WHEN h.n>=3600.0/f.intervalo*$3 THEN h.valor ELSE NULL END AS valor,h.valor AS valor_observado,
 COALESCE(h.n,0)::int AS intervalos_con_datos,
 g.hora<(date_trunc('hour',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS hora_cerrada,
 COALESCE(h.n/(3600.0/NULLIF(f.intervalo,0)),0)::float AS cobertura
 FROM fuentes f CROSS JOIN LATERAL generate_series((date_trunc('hour',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')-make_interval(hours=>$2),(date_trunc('hour',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')-CASE WHEN $6::boolean THEN interval '0 hours' ELSE interval '1 hour' END,interval '1 hour') g(hora)
 LEFT JOIN h ON h.sensor_id=f.sensor_id AND h.codigo=f.codigo AND h.hora=g.hora ORDER BY g.hora,f.sensor_id,f.codigo`,
    [
      p.configuracion.intervalos_sensor || {},
      cantidad,
      Number(p.completitud_min_pct) / 100,
      f.sensorId || null,
      f.nodoId || null,
      incluirHoraActual,
    ],
  );
  return rows;
}
async function seriesVisualizador(pool, cantidad, q = {}) {
  return (await horas(pool, cantidad, q, true)).map(r => ({
    ...r,
    valor: r.valor_observado ?? r.valor,
    parcial: r.valor == null || r.hora_cerrada === false,
  }));
}
async function semanal(pool, q) {
  const rows = await seriesVisualizador(pool, 168, q),
    grupos = new Map();
  for (const r of rows) {
    if (r.valor == null) continue;
    const key = r.sensor_id + '/' + r.codigo;
    if (!grupos.has(key)) grupos.set(key, { ...r, valores: [], horas_validas: 0, incluye_parciales: false });
    const grupo = grupos.get(key);
    grupo.valores.push(r.valor);
    if (!r.parcial) grupo.horas_validas++;
    else grupo.incluye_parciales = true;
  }
  return [...grupos.values()].map(({ valores, ...r }) => ({
    ...r,
    promedio: Number((valores.reduce((a, b) => a + b, 0) / valores.length).toFixed(2)),
    minimo: Math.min(...valores),
    maximo: Math.max(...valores),
    horas_con_datos: valores.length,
  }));
}
async function resumen(pool, calcular, q) {
  const p = await vigente(pool),
    rows = (await horas(pool, 24, q)).filter((r) => r.codigo === 'PM25'),
    fuentes = new Map();
  for (const r of rows) {
    if (!fuentes.has(r.sensor_id)) fuentes.set(r.sensor_id, { ...r, valores: [] });
    if (r.valor != null) fuentes.get(r.sensor_id).valores.push(r.valor);
  }
  const fuente = [...fuentes.values()].sort(
    (a, b) =>
      (a.origen === 'real' ? 0 : 1) - (b.origen === 'real' ? 0 : 1) || a.sensor_id - b.sensor_id,
  )[0];
  const datos = {
    ica_score: '-',
    ica_estado: 'Sin cobertura suficiente',
    ica_color: 'secondary',
    periodo_h: 24,
    horas_validas: fuente?.valores.length || 0,
    horas_requeridas: Math.ceil((24 * Number(p.completitud_min_pct)) / 100),
    completitud_min_pct: Number(p.completitud_min_pct),
    ultima_pm25: null,
    motivo: 'No hay una fuente activa de PM2.5.',
    calibracion_fisica_validada: false,
    fuente: fuente
      ? { sensor_id: fuente.sensor_id, nodo_id: fuente.nodo_id, origen: fuente.origen }
      : null,
  };
  const counts = (
    await pool.query(
      "SELECT (SELECT count(*)::int FROM sitio) AS sitios_definidos,(SELECT count(*)::int FROM nodo WHERE estado='activo') AS nodos_ubicados",
    )
  ).rows[0];
  if (fuente) {
    const ultima = (
      await pool.query(
        `SELECT l.medido_en,l.valor::float AS valor,u.simbolo AS unidad
         FROM lectura_original l JOIN variable v ON v.id=l.variable_id
         JOIN unidad u ON u.id=v.unidad_id
         WHERE l.sensor_id=$1 AND l.calidad='valida' AND v.codigo='PM25'
         ORDER BY l.medido_en DESC,l.id DESC LIMIT 1`,
        [fuente.sensor_id],
      )
    ).rows[0];
    datos.ultima_pm25 = ultima || null;
    const muestrasPorHora = fuente.intervalo ? Math.ceil(3600 / fuente.intervalo * Number(p.completitud_min_pct) / 100) : null;
    datos.motivo = `${datos.horas_validas} de ${datos.horas_requeridas} horas válidas requeridas en las últimas 24 horas cerradas. `
      + (muestrasPorHora ? `Cada hora necesita al menos ${muestrasPorHora} intervalos con lecturas válidas de PM2.5.` : 'Configura el intervalo de muestreo de esta fuente.');
    if (fuente.valores.length >= datos.horas_requeridas && ultima && Date.now() - new Date(ultima.medido_en) < 3600000) {
      const promedio = fuente.valores.reduce((a, b) => a + b, 0) / fuente.valores.length,
        r = calcular(promedio);
      Object.assign(datos, {
        ica_score: r.score,
        ica_estado: r.label,
        ica_color: r.color,
        pm25_promedio_24h: promedio,
        motivo: 'Cobertura suficiente y recepción reciente. Índice de demostración calculado con las horas válidas.',
      });
    } else if (fuente.valores.length >= datos.horas_requeridas) {
      datos.ica_estado = 'Datos desactualizados';
      datos.motivo = 'Falta una lectura válida de PM2.5 recibida en la última hora.';
    }
  }
  return { ...counts, ...datos };
}
module.exports = { horas, seriesVisualizador, semanal, resumen, filtros };
