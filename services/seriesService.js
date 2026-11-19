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
async function horas(pool, cantidad, q = {}) {
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
 WHERE f.intervalo BETWEEN 1 AND 3600 AND 3600%f.intervalo=0 AND l.calidad='valida' AND l.medido_en>=(date_trunc('hour',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')-make_interval(hours=>$2) AND l.medido_en<(date_trunc('hour',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
 GROUP BY f.sensor_id,f.codigo,slot),
 h AS (SELECT sensor_id,codigo,date_trunc('hour',slot AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS hora,AVG(valor)::float AS valor,COUNT(*) AS n FROM slots GROUP BY sensor_id,codigo,hora)
 SELECT f.sensor_id,f.nodo_id,f.origen,f.modelo,f.codigo,f.unidad,g.hora,
 CASE WHEN h.n>=3600.0/f.intervalo*$3 THEN h.valor ELSE NULL END AS valor,COALESCE(h.n/(3600.0/NULLIF(f.intervalo,0)),0)::float AS cobertura
 FROM fuentes f CROSS JOIN LATERAL generate_series((date_trunc('hour',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')-make_interval(hours=>$2),(date_trunc('hour',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')-interval '1 hour',interval '1 hour') g(hora)
 LEFT JOIN h ON h.sensor_id=f.sensor_id AND h.codigo=f.codigo AND h.hora=g.hora ORDER BY g.hora,f.sensor_id,f.codigo`,
    [
      p.configuracion.intervalos_sensor || {},
      cantidad,
      Number(p.completitud_min_pct) / 100,
      f.sensorId || null,
      f.nodoId || null,
    ],
  );
  return rows;
}
async function semanal(pool, q) {
  const rows = await horas(pool, 168, q),
    grupos = new Map();
  for (const r of rows) {
    if (r.valor == null) continue;
    const key = r.sensor_id + '/' + r.codigo;
    if (!grupos.has(key)) grupos.set(key, { ...r, valores: [] });
    grupos.get(key).valores.push(r.valor);
  }
  return [...grupos.values()].map(({ valores, ...r }) => ({
    ...r,
    promedio: Number((valores.reduce((a, b) => a + b, 0) / valores.length).toFixed(2)),
    minimo: Math.min(...valores),
    maximo: Math.max(...valores),
    horas_validas: valores.length,
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
  if (fuente && fuente.valores.length >= Math.ceil((24 * Number(p.completitud_min_pct)) / 100)) {
    const ultima = (
      await pool.query(
        "SELECT max(medido_en) AS ultima FROM lectura_original WHERE sensor_id=$1 AND calidad='valida'",
        [fuente.sensor_id],
      )
    ).rows[0].ultima;
    if (ultima && Date.now() - new Date(ultima) < 3600000) {
      const promedio = fuente.valores.reduce((a, b) => a + b, 0) / fuente.valores.length,
        r = calcular(promedio);
      Object.assign(datos, {
        ica_score: r.score,
        ica_estado: r.label,
        ica_color: r.color,
        pm25_promedio_24h: promedio,
      });
    } else datos.ica_estado = 'Datos desactualizados';
  }
  return { ...counts, ...datos };
}
module.exports = { horas, semanal, resumen, filtros };
