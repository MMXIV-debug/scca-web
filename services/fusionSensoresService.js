const fisico = r => r.origen === 'real' && ['DHT11', 'BME680'].includes(r.modelo?.trim().toUpperCase())
  && ['TEMP', 'HUM'].includes(r.codigo);

function combinar(filas, { actual = false, ahora = Date.now() } = {}) {
  const grupos = new Map(), otras = [];
  for (const r of filas) {
    if (!fisico(r)) { otras.push(r); continue; }
    const key = `${r.sitio_id}/${r.codigo}/${actual ? '' : new Date(r.hora).toISOString()}`;
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key).push(r);
  }
  for (const fuentes of grupos.values()) {
    const base = fuentes[0];
    const candidatas = fuentes.filter(r => {
      const fecha = new Date(r.ultima_fecha).getTime();
      const vigente = !actual && r.hora_cerrada !== false
        || Number.isFinite(fecha) && fecha <= ahora && ahora - fecha <= Math.max(1800, 3 * Number(r.intervalo || 60)) * 1000;
      return r.sitio_id != null && r.valor != null && Number.isFinite(Number(r.valor))
        && r.unidad === (r.codigo === 'TEMP' ? '°C' : '%')
        && (r.codigo === 'HUM' ? Number(r.valor) >= 0 && Number(r.valor) <= 100
          : Number(r.valor) >= (r.modelo.trim().toUpperCase() === 'DHT11' ? 0 : -40)
            && Number(r.valor) <= (r.modelo.trim().toUpperCase() === 'DHT11' ? 50 : 85))
        && r.ml_utilizable === true && vigente && (actual || Number(r.cobertura) > 0);
    }).sort((a, b) => Number(b.cobertura || 1) - Number(a.cobertura || 1)
      || new Date(b.ultima_fecha) - new Date(a.ultima_fecha) || a.sensor_id - b.sensor_id);
    const elegidas = [];
    for (const r of candidatas) {
      if (elegidas.some(e => e.modelo.trim().toUpperCase() === r.modelo.trim().toUpperCase() || e.nodo_id === r.nodo_id)) continue;
      elegidas.push(r);
    }
    const pesos = elegidas.map(r => actual ? 1 : Math.min(1, Number(r.cobertura)));
    const total = pesos.reduce((a, b) => a + b, 0);
    const valor = total ? elegidas.reduce((s, r, i) => s + Number(r.valor) * pesos[i] / total, 0) : null;
    const componentes = elegidas.map((r, i) => ({ sensor_id: r.sensor_id, nodo_id: r.nodo_id,
      modelo: r.modelo, porcentaje: Math.round(pesos[i] / total * 10000) / 100,
      valor: Number(r.valor), fecha: r.ultima_fecha }));
    otras.push({ sitio_id: base.sitio_id, sensor_id: `fusion:${base.sitio_id}`, nodo_id: null,
      codigo: base.codigo, parametro: base.codigo === 'TEMP' ? 'Temperatura' : 'Humedad relativa',
      unidad: base.unidad, origen: 'real', modelo: 'DHT11/BME680', fusion: true,
      hora: base.hora, hora_cerrada: base.hora_cerrada,
      valor: valor == null ? null : Math.round(valor * 100) / 100,
      ultima_medicion: valor == null ? null : Math.round(valor * 100) / 100,
      ultima_fecha: elegidas.length ? new Date(Math.max(...elegidas.map(r => +new Date(r.ultima_fecha)))).toISOString() : null,
      cobertura: total ? elegidas.reduce((s, r, i) => s + Number(r.cobertura ?? 1) * pesos[i] / total, 0) : 0,
      parcial: !elegidas.length || elegidas.some(r => r.parcial), componentes,
      estado_fusion: elegidas.length === 2 ? 'ponderada' : elegidas.length === 1 ? 'respaldo' : 'sin_datos_validos',
      calibracion_fisica_validada: false });
  }
  return otras;
}

async function mediciones(pool) {
  const { rows } = await pool.query(`
    SELECT s.id AS sensor_id,s.nodo_id,n.sitio_id,s.origen,upper(trim(s.modelo)) AS modelo,
      v.codigo,u.simbolo AS unidad,n.intervalo_muestreo_s AS intervalo,
      l.valor::float AS valor,e.medido_en AS ultima_fecha,
      (e.estado='evaluado_demo' AND e.es_anomalia=false AND e.modelo_version IS NOT NULL
        AND e.nodo_id=s.nodo_id AND e.perfil=lower(trim(s.modelo))
        AND n.estado='activo' AND l.calidad='valida') AS ml_utilizable
    FROM sensor s JOIN nodo n ON n.id=s.nodo_id
    JOIN sensor_variable sv ON sv.sensor_id=s.id JOIN variable v ON v.id=sv.variable_id
    JOIN unidad u ON u.id=v.unidad_id
    LEFT JOIN LATERAL (SELECT * FROM evaluacion_muestra em WHERE em.sensor_id=s.id
      ORDER BY em.medido_en DESC,em.id_muestra DESC LIMIT 1) e ON true
    LEFT JOIN lectura_original l ON l.sensor_id=s.id AND l.id_muestra=e.id_muestra AND l.variable_id=v.id
    WHERE s.activo AND s.origen='real' AND upper(trim(s.modelo)) IN ('DHT11','BME680')
      AND v.codigo IN ('TEMP','HUM')`);
  return combinar(rows, { actual: true });
}

module.exports = { combinar, mediciones, fisico };
