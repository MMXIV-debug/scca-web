document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-panel-ml]').forEach(inicializarPanelMl);
});

async function inicializarPanelMl(root) {
  const $ = (id) => document.getElementById(root.id + '-' + id),
    token = localStorage.getItem('token');
  const tab = root.dataset.panelMl;
  let cursor = '0',
    next = '0',
    sensores = [],
    pagina = [];
  const configuracion = {
    politicas: {
      titulo: 'Políticas',
      descripcion:
        'Cada cambio crea una versión inmutable y conserva el motivo, la referencia, los rangos y el administrador. Los modelos conservan la política con la que fueron evaluados.',
      columnas: [
        'version',
        'referencia_nombre',
        'completitud_min_pct',
        'colocacion_dias',
        'pares_minimos',
        'test_pct',
        'mejora_rmse_min_pct',
        'sin_datos_seg',
        'vigente_desde',
        'vigente_hasta',
        'rangos_variables',
        'configuracion',
      ],
    },
    modelos: {
      titulo: 'Machine Learning',
      descripcion:
        'Estos son los modelos que se están usando. Los intentos anteriores se conservan en el historial. Son de demostración y no acreditan calibración física ni precisión validada de fallos.',
      columnas: [
        'sensor',
        'proposito',
        'variable',
        'horizonte_h',
        'estado',
        'razones',
        'algoritmo',
        'detalles',
      ],
    },
    reportes: {
      titulo: 'Reportes ML',
      descripcion:
        'Resultados horarios por sensor y periodo. El CSV incluye todo el rango solicitado, hasta 10000 resultados. Los valores originales se conservan.',
      columnas: [
        'id',
        'sensor_id',
        'perfil',
        'version',
        'proposito',
        'horizonte_h',
        'periodo_inicio',
        'periodo_fin',
        'resultado',
      ],
    },
  };
  const cfg = configuracion[tab];
  if (!cfg) {
    $('mensaje').textContent = 'Sección inválida.';
    return;
  }
  async function api(ruta, body) {
    const r = await fetch(ruta, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error || 'No se pudo completar la operación.');
    return d;
  }
  const local = (d) => new Date(+d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const texto = (v) => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  function campo(form, label, tipo = 'number', valor = '') {
    const wrapper = document.createElement('label');
    wrapper.className = 'd-block mb-2';
    wrapper.append(document.createTextNode(label + ' '));
    const input = document.createElement(
      tipo === 'select' ? 'select' : tipo === 'textarea' ? 'textarea' : 'input',
    );
    if (!['select', 'textarea'].includes(tipo)) input.type = tipo;
    input.className = tipo==='checkbox'?'form-check-input':tipo==='select'?'form-select':'form-control';
    input.value = valor;
    wrapper.append(input);
    form.append(wrapper);
    return input;
  }
  function opciones(input, values) {
    input.replaceChildren();
    for (const [v, label] of values) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label;
      input.append(o);
    }
  }
  function boton(parent, label, fn) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-outline-primary me-2 my-2';
    b.textContent = label;
    b.onclick = async () => {
      b.disabled = true;
      $('mensaje').textContent = '';
      try {
        await fn();
      } catch (e) {
        $('mensaje').textContent = e.message;
      } finally {
        b.disabled = false;
      }
    };
    parent.append(b);
    return b;
  }
  const acciones = document.createElement('div');
  acciones.className = 'mb-3';
  $('descripcion').after(acciones);
  function dibujar(items, filas = $('filas')) {
    filas.replaceChildren();
    const razones = {
      pares_o_periodo_insuficientes: 'Historial o pares insuficientes',
      arranque_sin_validacion_etiquetada: 'Detector de arranque: lectura inusual, sin validación con etiquetas',
      respaldo_persistencia_sin_mejora_demostrada: 'Respaldo: conserva el último valor; sin mejora demostrada',
      muestras_insuficientes_arranque: 'Faltan muestras completas para el arranque',
      sin_datos_nuevos: 'No hay datos nuevos para entrenar; se conserva el modelo activo',
      sin_referencia: 'Falta una referencia compatible',
      sin_pares_de_referencia_validos: 'No hay pares de referencia válidos',
      sin_etiquetas_y_politica_especifica_para_anomalias:
        'Faltan etiquetas y criterios de anomalías',
      prueba_final_consumida_se_requiere_periodo_posterior:
        'Este periodo ya se evaluó. Espera datos posteriores para volver a entrenar',
    };
    for (const item of items) {
      const tr = document.createElement('tr');
      for (const col of cfg.columnas) {
        const td = document.createElement('td');
        if (col === 'detalles') {
          const details = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre');
          summary.textContent = 'Ver detalles';
          pre.textContent = JSON.stringify({ version: item.version, perfil: item.perfil,
            modo_evaluacion: item.modo_evaluacion, tipo_pronostico: item.tipo_pronostico,
            muestras_o_pares: item.pares, metricas: item.metricas, creado_en: item.creado_en }, null, 2);
          details.append(summary, pre);
          td.append(details);
        } else if (tab === 'modelos' && col === 'estado')
          td.textContent = item.activo ? 'En uso' : ({ pendiente: 'Pendiente', apto_demo: 'Apto para demostración', rechazado: 'No aprobado', error: 'Error' }[item.estado] || texto(item.estado));
        else if (tab === 'modelos' && col === 'algoritmo')
          td.textContent = ({ isolation_forest: 'Isolation Forest', random_forest: 'Random Forest', persistencia: 'Último valor (respaldo)', linear_regression: 'Regresión lineal' }[item.algoritmo] || item.algoritmo || 'Sin entrenar');
        else if (tab === 'modelos' && col === 'proposito')
          td.textContent = ({ anomalias: 'Anomalías', calibracion: 'Calibración', pronostico: 'Pronóstico' }[item.proposito] || texto(item.proposito));
        else if (tab === 'modelos' && col === 'horizonte_h')
          td.textContent = item.horizonte_h ? `${item.horizonte_h} h` : '—';
        else if (col === 'razones' && Array.isArray(item[col]))
          td.textContent = item[col].length ? item[col].map((r) => razones[r] || r.replaceAll('_', ' ')).join('; ') : 'Sin observaciones';
        else if (col === 'sensor' && item[col])
          td.textContent = `Nodo ${item[col].nodo_id}, sensor ${item[col].sensor_id}`;
        else if (item[col] && typeof item[col] === 'object') {
          const details = document.createElement('details'),
            summary = document.createElement('summary'),
            pre = document.createElement('pre');
          summary.textContent = 'Ver detalles';
          pre.textContent = JSON.stringify(item[col], null, 2);
          details.append(summary, pre);
          td.append(details);
        } else td.textContent = col === 'activo' ? (item[col] ? 'Sí' : 'No') : texto(item[col]);
        tr.append(td);
      }
      if (tab === 'modelos') {
        const td = document.createElement('td');
        if (item.activo)
          boton(td, 'Revertir', async () => {
            const motivo = prompt(
              'Motivo de reversión (mínimo 10 caracteres). Se restaurará el modelo anterior o quedará sin modelo activo.',
            );
            if (motivo == null) return;
            await api('/api/admin/ml/revertir', { clave: item.clave, motivo });
            await cargar();
          });
        tr.append(td);
      }
      filas.append(tr);
    }
    if (!items.length) {
      const tr = document.createElement('tr'), td = document.createElement('td');
      td.colSpan = cfg.columnas.length + (tab === 'modelos' ? 1 : 0);
      td.textContent = tab === 'modelos' ? (filas === $('filas') ? 'Todavía no hay modelos activos.' : 'No hay intentos anteriores.') : 'Sin registros.';
      tr.append(td);
      filas.append(tr);
    }
  }
  let desde, hasta;
  function urlReportes(csv = false) {
    if (!$('sensor').checkValidity()) throw Error('Indica un sensor válido.');
    return (
      '/api/admin/ml/reportes' +
      (csv ? '.csv' : '') +
      '?' +
      new URLSearchParams({
        sensorId: $('sensor').value,
        despuesDe: cursor,
        desde: new Date(desde.value).toISOString(),
        hasta: new Date(hasta.value).toISOString(),
      })
    );
  }
  async function cargar() {
    try {
      const d = await api(tab === 'reportes' ? urlReportes() : '/api/admin/ml/' + tab);
      pagina = d.items;
      next = d.siguiente_despues_de || '0';
      if (tab === 'modelos') {
        const activos = d.activos || pagina.filter((m) => m.activo);
        dibujar(activos);
        const historial = pagina.filter((m) => !m.activo);
        dibujar(historial, $('historial-filas'));
        $('historial-resumen').textContent = `Historial de evaluaciones (${historial.length})`;
        mostrarDatosSensores(d.datos_sensores || []);
      } else dibujar(pagina);
      $('siguiente').hidden = tab !== 'reportes' || pagina.length < 100;
      $('exportar').disabled = tab !== 'reportes' || !pagina.length;
      $('mensaje').textContent = pagina.length
        ? `${pagina.length} registros mostrados.`
        : 'Sin registros en este periodo.';
      if (tab === 'modelos') $('mensaje').textContent = `${(d.activos || pagina.filter((m) => m.activo)).length} modelos en uso. Un intento pendiente no reemplaza al modelo activo.`;
      if (tab === 'politicas') editarPolitica(pagina.find((p) => !p.vigente_hasta), d.referencias || [], d.variables || []);
      if (tab === 'modelos') {
        const anteriores = $('ciclos');
        anteriores.textContent = d.ciclos?.length
          ? JSON.stringify(d.ciclos[0], null, 2)
          : 'Todavía no se ejecutó un ciclo. Evalúa candidatos para conocer si hay datos suficientes.';
      }
    } catch (e) {
      pagina = [];
      dibujar([]);
      if (tab === 'modelos') {
        dibujar([], $('historial-filas'));
        $('historial-resumen').textContent = 'Historial de evaluaciones';
        $('datos-sensores').replaceChildren();
      }
      $('exportar').disabled = true;
      $('mensaje').textContent = e.message;
    }
  }
  function mostrarDatosSensores(items) {
    const box = $('datos-sensores');
    box.replaceChildren();
    for (const s of items) {
      const p = document.createElement('p');
      const ultima = s.ultima_lectura ? new Date(s.ultima_lectura).toLocaleString('es-BO', { timeZone: 'America/La_Paz' }) : 'sin lecturas';
      const modelo = s.modelo || 'DHT11';
      p.textContent = `${modelo} · sensor ${s.id}: última lectura válida: ${ultima}. Muestras completas en las últimas 48 horas cerradas: ${s.muestras_completas_48h}. `;
      if (!s.muestras_completas_48h) p.textContent += 'Revisa que el ESP32 esté encendido, conectado a la red y enviando temperatura y humedad a la API. Después, vuelve a evaluar candidatos.';
      else p.textContent += 'El entrenamiento comprobará si alcanzan las muestras exigidas por la política.';
      box.append(p);
    }
  }
  function editarPolitica(p, referencias = [], variablesCatalogo = []) {
    acciones.replaceChildren();
    if (!p) {
      acciones.textContent = 'Falta inicializar la política vigente.';
      return;
    }
    const details = document.createElement('details'),
      summary = document.createElement('summary');
    summary.textContent = 'Crear una nueva versión de política';
    details.append(summary);
    acciones.append(details);
    const form = document.createElement('form');
    form.className = 'border rounded p-3 mt-2';
    details.append(form);
    const refSelect = campo(form, 'Fuente de referencia para calibración', 'select');
    opciones(
      refSelect,
      referencias.length
        ? referencias.map((r) => [String(r.id), `#${r.id} · ${r.nombre}`])
        : [[String(p.referencia_fuente_id), `Referencia #${p.referencia_fuente_id}`]],
    );
    refSelect.value = String(p.referencia_fuente_id);
    const arranque = campo(form, 'Arranque de demostración con historial corto (anomalías sin etiquetas y pronóstico de respaldo explícito)', 'checkbox');
    arranque.checked = p.configuracion.arranque_demo === true;
    const fields = {};
    for (const [key, label, min, max] of [
      ['completitud_min_pct', 'Completitud mínima (%)', 75, 100],
      ['colocacion_dias', 'Duración mínima del conjunto (días)', 1, 365],
      ['pares_minimos', 'Pares mínimos', 24, 100000],
      ['test_pct', 'Prueba temporal final (%)', 10, 40],
      ['mejora_rmse_min_pct', 'Mejora mínima de RMSE (%)', 20, 100],
      ['sin_datos_seg', 'Espera mínima sin recepción (segundos)', 60, 604800],
    ]) {
      fields[key] = campo(form, label, 'number', p[key]);
      fields[key].min = min;
      fields[key].max = max;
      fields[key].required = true;
    }
    const factor = campo(
      form,
      'Margen de recepción (veces el intervalo del sensor)',
      'number',
      p.configuracion.factor_sin_datos || 2,
    );
    factor.min = 2;
    factor.max = 100;
    factor.step = 'any';
    const intervalos = {};
    for (const s of sensores) {
      const input = campo(
        form,
        `Intervalo del sensor ${s.id} · ${s.modelo} · ${s.origen} (segundos)`,
        'number',
        p.configuracion.intervalos_sensor?.[s.id] ||
          (s.origen === 'simulado' ? 900 : s.intervalo_muestreo_s),
      );
      input.min = 1;
      input.max = 3600;
      input.required = true;
      intervalos[s.id] = input;
    }
    const intro = document.createElement('p');
    intro.textContent =
      'Umbrales configurados para seguimiento. No representan una norma aprobada. Cada promedio exige cobertura suficiente de horas completas.';
    form.append(intro);
    const reglas = document.createElement('div');
    form.append(reglas);
    const entradas = [];
    function regla(
      r = { perfil: 'contaminantes_simulados', variable: 'PM25', periodo_h: 24, umbral: '' },
    ) {
      const box = document.createElement('fieldset');
      box.className = 'border p-2 mb-2';
      const perfil = campo(box, 'Perfil', 'select');
      opciones(perfil, [
        ['contaminantes_simulados', 'Contaminantes simulados'],
        ['dht11', 'DHT11'],
        ['bme680', 'BME680'],
      ]);
      perfil.value = r.perfil;
      const variable = campo(box, 'Variable', 'select');
      opciones(
        variable,
        ['PM25', 'PM10', 'PM1', 'CO', 'TEMP', 'HUM', 'PRES', 'GAS'].map((x) => [x, x]),
      );
      variable.value = r.variable;
      const periodo = campo(box, 'Promedio de horas completas', 'number', r.periodo_h);
      periodo.min = 1;
      periodo.max = 168;
      periodo.required = true;
      const umbral = campo(box, 'Umbral en la unidad de la variable', 'number', r.umbral);
      umbral.required = true;
      umbral.step = 'any';
      const entrada = { box, perfil, variable, periodo, umbral };
      entradas.push(entrada);
      boton(box, 'Quitar regla', () => {
        entradas.splice(entradas.indexOf(entrada), 1);
        box.remove();
      });
      reglas.append(box);
    }
    for (const r of p.configuracion.alertas_ambientales || []) regla(r);
    boton(form, 'Añadir umbral ambiental', () => regla());
    const predictivas = {};
    for (const h of [1, 3, 6]) {
      const v = p.configuracion.alertas_predictivas?.find((r) => r.horizonte_h === h)?.umbral ?? '';
      predictivas[h] = campo(
        form,
        `Umbral de PM2.5 pronosticado a ${h} h (µg/m³); vacío para desactivar`,
        'number',
        v,
      );
      predictivas[h].min = 0;
      predictivas[h].step = 'any';
    }
    const aInputs = {},
      aValores = {
        muestras_entrenamiento: 200,
        dias_minimos: 7,
        normales_prueba: 50,
        fallos_prueba: 20,
        precision_minima: 0.9,
        recall_minimo: 0.9,
        fpr_maxima: 0.05,
        ...p.configuracion.anomalias,
      };
    const aTitulo = document.createElement('p');
    aTitulo.textContent =
      'En arranque se ajusta un detector no supervisado sin exigir etiquetas ni días mínimos; las muestras mínimas siguen siendo obligatorias. Fuera del arranque se aplican los criterios de revisión humana indicados. No se certifica precisión operacional.';
    form.append(aTitulo);
    for (const [k, label, pct] of [
      ['muestras_entrenamiento', 'Muestras distintas para ajustar el detector'],
      ['dias_minimos', 'Días mínimos de historial del detector'],
      ['normales_prueba', 'Lecturas normales revisadas para prueba'],
      ['fallos_prueba', 'Fallos confirmados para prueba'],
      ['precision_minima', 'Precisión mínima de fallos (%)', true],
      ['recall_minimo', 'Detección mínima de fallos (%)', true],
      ['fpr_maxima', 'Falsos positivos máximos (%)', true],
    ]) {
      const input = campo(form, label, 'number', aValores[k] * (pct ? 100 : 1));
      input.required = true;
      input.step = 'any';
      aInputs[k] = { input, pct };
    }
    const rangosTitulo = document.createElement('p');
    rangosTitulo.className = 'fw-semibold mt-3 mb-1';
    rangosTitulo.textContent = 'Rangos válidos por variable (las lecturas fuera de rango se retienen en cuarentena)';
    form.append(rangosTitulo);
    const rangosPrevios = new Map((p.rangos_variables || []).map((r) => [r.codigo, r]));
    const rangosInputs = [];
    const listaVars = variablesCatalogo.length
      ? variablesCatalogo
      : (p.rangos_variables || []).map((r) => ({ id: r.variable_id, codigo: r.codigo, nombre: r.nombre, unidad: r.unidad }));
    for (const v of listaVars) {
      const actual = rangosPrevios.get(v.codigo);
      const fs = document.createElement('fieldset');
      fs.className = 'border rounded p-2 mb-2 d-flex flex-wrap gap-2 align-items-end';
      const leg = document.createElement('legend');
      leg.className = 'float-none w-auto px-1 small fw-bold mb-0';
      leg.textContent = `${v.codigo} (${v.unidad})`;
      fs.append(leg);
      const minIn = campo(fs, 'Mínimo', 'number', actual ? actual.rango_min : '');
      minIn.step = 'any';
      const maxIn = campo(fs, 'Máximo', 'number', actual ? actual.rango_max : '');
      maxIn.step = 'any';
      const umbIn = campo(fs, 'Umbral alerta (opcional)', 'number', actual?.umbral_alerta ?? '');
      umbIn.step = 'any';
      form.append(fs);
      rangosInputs.push({ variable_id: v.id, codigo: v.codigo, minIn, maxIn, umbIn });
    }
    const motivo = campo(form, 'Motivo del cambio', 'textarea');
    motivo.minLength = 10;
    motivo.maxLength = 1000;
    motivo.required = true;
    const guardar = document.createElement('button');
    guardar.className = 'btn btn-primary';
    guardar.textContent = 'Guardar nueva versión';
    form.append(guardar);
    form.onsubmit = async (e) => {
      e.preventDefault();
      guardar.disabled = true;
      try {
        const rangosPayload = rangosInputs
          .filter((r) => r.minIn.value !== '' && r.maxIn.value !== '')
          .map((r) => ({
            variable_id: r.variable_id,
            codigo: r.codigo,
            rango_min: Number(r.minIn.value),
            rango_max: Number(r.maxIn.value),
            umbral_alerta: r.umbIn.value !== '' ? Number(r.umbIn.value) : null,
          }));
        await api('/api/admin/ml/politicas', {
          version_anterior: p.version,
          referencia_fuente_id: Number(refSelect.value),
          rangos_variables: rangosPayload,
          motivo: motivo.value,
          ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, Number(v.value)])),
          configuracion: {
            arranque_demo: arranque.checked,
            factor_sin_datos: Number(factor.value),
            intervalos_sensor: Object.fromEntries(
              Object.entries(intervalos).map(([k, v]) => [k, Number(v.value)]),
            ),
            alertas_ambientales: entradas.map((r) => ({
              perfil: r.perfil.value,
              variable: r.variable.value,
              periodo_h: Number(r.periodo.value),
              umbral: Number(r.umbral.value),
            })),
            alertas_predictivas: Object.entries(predictivas)
              .filter(([, v]) => v.value !== '')
              .map(([h, v]) => ({ horizonte_h: Number(h), umbral: Number(v.value) })),
            anomalias: Object.fromEntries(
              Object.entries(aInputs).map(([k, v]) => [
                k,
                Number(v.input.value) / (v.pct ? 100 : 1),
              ]),
            ),
          },
        });
        await cargar();
      } catch (err) {
        $('mensaje').textContent = err.message;
      } finally {
        guardar.disabled = false;
      }
    };
  }
  function controlesModelos() {
    boton(acciones, 'Evaluar candidatos', async () => {
      await api('/api/admin/ml/entrenar', {});
      $('mensaje').textContent =
        'Evaluación iniciada. Los modelos activos se conservan si el candidato no es apto.';
      const t = setInterval(async () => {
        try {
          const o = await api('/api/admin/ml/operacion');
          if (o.entrenamiento?.estado !== 'ejecutando') {
            clearInterval(t);
            await cargar();
            $('mensaje').textContent =
              'Ciclo ' +
              (o.entrenamiento?.estado || 'finalizado') +
              '. Consulta los motivos de los candidatos.';
          }
        } catch (e) {
          clearInterval(t);
          $('mensaje').textContent = e.message;
        }
      }, 3000);
    });
    boton(acciones, 'Calcular última hora', async () => {
      const r = await api('/api/admin/ml/procesar', {});
      salida.textContent = JSON.stringify(r, null, 2);
    });
    boton(acciones, 'Comprobar umbrales', async () => {
      salida.textContent = JSON.stringify(
        await api('/api/admin/ml/comprobar-alertas', {}),
        null,
        2,
      );
    });
    const form = document.createElement('form');
    form.className = 'border rounded p-3';
    acciones.append(form);
    const sensor = campo(form, 'Sensor', 'select');
    opciones(
      sensor,
      sensores.filter((s) => s.activo).map((s) => [s.id, `${s.id} · ${s.modelo} · ${s.origen}`]),
    );
    const proposito = campo(form, 'Propósito', 'select');
    opciones(proposito, [
      ['calibracion', 'Calibración de demostración'],
      ['pronostico', 'Pronóstico PM2.5'],
      ['anomalias', 'Estado de anomalías por perfil'],
    ]);
    const variable = campo(form, 'Variable', 'select'),
      horizonte = campo(form, 'Horizonte', 'select');
    const fecha = campo(
      form,
      'Inicio de la hora a evaluar (hora local)',
      'datetime-local',
      local(new Date(Math.floor(Date.now() / 3600000) * 3600000 - 3600000)),
    );
    fecha.required = true;
    const guardar = campo(form, 'Guardar el resultado de demostración', 'checkbox');
    guardar.checked = true;
    function actualizar() {
      const s = sensores.find((x) => String(x.id) === sensor.value);
      opciones(
        variable,
        (proposito.value === 'pronostico'
          ? s?.variables.includes('PM25')
            ? ['PM25']
            : []
          : proposito.value === 'anomalias'
            ? s?.variables.includes('PM25')
              ? ['PM25']
              : s?.variables.includes('TEMP')
                ? ['TEMP']
                : []
            : s?.variables || []
        ).map((x) => [x, proposito.value === 'anomalias' ? 'Perfil completo' : x]),
      );
      opciones(
        horizonte,
        (proposito.value === 'pronostico' ? [1, 3, 6] : [0]).map((x) => [
          x,
          x ? x + ' horas' : 'Sin horizonte',
        ]),
      );
    }
    sensor.onchange = proposito.onchange = actualizar;
    actualizar();
    const evaluar = document.createElement('button');
    evaluar.className = 'btn btn-primary';
    evaluar.textContent = 'Evaluar hora';
    form.append(evaluar);
    form.onsubmit = async (e) => {
      e.preventDefault();
      evaluar.disabled = true;
      try {
        if (!variable.value) throw Error('El sensor no admite ese propósito.');
        const r = await api('/api/admin/ml/evaluar', {
          sensorId: Number(sensor.value),
          proposito: proposito.value,
          variable: variable.value,
          horizonteH: Number(horizonte.value),
          horaInicio: new Date(fecha.value).toISOString(),
          guardarResultado: guardar.checked,
        });
        salida.textContent = JSON.stringify(r, null, 2);
        $('mensaje').textContent = 'Evaluación completada: ' + r.estado.replaceAll('_', ' ') + '.';
      } catch (err) {
        $('mensaje').textContent = err.message;
      } finally {
        evaluar.disabled = false;
      }
    };
    const salida = document.createElement('pre');
    salida.setAttribute('aria-live', 'polite');
    salida.className = 'mt-3';
    acciones.append(salida);
    const details = document.createElement('details'),
      sum = document.createElement('summary'),
      ciclos = document.createElement('pre');
    sum.textContent = 'Último ciclo de entrenamiento';
    ciclos.id = root.id + '-ciclos';
    details.append(sum, ciclos);
    acciones.append(details);
  }
  $('titulo').textContent = cfg.titulo;
  $('descripcion').textContent = cfg.descripcion;
  const tr = document.createElement('tr');
  for (const c of [...cfg.columnas, ...(tab === 'modelos' ? ['acciones'] : [])]) {
    const th = document.createElement('th');
    th.textContent = ({ horizonte_h: 'Plazo', razones: 'Motivo / observación', proposito: 'Propósito' }[c] || c.replaceAll('_', ' '));
    tr.append(th);
  }
  $('cabecera').append(tr);
  if (tab === 'modelos') $('historial-cabecera').append(tr.cloneNode(true));
  $('filtro').hidden = tab !== 'reportes';
  $('exportar').textContent = 'Descargar CSV del periodo';
  $('actualizar').onclick = () => {
    cursor = '0';
    cargar();
  };
  $('filtro').onsubmit = (e) => {
    e.preventDefault();
    cursor = '0';
    cargar();
  };
  $('siguiente').onclick = () => {
    cursor = next;
    cargar();
  };
  $('exportar').onclick = async () => {
    try {
      const r = await fetch(urlReportes(true), { headers: { Authorization: 'Bearer ' + token } });
      if (!r.ok) throw Error((await r.json()).error);
      const url = URL.createObjectURL(await r.blob()),
        a = document.createElement('a');
      a.href = url;
      a.download = 'reporte-ml.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      $('mensaje').textContent = e.message;
    }
  };
  try {
    const me = await api('/api/me');
    if (me.rol !== 'Administrador') throw Error('Se requiere sesión de Administrador.');
    sensores = (await api('/api/admin/ml/sensores')).items;
    $('contenido').hidden = false;
    if (tab === 'modelos') controlesModelos();
    if (tab === 'reportes') {
      desde = campo(
        $('filtro'),
        'Desde (hora local)',
        'datetime-local',
        local(new Date(Date.now() - 7 * 86400000)),
      );
      hasta = campo($('filtro'), 'Hasta (hora local)', 'datetime-local', local(new Date()));
      desde.required = hasta.required = true;
      $('mensaje').textContent = 'Indica el sensor y el periodo.';
    } else await cargar();
  } catch (e) {
    $('mensaje').textContent = e.message;
  }
}
