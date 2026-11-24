document.addEventListener('DOMContentLoaded', () => {
  const contenedor = document.getElementById('infra-paneles');
  const mensajeEl = document.getElementById('infra-mensaje');
  const token = localStorage.getItem('token');
  if (!contenedor || !token) return;

  const setMsg = (txt, esError = false) => {
    if (!mensajeEl) return;
    mensajeEl.className = `small fw-semibold mb-2 ${esError ? 'text-danger' : 'text-success'}`;
    mensajeEl.textContent = txt;
  };

  async function api(ruta, metodo = 'GET', body = null) {
    const r = await fetch('/api/admin/infraestructura' + ruta, {
      method: metodo,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'No se pudo completar la operación.');
    return d;
  }

  function crearDetalles(titulo) {
    const d = document.createElement('details');
    d.className = 'border rounded p-2';
    const s = document.createElement('summary');
    s.className = 'fw-semibold small';
    s.textContent = titulo;
    d.append(s);
    return d;
  }

  function campo(form, etiqueta, tipo = 'text', valor = '') {
    const label = document.createElement('label');
    label.className = 'd-block small mb-2';
    label.append(document.createTextNode(etiqueta + ' '));
    const el = document.createElement(tipo === 'select' ? 'select' : tipo === 'textarea' ? 'textarea' : 'input');
    if (tipo !== 'select' && tipo !== 'textarea') el.type = tipo;
    el.className = tipo === 'select' ? 'form-select form-select-sm' : 'form-control form-control-sm';
    el.value = valor;
    label.append(el);
    form.append(label);
    return el;
  }

  function llenarSelect(select, opciones) {
    select.replaceChildren();
    for (const [val, txt] of opciones) {
      const o = document.createElement('option');
      o.value = val;
      o.textContent = txt;
      select.append(o);
    }
  }

  async function cargar() {
    try {
      const d = await api('/resumen');
      contenedor.replaceChildren();

      // 1. Sensores registrados (con historial y botón Reemplazar)
      const secSensores = crearDetalles(`Sensores y reemplazos (${d.sensores.length})`);
      const wrapS = document.createElement('div');
      wrapS.className = 'table-responsive mt-2';
      const tblS = document.createElement('table');
      tblS.className = 'table table-sm align-middle mb-2';
      tblS.innerHTML = '<thead><tr><th>ID / Código</th><th>Nodo</th><th>Modelo / Serie</th><th>Variables</th><th>Estado</th><th class="text-end">Acción</th></tr></thead>';
      const tbS = document.createElement('tbody');
      for (const s of d.sensores) {
        const tr = document.createElement('tr');
        const td1 = document.createElement('td');
        td1.textContent = `#${s.id} · ${s.codigo}` + (s.reemplaza_a ? ` (reemplaza #${s.reemplaza_a})` : '');
        const td2 = document.createElement('td');
        td2.textContent = s.nodo_codigo;
        const td3 = document.createElement('td');
        td3.textContent = `${s.modelo} · ${s.numero_serie} (${s.origen})`;
        const td4 = document.createElement('td');
        td4.textContent = (s.variables || []).map((v) => `${v.codigo} (${v.simbolo})`).join(', ') || '—';
        const td5 = document.createElement('td');
        td5.textContent = s.activo
          ? `Activo · ${s.total_lecturas} lecturas`
          : `Baja (${s.baja_en ? new Date(s.baja_en).toLocaleDateString('es-BO') : '—'}) · ${s.modelos_retirados} mod. retirados`;
        const td6 = document.createElement('td');
        td6.className = 'text-end';
        if (s.activo) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn btn-outline-warning btn-sm';
          btn.textContent = 'Reemplazar';
          btn.onclick = async () => {
            const nuevoCodigo = prompt(`Nuevo código para reemplazar "${s.codigo}":`, s.codigo + '-R');
            if (!nuevoCodigo) return;
            const nuevaSerie = prompt('Número de serie del sensor nuevo:');
            if (!nuevaSerie) return;
            const nuevoModelo = prompt('Modelo (DHT11, BME680 o igual al actual):', s.modelo) || s.modelo;
            const motivo = prompt('Motivo del reemplazo (mínimo 10 caracteres):', 'Reemplazo por desgaste o falla verificada');
            if (!motivo) return;
            try {
              const res = await api(`/sensores/${s.id}/reemplazar`, 'POST', {
                codigo: nuevoCodigo,
                numero_serie: nuevaSerie,
                modelo: nuevoModelo,
                motivo,
              });
              setMsg(`Sensor #${s.id} reemplazado por #${res.sensor_nuevo.id}. Modelos retirados: ${res.modelos_retirados.length}.`);
              await cargar();
            } catch (err) {
              setMsg(err.message, true);
            }
          };
          td6.append(btn);
        } else {
          td6.textContent = 'Histórico';
        }
        tr.append(td1, td2, td3, td4, td5, td6);
        tbS.append(tr);
      }
      tblS.append(tbS);
      wrapS.append(tblS);
      secSensores.append(wrapS);

      // Formulario alta de sensor
      const formSensor = document.createElement('form');
      formSensor.className = 'border-top pt-2 mt-2';
      const hS = document.createElement('div');
      hS.className = 'fw-semibold small mb-2';
      hS.textContent = 'Alta de nuevo sensor';
      formSensor.append(hS);
      const sNodo = campo(formSensor, 'Nodo', 'select');
      llenarSelect(sNodo, d.nodos.map((n) => [String(n.id), `#${n.id} · ${n.codigo} (${n.sitio_nombre})`]));
      const sCod = campo(formSensor, 'Código único (ej. BME680-01)');
      sCod.required = true;
      const sMod = campo(formSensor, 'Modelo / Perfil', 'select');
      llenarSelect(sMod, [['BME680', 'BME680 (TEMP, HUM, PRES, GAS)'], ['DHT11', 'DHT11 (TEMP, HUM)'], ['Python Script', 'Simulado (CO, PM1, PM10, PM25)']]);
      const sSer = campo(formSensor, 'Número de serie');
      sSer.required = true;
      const sOri = campo(formSensor, 'Origen', 'select');
      llenarSelect(sOri, [['real', 'Real (hardware físico)'], ['simulado', 'Simulado']]);
      const btnS = document.createElement('button');
      btnS.className = 'btn btn-primary btn-sm';
      btnS.textContent = 'Registrar sensor';
      formSensor.append(btnS);
      formSensor.onsubmit = async (e) => {
        e.preventDefault();
        try {
          const r = await api('/sensores', 'POST', {
            nodo_id: Number(sNodo.value),
            codigo: sCod.value,
            modelo: sMod.value,
            numero_serie: sSer.value,
            origen: sOri.value,
          });
          setMsg(`Sensor #${r.id} (${r.codigo}) registrado correctamente.`);
          await cargar();
        } catch (err) { setMsg(err.message, true); }
      };
      secSensores.append(formSensor);
      contenedor.append(secSensores);

      // 2. Alta de sitios y nodos + estado de nodos
      const secNodos = crearDetalles(`Gestión de sitios y nodos (${d.sitios.length} sitios · ${d.nodos.length} nodos)`);
      const formSitio = document.createElement('form');
      formSitio.className = 'mt-2 pb-2 border-bottom';
      const fSCod = campo(formSitio, 'Código de sitio (ej. SCZ-02)'); fSCod.required = true;
      const fSNom = campo(formSitio, 'Nombre del sitio'); fSNom.required = true;
      const fSLat = campo(formSitio, 'Latitud', 'number', '-17.7833'); fSLat.step = 'any'; fSLat.required = true;
      const fSLon = campo(formSitio, 'Longitud', 'number', '-63.1821'); fSLon.step = 'any'; fSLon.required = true;
      const btnSitio = document.createElement('button');
      btnSitio.className = 'btn btn-outline-primary btn-sm';
      btnSitio.textContent = 'Crear sitio';
      formSitio.append(btnSitio);
      formSitio.onsubmit = async (e) => {
        e.preventDefault();
        try {
          const r = await api('/sitios', 'POST', { codigo: fSCod.value, nombre: fSNom.value, latitud: Number(fSLat.value), longitud: Number(fSLon.value) });
          setMsg(`Sitio #${r.id} (${r.codigo}) creado.`);
          await cargar();
        } catch (err) { setMsg(err.message, true); }
      };
      secNodos.append(formSitio);

      const formNodo = document.createElement('form');
      formNodo.className = 'mt-2';
      const fNSit = campo(formNodo, 'Sitio', 'select');
      llenarSelect(fNSit, d.sitios.map((si) => [String(si.id), `#${si.id} · ${si.nombre}`]));
      const fNCod = campo(formNodo, 'Código de nodo (ej. NODO-ESP-02)'); fNCod.required = true;
      const fNInt = campo(formNodo, 'Intervalo de muestreo (segundos, divisor de 3600)', 'number', '60'); fNInt.required = true;
      const btnNodo = document.createElement('button');
      btnNodo.className = 'btn btn-primary btn-sm';
      btnNodo.textContent = 'Crear nodo';
      formNodo.append(btnNodo);
      formNodo.onsubmit = async (e) => {
        e.preventDefault();
        try {
          const r = await api('/nodos', 'POST', { sitio_id: Number(fNSit.value), codigo: fNCod.value, intervalo_muestreo_s: Number(fNInt.value) });
          setMsg(`Nodo #${r.id} (${r.codigo}) creado.`);
          await cargar();
        } catch (err) { setMsg(err.message, true); }
      };
      secNodos.append(formNodo);
      contenedor.append(secNodos);

      // 3. Mantenimientos
      const secMant = crearDetalles(`Mantenimientos registrados (${d.mantenimientos.length})`);
      const formMant = document.createElement('form');
      formMant.className = 'mt-2 pb-2 border-bottom';
      const mNodo = campo(formMant, 'Nodo', 'select');
      llenarSelect(mNodo, d.nodos.map((n) => [String(n.id), `#${n.id} · ${n.codigo} (${n.estado})`]));
      const mSens = campo(formMant, 'Sensor (opcional)', 'select');
      llenarSelect(mSens, [['', '— Ninguno / todo el nodo —'], ...d.sensores.map((s) => [String(s.id), `#${s.id} · ${s.codigo} (${s.modelo})`])]);
      const mTipo = campo(formMant, 'Tipo de mantenimiento', 'select');
      llenarSelect(mTipo, [['limpieza', 'Limpieza'], ['calibracion', 'Calibración'], ['reparacion', 'Reparación'], ['instalacion', 'Instalación'], ['reemplazo', 'Reemplazo']]);
      const mEstado = campo(formMant, 'Actualizar estado del nodo (opcional)', 'select');
      llenarSelect(mEstado, [['', '— Sin cambios —'], ['activo', 'Activo'], ['mantenimiento', 'En mantenimiento'], ['inactivo', 'Inactivo']]);
      const mDesc = campo(formMant, 'Descripción', 'textarea');
      mDesc.required = true; mDesc.minLength = 5;
      const btnMant = document.createElement('button');
      btnMant.className = 'btn btn-primary btn-sm';
      btnMant.textContent = 'Registrar mantenimiento';
      formMant.append(btnMant);
      formMant.onsubmit = async (e) => {
        e.preventDefault();
        try {
          await api('/mantenimientos', 'POST', {
            nodo_id: Number(mNodo.value),
            sensor_id: mSens.value ? Number(mSens.value) : null,
            tipo: mTipo.value,
            descripcion: mDesc.value,
            estado_nodo: mEstado.value || null,
          });
          setMsg('Mantenimiento registrado correctamente.');
          await cargar();
        } catch (err) { setMsg(err.message, true); }
      };
      secMant.append(formMant);

      const ulM = document.createElement('ul');
      ulM.className = 'list-unstyled small mt-2 mb-0';
      for (const m of d.mantenimientos.slice(0, 10)) {
        const li = document.createElement('li');
        li.className = 'py-1 border-bottom';
        li.textContent = `${new Date(m.realizado_en).toLocaleString('es-BO', { timeZone: 'America/La_Paz' })} · [${m.tipo}] ${m.nodo_codigo}${m.sensor_codigo ? ' / ' + m.sensor_codigo : ''}: ${m.descripcion} (${m.registrado_por_usuario})`;
        ulM.append(li);
      }
      if (!d.mantenimientos.length) {
        const li = document.createElement('li');
        li.className = 'text-secondary';
        li.textContent = 'Sin registros de mantenimiento todavía.';
        ulM.append(li);
      }
      secMant.append(ulM);
      contenedor.append(secMant);

      // 4. Fuentes de referencia
      const secRef = crearDetalles(`Fuentes de referencia calibradas (${d.referencias.length})`);
      const ulR = document.createElement('ul');
      ulR.className = 'list-unstyled small mt-2 pb-2 border-bottom';
      for (const r of d.referencias) {
        const li = document.createElement('li');
        li.textContent = `#${r.id} · ${r.nombre}${r.sitio_nombre ? ' (' + r.sitio_nombre + ')' : ''} — ${r.calibracion_ref || 'Sin detalle'} · ${r.total_lecturas} lecturas`;
        ulR.append(li);
      }
      secRef.append(ulR);

      const formRef = document.createElement('form');
      const rNom = campo(formRef, 'Nombre de fuente de referencia'); rNom.required = true;
      const rSit = campo(formRef, 'Sitio asociado (opcional)', 'select');
      llenarSelect(rSit, [['', '— General —'], ...d.sitios.map((si) => [String(si.id), `#${si.id} · ${si.nombre}`])]);
      const rCal = campo(formRef, 'Detalle / certificado de calibración', 'textarea');
      const btnRef = document.createElement('button');
      btnRef.className = 'btn btn-primary btn-sm';
      btnRef.textContent = 'Registrar referencia';
      formRef.append(btnRef);
      formRef.onsubmit = async (e) => {
        e.preventDefault();
        try {
          const res = await api('/referencias', 'POST', {
            nombre: rNom.value,
            sitio_id: rSit.value ? Number(rSit.value) : null,
            calibracion_ref: rCal.value,
          });
          setMsg(`Referencia #${res.id} (${res.nombre}) registrada.`);
          await cargar();
        } catch (err) { setMsg(err.message, true); }
      };
      secRef.append(formRef);
      contenedor.append(secRef);
    } catch (e) {
      setMsg(e.message, true);
    }
  }

  cargar();
});
