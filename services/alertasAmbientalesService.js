const { vigente } = require('./politicasService');
async function comprobarAmbientales(
  pool,
  obtenerActivos = async () => {
    const r = await require('./panelMlService').ml('api/v2/modelos/registro');
    return (r.activos || r.items.filter((m) => m.activo)).map((m) => m.version);
  },
) {
  const p = await vigente(pool);
  let activos = [];
  if (p.configuracion.alertas_predictivas?.length) {
    try {
      activos = await obtenerActivos();
    } catch {
      /* No crear alertas con un modelo cuyo estado no se puede verificar. */
    }
  }
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(192839,1)');
    const sensores = (
      await c.query(
        "SELECT s.id,s.nodo_id,s.origen,s.modelo,n.intervalo_muestreo_s FROM sensor s JOIN nodo n ON n.id=s.nodo_id WHERE s.activo AND n.estado NOT IN ('inactivo','mantenimiento')",
      )
    ).rows;
    const fin = new Date();
    fin.setUTCMinutes(0, 0, 0);
    let creadas = 0,
      resueltas = 0;
    const reglasVigentes = new Set();
    async function actualizar(s, regla, valor, umbral, inicio, evidencia) {
      reglasVigentes.add(s.nodo_id + '/' + regla);
      const prev = (
        await c.query(
          "SELECT id FROM alerta WHERE nodo_id=$1 AND regla=$2 AND estado IN ('abierta','atendida') FOR UPDATE",
          [s.nodo_id, regla],
        )
      ).rows;
      if (valor == null) return;
      let id, accion;
      if (valor > umbral && !prev.length) {
        id = (
          await c.query(
            `INSERT INTO alerta(tipo,nodo_id,regla,valor,calidad,periodo_ini,periodo_fin,observacion,evidencia) VALUES('ambiental',$1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [
              s.nodo_id,
              regla,
              valor,
              s.origen === 'simulado' ? 'simulado' : 'original',
              inicio,
              null,
              `Sensor ${s.id}, origen ${s.origen}. Umbral configurado ${umbral}; ${evidencia.tipo}. No acredita calibración física.`,
              {
                ...evidencia,
                periodo_calculo_fin: fin,
                politica_version: p.version,
                politica_id: p.id,
                sensor_id: s.id,
                umbral,
              },
            ],
          )
        ).rows[0].id;
        accion = 'crear';
        creadas++;
      } else if (valor <= umbral && prev.length) {
        for (const a of prev) {
          await c.query("UPDATE alerta SET estado='resuelta',periodo_fin=$2 WHERE id=$1", [
            a.id,
            fin,
          ]);
          await auditar(a.id, 'resolver', { ...evidencia, valor, politica_version: p.version });
          resueltas++;
        }
      }
      if (id) await auditar(id, accion, { ...evidencia, valor, politica_version: p.version });
    }
    async function auditar(id, accion, datos) {
      await c.query(
        "INSERT INTO auditoria_evento(servicio,entidad,entidad_id,accion,motivo,datos_despues,politica_id) VALUES('servicio_ml','alerta',$1,$2,'Evaluación periódica de umbral configurado',$3,$4)",
        [id, accion, JSON.stringify(datos), p.id],
      );
    }
    for (const s of sensores) {
      const perfil =
        s.origen === 'simulado' ? 'contaminantes_simulados' : s.modelo.trim().toLowerCase();
      const intervalo =
        p.configuracion.intervalos_sensor?.[s.id] ||
        (s.origen === 'simulado' ? null : s.intervalo_muestreo_s);
      for (const r of p.configuracion.alertas_ambientales || []) {
        if (r.perfil !== perfil) continue;
        const regla = `SCCA_AMB_${s.id}_${r.variable}_${r.periodo_h}h`;
        reglasVigentes.add(s.nodo_id + '/' + regla);
        if (!intervalo || 3600 % intervalo) continue;
        const inicio = new Date(+fin - r.periodo_h * 3600000),
          cobertura = Number(p.completitud_min_pct) / 100;
        const dato = (
          await c.query(
            `WITH slots AS (SELECT date_bin(make_interval(secs=>$1),l.medido_en,TIMESTAMPTZ '1970-01-01') AS slot,AVG(l.valor) AS valor FROM lectura_original l JOIN variable v ON v.id=l.variable_id WHERE l.sensor_id=$2 AND v.codigo=$3 AND l.calidad='valida' AND l.medido_en>=$4 AND l.medido_en<$5 GROUP BY slot), horas AS (SELECT date_trunc('hour',slot AT TIME ZONE 'UTC') AS hora,AVG(valor) AS valor FROM slots GROUP BY hora HAVING count(*)>=(3600.0/$1)*$6) SELECT AVG(valor)::float AS valor,count(*)::int AS horas FROM horas`,
            [intervalo, s.id, r.variable, inicio, fin, cobertura],
          )
        ).rows[0];
        await actualizar(
          s,
          regla,
          dato.horas >= Math.ceil(r.periodo_h * cobertura) ? dato.valor : null,
          r.umbral,
          inicio,
          {
            tipo: 'promedio de horas completas',
            variable: r.variable,
            perfil,
            periodo_h: r.periodo_h,
            horas_validas: dato.horas,
          },
        );
      }
      if (perfil === 'contaminantes_simulados')
        for (const r of p.configuracion.alertas_predictivas || []) {
          const regla = `SCCA_PRED_${s.id}_PM25_${r.horizonte_h}h`;
          reglasVigentes.add(s.nodo_id + '/' + regla);
          const d = (
            await c.query(
              `SELECT r.id::text,r.resultado,v.version FROM ml_demo_resultado r JOIN ml_demo_version v ON v.version=r.version WHERE v.sensor_id=$1 AND v.proposito='pronostico' AND v.horizonte_h=$2 AND r.resultado->>'estado'='evaluado_demo' AND r.periodo_inicio>=$3 AND (r.resultado->>'objetivo_fin')::timestamptz>now() AND v.version=ANY($4::text[]) ORDER BY r.periodo_inicio DESC,r.id DESC LIMIT 1`,
              [s.id, r.horizonte_h, new Date(+fin - 3600000), activos],
            )
          ).rows[0];
          if (d)
            await actualizar(
              s,
              regla,
              d.resultado.valor,
              r.umbral,
              new Date(d.resultado.objetivo_inicio),
              {
                tipo: 'pronóstico de demostración',
                variable: 'PM25',
                horizonte_h: r.horizonte_h,
                objetivo_fin: d.resultado.objetivo_fin,
                modelo_version: d.version,
                resultado_id: d.id,
                validacion_independiente: false,
              },
            );
          else {
            const vencidas = (
              await c.query(
                "UPDATE alerta SET estado='resuelta',periodo_fin=now(),observacion='Pronóstico expirado; no implica recuperación ambiental' WHERE nodo_id=$1 AND regla=$2 AND estado IN ('abierta','atendida') AND (evidencia->>'objetivo_fin')::timestamptz<=now() RETURNING id",
                [s.nodo_id, regla],
              )
            ).rows;
            for (const a of vencidas) {
              await auditar(a.id, 'resolver', { motivo: 'pronostico_expirado' });
              resueltas++;
            }
          }
        }
    }
    const antiguas = (
      await c.query(
        "SELECT id,nodo_id,regla FROM alerta WHERE estado IN ('abierta','atendida') AND (regla LIKE 'SCCA_AMB_%' OR regla LIKE 'SCCA_PRED_%') FOR UPDATE",
      )
    ).rows;
    for (const a of antiguas)
      if (!reglasVigentes.has(a.nodo_id + '/' + a.regla)) {
        await c.query(
          "UPDATE alerta SET estado='resuelta',periodo_fin=$2,observacion='Regla o sensor fuera de supervisión; no implica recuperación ambiental' WHERE id=$1",
          [a.id, fin],
        );
        await auditar(a.id, 'resolver', {
          motivo: 'fuera_de_supervision',
          politica_version: p.version,
        });
        resueltas++;
      }
    await c.query('COMMIT');
    return { creadas, resueltas, politica_version: p.version };
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
function iniciarAmbientales(pool) {
  if (process.env.ALERTAS_AMBIENTALES_AUTO !== 'true') return;
  let ocupado = false;
  const revisar = async () => {
    if (ocupado) return;
    ocupado = true;
    try {
      await comprobarAmbientales(pool);
    } catch {
      console.error('No se pudieron evaluar umbrales ambientales.');
    } finally {
      ocupado = false;
    }
  };
  const t = setInterval(revisar, 300000);
  t.unref();
  return t;
}
module.exports = { comprobarAmbientales, iniciarAmbientales };
