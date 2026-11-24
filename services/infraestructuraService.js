const express = require('express');

const fallo = (status, message) => Object.assign(new Error(message), { status });

const PERFILES_UNIDADES = {
  dht11: { TEMP: '°C', HUM: '%' },
  bme680: { TEMP: '°C', HUM: '%', PRES: 'hPa', GAS: 'ohm' },
  contaminantes_simulados: { CO: 'µg/m3', PM1: 'µg/m3', PM10: 'µg/m3', PM25: 'µg/m3' },
};

const ESTADOS_NODO = ['activo', 'inactivo', 'mantenimiento', 'sin_datos'];
const TIPOS_MANTENIMIENTO = ['instalacion', 'limpieza', 'calibracion', 'reemplazo', 'reparacion'];

function normUnidad(s) {
  return String(s ?? '')
    .replace(/μ/g, 'µ')
    .replace(/³/g, '3')
    .replace(/Ω/g, 'ohm')
    .trim();
}

function identificarPerfil(modelo, origen) {
  if (origen === 'simulado') return 'contaminantes_simulados';
  const m = String(modelo || '').trim().toUpperCase();
  if (m === 'DHT11') return 'dht11';
  if (m === 'BME680') return 'bme680';
  return null;
}

async function verificarAdmin(client, usuarioId) {
  const r = await client.query(
    `SELECT u.id FROM usuario u JOIN rol r ON r.id = u.rol_id
     WHERE u.id = $1 AND u.activo AND u.estado = 'aprobado' AND r.nombre = 'Administrador'
     FOR SHARE OF u`,
    [usuarioId],
  );
  if (!r.rowCount) throw fallo(403, 'Se requiere un administrador activo.');
}

async function resolverVariablesSensor(client, perfil, variablesEntrada) {
  const esperadas = PERFILES_UNIDADES[perfil];
  if (!esperadas) throw fallo(422, 'Modelo de sensor sin perfil compatible (usa DHT11, BME680 o simulado).');

  const { rows: catalogo } = await client.query(
    `SELECT v.id, v.codigo, v.nombre, v.unidad_id, u.simbolo
     FROM variable v JOIN unidad u ON u.id = v.unidad_id`,
  );
  const porCodigo = new Map(catalogo.map((v) => [v.codigo, v]));
  const porId = new Map(catalogo.map((v) => [v.id, v]));

  const lista = Array.isArray(variablesEntrada) && variablesEntrada.length
    ? variablesEntrada
    : Object.keys(esperadas).map((codigo) => ({ codigo }));

  const codigosVistos = new Set();
  const resueltas = [];

  for (const item of lista) {
    const entrada = typeof item === 'string'
      ? { codigo: item }
      : typeof item === 'number'
        ? { variable_id: item }
        : item;
    if (!entrada || typeof entrada !== 'object') {
      throw fallo(400, 'Formato de variable inválido.');
    }
    const v = entrada.variable_id != null
      ? porId.get(Number(entrada.variable_id))
      : porCodigo.get(String(entrada.codigo || '').trim().toUpperCase());
    if (!v) {
      throw fallo(422, `Variable inexistente en el catálogo: ${entrada.codigo || entrada.variable_id}.`);
    }
    if (!Object.hasOwn(esperadas, v.codigo)) {
      throw fallo(422, `La variable ${v.codigo} no corresponde al perfil ${perfil}.`);
    }
    if (codigosVistos.has(v.codigo)) {
      throw fallo(400, `Variable repetida en la configuración del sensor: ${v.codigo}.`);
    }
    if (entrada.unidad_id != null && Number(entrada.unidad_id) !== v.unidad_id) {
      throw fallo(422, `Unidad incompatible para ${v.codigo}: se esperaba unidad_id=${v.unidad_id} (${esperadas[v.codigo]}).`);
    }
    if (entrada.unidad_simbolo != null && normUnidad(entrada.unidad_simbolo) !== esperadas[v.codigo]) {
      throw fallo(422, `Unidad incompatible para ${v.codigo}: se esperaba ${esperadas[v.codigo]}.`);
    }
    if (normUnidad(v.simbolo) !== esperadas[v.codigo]) {
      throw fallo(422, `El catálogo define una unidad incompatible para ${v.codigo} (${v.simbolo} en lugar de ${esperadas[v.codigo]}).`);
    }
    codigosVistos.add(v.codigo);
    resueltas.push(v);
  }

  if (codigosVistos.size !== Object.keys(esperadas).length) {
    throw fallo(
      422,
      `El perfil ${perfil} requiere exactamente las variables: ${Object.keys(esperadas).join(', ')}.`,
    );
  }
  return resueltas;
}

function crearInfraestructuraService(pool) {
  async function resumen() {
    const [sitios, nodos, sensores, variables, mantenimientos, referencias] = await Promise.all([
      pool.query('SELECT id, codigo, nombre, latitud::float, longitud::float FROM sitio ORDER BY id'),
      pool.query(
        `SELECT n.id, n.codigo, n.sitio_id, si.nombre AS sitio_nombre, n.estado,
                n.intervalo_muestreo_s, n.instalado_en, n.ultima_recepcion
         FROM nodo n JOIN sitio si ON si.id = n.sitio_id ORDER BY n.id`,
      ),
      pool.query(
        `SELECT s.id, s.nodo_id, n.codigo AS nodo_codigo, s.codigo, s.modelo, s.numero_serie,
                s.origen, s.activo, s.alta_en, s.baja_en, s.reemplaza_a,
                COALESCE(json_agg(json_build_object('id', v.id, 'codigo', v.codigo, 'unidad_id', v.unidad_id, 'simbolo', u.simbolo) ORDER BY v.codigo)
                  FILTER (WHERE v.id IS NOT NULL), '[]'::json) AS variables,
                (SELECT count(*)::int FROM modelo_ml m WHERE m.sensor_id = s.id AND m.estado = 'activo') AS modelos_activos,
                (SELECT count(*)::int FROM modelo_ml m WHERE m.sensor_id = s.id AND m.estado = 'retirado') AS modelos_retirados,
                (SELECT count(*)::int FROM lectura_original l WHERE l.sensor_id = s.id) AS total_lecturas
         FROM sensor s
         JOIN nodo n ON n.id = s.nodo_id
         LEFT JOIN sensor_variable sv ON sv.sensor_id = s.id
         LEFT JOIN variable v ON v.id = sv.variable_id
         LEFT JOIN unidad u ON u.id = v.unidad_id
         GROUP BY s.id, n.codigo
         ORDER BY s.id`,
      ),
      pool.query(
        `SELECT v.id, v.codigo, v.nombre, v.unidad_id, u.simbolo
         FROM variable v JOIN unidad u ON u.id = v.unidad_id ORDER BY v.id`,
      ),
      pool.query(
        `SELECT m.id, m.nodo_id, n.codigo AS nodo_codigo, m.sensor_id, s.codigo AS sensor_codigo,
                m.tipo, m.descripcion, m.realizado_en, m.registrado_por, u.username AS registrado_por_usuario
         FROM mantenimiento m
         JOIN nodo n ON n.id = m.nodo_id
         LEFT JOIN sensor s ON s.id = m.sensor_id
         JOIN usuario u ON u.id = m.registrado_por
         ORDER BY m.realizado_en DESC, m.id DESC LIMIT 100`,
      ),
      pool.query(
        `SELECT r.id, r.nombre, r.sitio_id, si.nombre AS sitio_nombre, r.calibracion_ref,
                (SELECT count(*)::int FROM referencia_lectura rl WHERE rl.fuente_id = r.id) AS total_lecturas
         FROM referencia_fuente r LEFT JOIN sitio si ON si.id = r.sitio_id ORDER BY r.id`,
      ),
    ]);
    return {
      sitios: sitios.rows,
      nodos: nodos.rows,
      sensores: sensores.rows,
      variables: variables.rows,
      mantenimientos: mantenimientos.rows,
      referencias: referencias.rows,
    };
  }

  async function crearSitio(usuarioId, body) {
    const codigo = String(body?.codigo || '').trim();
    const nombre = String(body?.nombre || '').trim();
    const latitud = Number(body?.latitud);
    const longitud = Number(body?.longitud);
    if (!codigo || codigo.length > 20 || !nombre || nombre.length > 100) {
      throw fallo(400, 'Código (máx. 20) y nombre (máx. 100) son obligatorios.');
    }
    if (!Number.isFinite(latitud) || latitud < -90 || latitud > 90 || !Number.isFinite(longitud) || longitud < -180 || longitud > 180) {
      throw fallo(400, 'Coordenadas geográficas fuera de rango.');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await verificarAdmin(client, usuarioId);
      const { rows } = await client.query(
        `INSERT INTO sitio(codigo, nombre, latitud, longitud)
         VALUES($1, $2, $3, $4) RETURNING id, codigo, nombre, latitud::float, longitud::float`,
        [codigo, nombre, latitud, longitud],
      );
      await client.query(
        `INSERT INTO auditoria_evento(usuario_id, entidad, entidad_id, accion, motivo, datos_despues)
         VALUES($1, 'sitio', $2, 'crear', 'Alta de sitio por administrador', $3)`,
        [usuarioId, rows[0].id, JSON.stringify(rows[0])],
      );
      await client.query('COMMIT');
      return rows[0];
    } catch (e) {
      await client.query('ROLLBACK');
      if (e.code === '23505') throw fallo(409, 'Ya existe un sitio con ese código.');
      throw e;
    } finally {
      client.release();
    }
  }

  async function crearNodo(usuarioId, body) {
    const codigo = String(body?.codigo || '').trim();
    const sitioId = Number(body?.sitio_id);
    const intervalo = body?.intervalo_muestreo_s != null ? Number(body.intervalo_muestreo_s) : 60;
    const estado = body?.estado || 'activo';
    const instaladoEn = body?.instalado_en || null;
    if (!codigo || codigo.length > 20 || !Number.isSafeInteger(sitioId) || sitioId <= 0) {
      throw fallo(400, 'Código (máx. 20) y sitio_id válido son obligatorios.');
    }
    if (!Number.isInteger(intervalo) || intervalo < 1 || intervalo > 3600 || 3600 % intervalo !== 0) {
      throw fallo(400, 'intervalo_muestreo_s debe ser un entero positivo divisor de 3600 (ej. 60 o 900).');
    }
    if (!ESTADOS_NODO.includes(estado)) {
      throw fallo(400, 'Estado de nodo inválido.');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await verificarAdmin(client, usuarioId);
      const sitio = await client.query('SELECT id FROM sitio WHERE id = $1', [sitioId]);
      if (!sitio.rowCount) throw fallo(400, 'El sitio indicado no existe.');
      const { rows } = await client.query(
        `INSERT INTO nodo(codigo, sitio_id, estado, intervalo_muestreo_s, instalado_en)
         VALUES($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE)) RETURNING *`,
        [codigo, sitioId, estado, intervalo, instaladoEn],
      );
      await client.query(
        `INSERT INTO auditoria_evento(usuario_id, entidad, entidad_id, accion, motivo, datos_despues)
         VALUES($1, 'nodo', $2, 'crear', 'Alta de nodo por administrador', $3)`,
        [usuarioId, rows[0].id, JSON.stringify(rows[0])],
      );
      await client.query('COMMIT');
      return rows[0];
    } catch (e) {
      await client.query('ROLLBACK');
      if (e.code === '23505') throw fallo(409, 'Ya existe un nodo con ese código.');
      throw e;
    } finally {
      client.release();
    }
  }

  async function actualizarNodo(usuarioId, nodoId, body) {
    if (!Number.isSafeInteger(nodoId) || nodoId <= 0) throw fallo(400, 'ID de nodo inválido.');
    const motivo = String(body?.motivo || '').trim();
    if (motivo.length < 5 || motivo.length > 1000) throw fallo(400, 'Indica un motivo de 5 a 1000 caracteres.');
    const nuevoEstado = body?.estado != null ? String(body.estado) : null;
    const nuevoIntervalo = body?.intervalo_muestreo_s != null ? Number(body.intervalo_muestreo_s) : null;
    if (nuevoEstado !== null && !ESTADOS_NODO.includes(nuevoEstado)) {
      throw fallo(400, 'Estado de nodo inválido.');
    }
    if (nuevoIntervalo !== null && (!Number.isInteger(nuevoIntervalo) || nuevoIntervalo < 1 || nuevoIntervalo > 3600 || 3600 % nuevoIntervalo !== 0)) {
      throw fallo(400, 'intervalo_muestreo_s debe dividir 3600.');
    }
    if (nuevoEstado === null && nuevoIntervalo === null) {
      throw fallo(400, 'Indica al menos estado o intervalo_muestreo_s a actualizar.');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await verificarAdmin(client, usuarioId);
      const prev = await client.query('SELECT * FROM nodo WHERE id = $1 FOR UPDATE', [nodoId]);
      if (!prev.rowCount) throw fallo(404, 'Nodo no encontrado.');
      const antes = prev.rows[0];
      const { rows } = await client.query(
        `UPDATE nodo
         SET estado = COALESCE($2, estado),
             intervalo_muestreo_s = COALESCE($3, intervalo_muestreo_s)
         WHERE id = $1 RETURNING *`,
        [nodoId, nuevoEstado, nuevoIntervalo],
      );
      await client.query(
        `INSERT INTO auditoria_evento(usuario_id, entidad, entidad_id, accion, motivo, datos_antes, datos_despues)
         VALUES($1, 'nodo', $2, 'actualizar', $3, $4, $5)`,
        [usuarioId, nodoId, motivo, JSON.stringify(antes), JSON.stringify(rows[0])],
      );
      await client.query('COMMIT');
      return rows[0];
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async function crearSensor(usuarioId, body) {
    const nodoId = Number(body?.nodo_id);
    const codigo = String(body?.codigo || '').trim();
    const modelo = String(body?.modelo || '').trim();
    const numeroSerie = String(body?.numero_serie || '').trim();
    const origen = String(body?.origen || 'real').trim();
    if (!Number.isSafeInteger(nodoId) || nodoId <= 0 || !codigo || codigo.length > 30 || !modelo || modelo.length > 30 || !numeroSerie || numeroSerie.length > 50) {
      throw fallo(400, 'nodo_id, codigo, modelo y numero_serie son obligatorios.');
    }
    if (!['real', 'simulado'].includes(origen)) {
      throw fallo(400, 'origen debe ser real o simulado.');
    }
    const perfil = identificarPerfil(modelo, origen);
    if (!perfil) {
      throw fallo(422, 'Modelo de sensor sin perfil compatible (usa DHT11, BME680 o origen simulado).');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await verificarAdmin(client, usuarioId);
      const nodo = await client.query('SELECT id FROM nodo WHERE id = $1 FOR SHARE', [nodoId]);
      if (!nodo.rowCount) throw fallo(400, 'El nodo indicado no existe.');

      const variables = await resolverVariablesSensor(client, perfil, body?.variables);
      const { rows } = await client.query(
        `INSERT INTO sensor(nodo_id, codigo, modelo, numero_serie, origen, activo)
         VALUES($1, $2, $3, $4, $5, true) RETURNING *`,
        [nodoId, codigo, modelo, numeroSerie, origen],
      );
      const nuevo = rows[0];
      for (const v of variables) {
        await client.query('INSERT INTO sensor_variable(sensor_id, variable_id) VALUES($1, $2)', [nuevo.id, v.id]);
      }
      await client.query(
        `INSERT INTO mantenimiento(nodo_id, sensor_id, tipo, descripcion, registrado_por)
         VALUES($1, $2, 'instalacion', $3, $4)`,
        [nodoId, nuevo.id, String(body?.descripcion || `Alta de sensor ${modelo} (${codigo})`).trim(), usuarioId],
      );
      await client.query(
        `INSERT INTO auditoria_evento(usuario_id, entidad, entidad_id, accion, motivo, datos_despues)
         VALUES($1, 'sensor', $2, 'crear', 'Alta de sensor por administrador', $3)`,
        [usuarioId, nuevo.id, JSON.stringify({ ...nuevo, perfil, variables: variables.map((v) => v.codigo) })],
      );
      await client.query('COMMIT');
      return { ...nuevo, perfil, variables };
    } catch (e) {
      await client.query('ROLLBACK');
      if (e.code === '23505') {
        throw fallo(409, 'Sensor duplicado: el código o el par (modelo, número de serie) ya existe.');
      }
      throw e;
    } finally {
      client.release();
    }
  }

  async function reemplazarSensor(usuarioId, sensorAnteriorId, body) {
    if (!Number.isSafeInteger(sensorAnteriorId) || sensorAnteriorId <= 0) {
      throw fallo(400, 'ID de sensor inválido.');
    }
    const codigo = String(body?.codigo || '').trim();
    const numeroSerie = String(body?.numero_serie || '').trim();
    const motivo = String(body?.motivo || body?.descripcion || '').trim();
    if (!codigo || codigo.length > 30 || !numeroSerie || numeroSerie.length > 50) {
      throw fallo(400, 'codigo y numero_serie del nuevo sensor son obligatorios.');
    }
    if (motivo.length < 10 || motivo.length > 1000) {
      throw fallo(400, 'Indica un motivo de reemplazo de 10 a 1000 caracteres.');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(192837, $1)', [sensorAnteriorId]);
      await verificarAdmin(client, usuarioId);

      const prevRes = await client.query('SELECT * FROM sensor WHERE id = $1 FOR UPDATE', [sensorAnteriorId]);
      if (!prevRes.rowCount) throw fallo(404, 'Sensor a reemplazar no encontrado.');
      const anterior = prevRes.rows[0];
      if (!anterior.activo) throw fallo(409, 'El sensor ya fue dado de baja o reemplazado.');

      const modelo = String(body?.modelo || anterior.modelo).trim();
      const origen = body?.origen ? String(body.origen).trim() : anterior.origen;
      if (!['real', 'simulado'].includes(origen)) throw fallo(400, 'origen inválido.');
      const perfil = identificarPerfil(modelo, origen);
      if (!perfil) throw fallo(422, 'El modelo de reemplazo no corresponde a un perfil soportado.');

      const variables = await resolverVariablesSensor(client, perfil, body?.variables);

      const modelosAntes = (
        await client.query(
          `SELECT id, variable_id, version, estado FROM modelo_ml
           WHERE sensor_id = $1 AND estado IN ('candidato','apto','activo') FOR UPDATE`,
          [sensorAnteriorId],
        )
      ).rows;

      // Desactivar el sensor anterior dispara el trigger tg_sensor_baja -> retira modelos en modelo_ml.
      const anteriorBaja = (
        await client.query(
          `UPDATE sensor SET activo = false, baja_en = COALESCE(baja_en, now())
           WHERE id = $1 RETURNING *`,
          [sensorAnteriorId],
        )
      ).rows[0];

      const modelosRetirados = modelosAntes.length
        ? (
            await client.query(
              'SELECT id, variable_id, version, estado FROM modelo_ml WHERE id = ANY($1::int[]) ORDER BY id',
              [modelosAntes.map((m) => m.id)],
            )
          ).rows
        : [];

      const nuevo = (
        await client.query(
          `INSERT INTO sensor(nodo_id, codigo, modelo, numero_serie, origen, activo, reemplaza_a)
           VALUES($1, $2, $3, $4, $5, true, $6) RETURNING *`,
          [anterior.nodo_id, codigo, modelo, numeroSerie, origen, sensorAnteriorId],
        )
      ).rows[0];

      for (const v of variables) {
        await client.query('INSERT INTO sensor_variable(sensor_id, variable_id) VALUES($1, $2)', [nuevo.id, v.id]);
      }

      const mant = (
        await client.query(
          `INSERT INTO mantenimiento(nodo_id, sensor_id, tipo, descripcion, registrado_por)
           VALUES($1, $2, 'reemplazo', $3, $4) RETURNING *`,
          [anterior.nodo_id, nuevo.id, `Reemplazo de sensor #${anterior.id} (${anterior.codigo}): ${motivo}`, usuarioId],
        )
      ).rows[0];

      await client.query(
        `INSERT INTO auditoria_evento(usuario_id, entidad, entidad_id, accion, motivo, datos_antes, datos_despues)
         VALUES($1, 'sensor', $2, 'reemplazar', $3, $4, $5)`,
        [
          usuarioId,
          sensorAnteriorId,
          motivo,
          JSON.stringify(anterior),
          JSON.stringify({
            sensor_anterior: anteriorBaja,
            sensor_nuevo: nuevo,
            modelos_retirados: modelosRetirados,
            mantenimiento_id: mant.id,
          }),
        ],
      );

      await client.query('COMMIT');
      return {
        sensor_anterior: anteriorBaja,
        sensor_nuevo: { ...nuevo, perfil, variables },
        modelos_retirados: modelosRetirados,
        mantenimiento: mant,
      };
    } catch (e) {
      await client.query('ROLLBACK');
      if (e.code === '23505') {
        throw fallo(409, 'Sensor duplicado: el código o el par (modelo, número de serie) ya existe.');
      }
      throw e;
    } finally {
      client.release();
    }
  }

  async function registrarMantenimiento(usuarioId, body) {
    const nodoId = Number(body?.nodo_id);
    const sensorId = body?.sensor_id != null && body.sensor_id !== '' ? Number(body.sensor_id) : null;
    const tipo = String(body?.tipo || '').trim();
    const descripcion = String(body?.descripcion || '').trim();
    const estadoNodo = body?.estado_nodo ? String(body.estado_nodo).trim() : null;
    if (!Number.isSafeInteger(nodoId) || nodoId <= 0 || !TIPOS_MANTENIMIENTO.includes(tipo)) {
      throw fallo(400, 'nodo_id válido y tipo de mantenimiento válido son obligatorios.');
    }
    if (descripcion.length < 5 || descripcion.length > 1000) {
      throw fallo(400, 'La descripción debe tener entre 5 y 1000 caracteres.');
    }
    if (sensorId !== null && (!Number.isSafeInteger(sensorId) || sensorId <= 0)) {
      throw fallo(400, 'sensor_id inválido.');
    }
    if (estadoNodo !== null && !ESTADOS_NODO.includes(estadoNodo)) {
      throw fallo(400, 'estado_nodo inválido.');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await verificarAdmin(client, usuarioId);
      const nodo = await client.query('SELECT * FROM nodo WHERE id = $1 FOR UPDATE', [nodoId]);
      if (!nodo.rowCount) throw fallo(404, 'Nodo no encontrado.');
      if (sensorId !== null) {
        const s = await client.query('SELECT id FROM sensor WHERE id = $1 AND nodo_id = $2', [sensorId, nodoId]);
        if (!s.rowCount) throw fallo(400, 'El sensor no existe o no pertenece al nodo indicado.');
      }
      const { rows } = await client.query(
        `INSERT INTO mantenimiento(nodo_id, sensor_id, tipo, descripcion, registrado_por)
         VALUES($1, $2, $3, $4, $5) RETURNING *`,
        [nodoId, sensorId, tipo, descripcion, usuarioId],
      );
      if (estadoNodo !== null && estadoNodo !== nodo.rows[0].estado) {
        await client.query('UPDATE nodo SET estado = $2 WHERE id = $1', [nodoId, estadoNodo]);
      }
      await client.query(
        `INSERT INTO auditoria_evento(usuario_id, entidad, entidad_id, accion, motivo, datos_despues)
         VALUES($1, 'mantenimiento', $2, 'registrar', $3, $4)`,
        [usuarioId, rows[0].id, descripcion, JSON.stringify({ ...rows[0], estado_nodo: estadoNodo })],
      );
      await client.query('COMMIT');
      return rows[0];
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async function crearReferencia(usuarioId, body) {
    const nombre = String(body?.nombre || '').trim();
    const sitioId = body?.sitio_id != null && body.sitio_id !== '' ? Number(body.sitio_id) : null;
    const calibracionRef = String(body?.calibracion_ref || '').trim() || null;
    if (!nombre || nombre.length > 100) throw fallo(400, 'El nombre de la fuente de referencia es obligatorio (máx. 100).');
    if (sitioId !== null && (!Number.isSafeInteger(sitioId) || sitioId <= 0)) throw fallo(400, 'sitio_id inválido.');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await verificarAdmin(client, usuarioId);
      if (sitioId !== null) {
        const si = await client.query('SELECT id FROM sitio WHERE id = $1', [sitioId]);
        if (!si.rowCount) throw fallo(400, 'El sitio indicado no existe.');
      }
      const { rows } = await client.query(
        `INSERT INTO referencia_fuente(nombre, sitio_id, calibracion_ref)
         VALUES($1, $2, $3) RETURNING *`,
        [nombre, sitioId, calibracionRef],
      );
      await client.query(
        `INSERT INTO auditoria_evento(usuario_id, entidad, entidad_id, accion, motivo, datos_despues)
         VALUES($1, 'referencia_fuente', $2, 'crear', 'Alta de fuente de referencia', $3)`,
        [usuarioId, rows[0].id, JSON.stringify(rows[0])],
      );
      await client.query('COMMIT');
      return rows[0];
    } catch (e) {
      await client.query('ROLLBACK');
      if (e.code === '23505') throw fallo(409, 'Ya existe una fuente de referencia con ese nombre.');
      throw e;
    } finally {
      client.release();
    }
  }

  async function registrarLecturasReferencia(usuarioId, fuenteId, body) {
    if (!Number.isSafeInteger(fuenteId) || fuenteId <= 0) throw fallo(400, 'ID de fuente inválido.');
    const lecturas = body?.lecturas;
    if (!Array.isArray(lecturas) || !lecturas.length || lecturas.length > 5000) {
      throw fallo(400, 'Envía entre 1 y 5000 lecturas de referencia.');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await verificarAdmin(client, usuarioId);
      const fuente = await client.query('SELECT id, nombre FROM referencia_fuente WHERE id = $1 FOR SHARE', [fuenteId]);
      if (!fuente.rowCount) throw fallo(404, 'Fuente de referencia no encontrada.');

      const { rows: catalogo } = await client.query(
        'SELECT v.id, v.codigo, v.unidad_id, u.simbolo FROM variable v JOIN unidad u ON u.id = v.unidad_id',
      );
      const porCodigo = new Map(catalogo.map((v) => [v.codigo, v]));

      let insertadas = 0;
      let duplicadas = 0;
      for (const item of lecturas) {
        const codigo = String(item?.variable_codigo || '').trim().toUpperCase();
        const v = porCodigo.get(codigo);
        if (!v) throw fallo(422, `Variable de referencia inexistente: ${codigo}.`);
        if (item.unidad_id != null && Number(item.unidad_id) !== v.unidad_id) {
          throw fallo(422, `Unidad incompatible para ${codigo}: se esperaba unidad_id=${v.unidad_id} (${v.simbolo}).`);
        }
        if (item.unidad_simbolo != null && normUnidad(item.unidad_simbolo) !== normUnidad(v.simbolo)) {
          throw fallo(422, `Unidad incompatible para ${codigo}: se esperaba ${v.simbolo}.`);
        }
        const valor = Number(item?.valor);
        if (!Number.isFinite(valor) || (codigo !== 'TEMP' && valor < 0) || (codigo === 'TEMP' && valor < -273.15)) {
          throw fallo(422, `Valor de referencia inválido para ${codigo}.`);
        }
        const fecha = String(item?.medido_en || '');
        if (!/(Z|[+-]\d\d:\d\d)$/.test(fecha) || !Number.isFinite(Date.parse(fecha))) {
          throw fallo(400, 'Cada lectura de referencia requiere medido_en ISO-8601 con zona horaria.');
        }
        const res = await client.query(
          `INSERT INTO referencia_lectura(fuente_id, variable_id, unidad_id, medido_en, valor)
           VALUES($1, $2, $3, $4, $5)
           ON CONFLICT (fuente_id, variable_id, medido_en) DO NOTHING`,
          [fuenteId, v.id, v.unidad_id, fecha, valor],
        );
        if (res.rowCount) insertadas++;
        else duplicadas++;
      }

      await client.query(
        `INSERT INTO auditoria_evento(usuario_id, entidad, entidad_id, accion, motivo, datos_despues)
         VALUES($1, 'referencia_fuente', $2, 'cargar_lecturas', 'Importación de lecturas calibradas de referencia', $3)`,
        [usuarioId, fuenteId, JSON.stringify({ insertadas, duplicadas, total_enviadas: lecturas.length })],
      );
      await client.query('COMMIT');
      return { fuente_id: fuenteId, insertadas, duplicadas };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  return {
    resumen,
    crearSitio,
    crearNodo,
    actualizarNodo,
    crearSensor,
    reemplazarSensor,
    registrarMantenimiento,
    crearReferencia,
    registrarLecturasReferencia,
  };
}

function crearRouterInfraestructura(pool, auth, soloAdmin) {
  const router = express.Router();
  const service = crearInfraestructuraService(pool);
  router.use(auth, soloAdmin);
  const responder = (fn, statusOk = 200) => async (req, res) => {
    try {
      res.status(statusOk).json(await fn(req));
    } catch (e) {
      res.status(e.status || 503).json({ error: e.status ? e.message : 'No se pudo completar la operación de infraestructura.' });
    }
  };

  router.get('/resumen', responder(() => service.resumen()));
  router.post('/sitios', responder((req) => service.crearSitio(req.user.id, req.body), 201));
  router.post('/nodos', responder((req) => service.crearNodo(req.user.id, req.body), 201));
  router.patch('/nodos/:id', responder((req) => service.actualizarNodo(req.user.id, Number(req.params.id), req.body)));
  router.post('/sensores', responder((req) => service.crearSensor(req.user.id, req.body), 201));
  router.post('/sensores/:id/reemplazar', responder((req) => service.reemplazarSensor(req.user.id, Number(req.params.id), req.body), 201));
  router.post('/mantenimientos', responder((req) => service.registrarMantenimiento(req.user.id, req.body), 201));
  router.post('/referencias', responder((req) => service.crearReferencia(req.user.id, req.body), 201));
  router.post('/referencias/:id/lecturas', responder((req) => service.registrarLecturasReferencia(req.user.id, Number(req.params.id), req.body), 201));

  return router;
}

module.exports = {
  crearInfraestructuraService,
  crearRouterInfraestructura,
  PERFILES_UNIDADES,
  identificarPerfil,
  normUnidad,
};
