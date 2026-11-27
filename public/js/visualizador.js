document.addEventListener('DOMContentLoaded', async () => {
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const token = localStorage.getItem('token');
  
  if (!token) {
    window.location.href = '/';
    return;
  }

  document.getElementById('btn-salir').addEventListener('click', () => {
    localStorage.removeItem('token');
    window.location.href = '/';
  });

  function configurarNavegacion() {
    const contenido = document.querySelector('.dashboard-content');
    const enlaces = [...document.querySelectorAll('.sidebar-link')];
    function mostrar(hash, animar = true) {
      const destino = document.getElementById(hash.slice(1));
      if (!destino || !contenido.contains(destino)) return;
      enlaces.forEach(enlace => {
        const destinoEnlace = enlace.getAttribute('href');
        const activo = destinoEnlace === hash || (destinoEnlace === '#seccion-resumen' && ['#seccion-sitios', '#seccion-parametros'].includes(hash));
        enlace.classList.toggle('active', activo);
        if (activo) enlace.setAttribute('aria-current', 'location');
        else enlace.removeAttribute('aria-current');
      });
      const margen = parseFloat(getComputedStyle(contenido).scrollPaddingTop) || 0;
      const top = destino.getBoundingClientRect().top - contenido.getBoundingClientRect().top + contenido.scrollTop - margen;
      contenido.scrollTo({ top: Math.max(0, top), behavior: animar && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant' });
      destino.setAttribute('tabindex', '-1');
      destino.focus({ preventScroll: true });
    }
    enlaces.forEach(enlace => enlace.addEventListener('click', event => {
      event.preventDefault();
      const hash = enlace.getAttribute('href');
      history.pushState(null, '', hash);
      mostrar(hash);
    }));
    window.addEventListener('hashchange', () => mostrar(location.hash || '#seccion-resumen'));
    mostrar(location.hash || '#seccion-resumen', false);
  }

  const H = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

  async function cargarResumen() {
      try {
        const r = await fetch('/api/visualizador/resumen', { headers: H });
        if (!r.ok) return;
        const datos = await r.json();

        document.getElementById('kpi-sitios-definidos').textContent = datos.sitios_definidos;
        document.getElementById('kpi-nodos-ubicados').textContent = datos.nodos_ubicados;
        
        const kpiIca = document.getElementById('kpi-mediciones-ica');
        // Indicador de demostración sobre horas completas, con procedencia explícita.
        if (datos.ica_score !== '-') {
          kpiIca.innerHTML = `
            <div class="d-flex align-items-center gap-2">
              <span class="fs-4 fw-bold">${datos.ica_score} AQI</span>
              <span class="badge bg-${datos.ica_color} p-2" style="font-size: 0.95em;">${datos.ica_estado}</span>
            </div>
          `;
        } else {
          kpiIca.innerHTML = `<span class="badge bg-secondary p-2">${esc(datos.ica_estado)}</span>`;
        }
        const detalle=document.createElement('small');detalle.className='d-block text-secondary mt-1';detalle.textContent=`PM2.5 · últimas 24 horas completas · ${datos.horas_validas}/24 horas válidas`+(datos.fuente?` · nodo ${datos.fuente.nodo_id}, sensor ${datos.fuente.sensor_id}, ${datos.fuente.origen}`:'')+' · sin calibración física validada';kpiIca.append(detalle);
        if (datos.ultima_pm25) {
          const lectura = document.createElement('div');
          lectura.className = 'fs-6 mt-2';
          lectura.textContent = `Última concentración PM2.5: ${Number(datos.ultima_pm25.valor).toLocaleString('es-BO')} ${datos.ultima_pm25.unidad}. `
            + new Date(datos.ultima_pm25.medido_en).toLocaleString('es-BO', { timeZone: 'America/La_Paz' }) + ' (Bolivia).';
          kpiIca.append(lectura);
        }
        if (datos.motivo) {
          const motivo = document.createElement('small');
          motivo.className = 'd-block text-secondary mt-1';
          motivo.textContent = datos.motivo;
          kpiIca.append(motivo);
        }

      } catch (e) {
        console.error(e);
      }
    }

  async function cargarSitios() {
    try {
      const r = await fetch('/api/admin/sitios-fuentes', { headers: H });
      if (!r.ok) return;
      const datos = await r.json();
      
      const badge = document.getElementById('badge-sitios');
      if (badge) {
        const nodos = new Set(datos.map(fila => fila.nodo).filter(Boolean));
        badge.textContent = nodos.size === 1 ? '1 nodo ubicado' : `${nodos.size} nodos ubicados`;
      }
      
      const tb = document.getElementById('filas-sitios'); 
      if(!tb) return;
      
      tb.innerHTML = '';
      if(datos.length === 0) {
        tb.innerHTML = '<tr><td colspan="5" class="text-center">No hay nodos definidos todavía.</td></tr>';
        return;
      }

      datos.forEach(d => {
        tb.innerHTML += `
          <tr>
            <td class="fw-bold">${esc(d.sitio)}</td>
            <td>Lat: ${d.latitud}, Lon: ${d.longitud}</td>
            <td>${esc(d.nodo || '—')}</td>
            <td>${d.origen === 'simulado' ? 'Simulado' : 'Real'}</td>
            <td><span class="badge bg-success-subtle text-success">${esc(d.estado)}</span></td>
          </tr>
        `;
      });
    } catch (e) { console.error(e); }
  }

  async function cargarParametros() {
    try {
      const r = await fetch('/api/visualizador/parametros', { headers: H });
      if (!r.ok) return;
      const datos = await r.json();
      
      const tb = document.getElementById('filas-parametros');
      if(!tb) return;

      tb.innerHTML = '';
      datos.forEach(d => {
        const valor = d.ultima_medicion != null ? parseFloat(d.ultima_medicion).toFixed(2) : 'Sin datos';
        tb.innerHTML += `
          <tr>
            <td class="fw-bold">${esc(d.parametro)}</td>
            <td>${esc(d.unidad)}</td>
            <td>${d.fusion ? esc(describirFusion(d)) : d.origen === 'simulado' ? 'Simulado' : origenFisico(d)}</td>
            <td class="${d.ultima_medicion != null ? 'text-success fw-bold' : 'text-muted'}">${valor}<small class="d-block text-secondary">${d.ultima_fecha ? new Date(d.ultima_fecha).toLocaleString("es-BO", { timeZone: "America/La_Paz" }) : ""}</small></td>
          </tr>
        `;
      });
    } catch (e) { console.error(e); }
  }

  // ---------- Gráficos (Chart.js) y media semanal ----------
  let horasGrafico = 168;
  const panelGraficos = crearGraficosMonitoreo(H);
  const cargarGraficos = () => panelGraficos.cargar(horasGrafico);
  const formatoHora = panelGraficos.formatoHora;

  const FILAS_SEMANAL = [
    { codigo: 'PM1',  nombre: 'PM1',               unidad: 'µg/m³' },
    { codigo: 'PM25', nombre: 'PM2.5',             unidad: 'µg/m³' },
    { codigo: 'PM10', nombre: 'PM10',              unidad: 'µg/m³' },
    { codigo: 'TEMP', nombre: 'Temperatura',       unidad: '°C' },
    { codigo: 'HUM',  nombre: 'Humedad relativa',  unidad: '%' },
    { codigo: 'CO',   nombre: 'CO',                unidad: 'µg/m³' },
    { codigo: 'PRES', nombre: 'Presión atmosférica', unidad: 'hPa' },
    { codigo: 'GAS', nombre: 'Resistencia de gas', unidad: 'Ω' },
    { codigo: 'ALT', nombre: 'Altitud aproximada', unidad: 'm' },
    { codigo: 'VOC',  nombre: 'VOC',               unidad: '' }   // placeholder
  ];

  async function cargarSemanal() {
    try {
      const r = await fetch('/api/visualizador/semanal', { headers: H });
      if (!r.ok) return;
      const datos = await r.json();
      const tb = document.getElementById('filas-semanal');
      if (!tb) return;
      tb.innerHTML = FILAS_SEMANAL.flatMap(f => {
        const fuentes=datos.filter(d=>d.codigo===f.codigo);
        if (!fuentes.length) return [`<tr><td class="fw-bold">${f.nombre}</td><td class="text-end text-muted" colspan="2">${f.codigo === 'VOC' ? 'Próximamente' : 'Sin cobertura suficiente'}</td></tr>`];
        return fuentes.map(d=>`<tr>
          <td class="fw-bold">${f.nombre}<small class="d-block text-secondary">${d.fusion ? `Sitio ${d.sitio_id} · DHT11/BME680` : `Sensor ${d.sensor_id} · ${esc(d.origen)}`} · ${d.horas_con_datos ?? d.horas_validas} h con lecturas · ${d.horas_validas} h con cobertura suficiente${d.incluye_parciales ? ' · incluye datos parciales' : ''}</small></td>
          <td class="text-end">${d.promedio} <small class="text-secondary">${f.unidad}</small></td>
          <td class="text-end small text-secondary">${d.minimo.toFixed(1)} – ${d.maximo.toFixed(1)}</td>
        </tr>`);
      }).join('');
    } catch (e) { console.error(e); }
  }

  let sitiosClima = [];
  let vistaClima = 'hora';
  const selectorClima = document.getElementById('clima-sitio');
  function iconoClima(codigo, dia = true) {
    if ([95, 96, 99].includes(codigo)) return 'cloud-lightning-rain';
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(codigo)) return 'cloud-rain';
    if ([71, 73, 75, 77, 85, 86].includes(codigo)) return 'cloud-snow';
    if ([45, 48].includes(codigo)) return 'cloud-fog2';
    if (codigo === 0) return dia ? 'sun' : 'moon-stars';
    return codigo === 3 ? 'clouds' : dia ? 'cloud-sun' : 'cloud-moon';
  }
  function mostrarClima() {
    const sitio = sitiosClima.find(s => String(s.sitio_id) === selectorClima.value);
    const estado = document.getElementById('clima-estado');
    const actual = document.getElementById('clima-actual');
    const filas = document.getElementById('filas-clima');
    actual.replaceChildren();
    actual.hidden = true;
    estado.className = 'small text-secondary mb-0';
    const diario = vistaClima === 'dia';
    document.getElementById('clima-periodo').textContent = diario ? 'Próximos 7 días · mín. / máx.' : 'Próximas 24 horas';
    document.getElementById('clima-columnas').innerHTML = `<tr><th scope="col">${diario ? 'Día' : 'Hora'}</th><th scope="col">${diario ? 'Mín. / Máx.' : 'Temperatura'}</th><th scope="col">Clima</th><th scope="col">${diario ? 'Lluvia máx.' : 'Lluvia'}</th></tr>`;
    if (!sitio?.consulta_id) {
      estado.textContent = sitio ? 'Todavía no hay una consulta guardada para este sitio. El servidor reintenta automáticamente.' : 'No hay sitios registrados para consultar el clima.';
      filas.innerHTML = '<tr><td colspan="4" class="text-secondary">Sin datos meteorológicos disponibles.</td></tr>';
      return;
    }
    estado.textContent = `Actualizado: ${formatoHora(sitio.consultado_en)}`;
    estado.title = `Registro #${sitio.consulta_id} · ${sitio.latitud}, ${sitio.longitud}`;
    if (sitio.desactualizado) {
      estado.textContent += ' · Datos pendientes de actualización';
      estado.className = 'small text-warning-emphasis mb-0';
    }
    const d = sitio.datos.find(d => d.tipo === 'actual');
    if (d) {
      actual.hidden = false;
      actual.innerHTML = `<i class="bi bi-${iconoClima(d.codigo_wmo, d.es_dia)} clima-icono" aria-hidden="true"></i>
        <div><span class="clima-etiqueta">Ahora · estimado</span><div class="clima-temperatura">${Number(d.temperatura_c).toFixed(1)}<span> °C</span></div></div>
        <div class="clima-condicion"><strong>${esc(d.condicion)}</strong><small class="d-block text-secondary">${esc(formatoHora(d.valido_en))}</small></div>`;
    }
    const pronostico = diario ? sitio.diario || [] : sitio.datos.filter(d => d.tipo === 'pronostico');
    filas.innerHTML = pronostico.map(d => `<tr>
      <td class="text-nowrap">${esc(diario ? new Date(d.valido_en).toLocaleDateString('es-BO', { timeZone: 'America/La_Paz', weekday: 'short', day: '2-digit', month: 'short' }) : formatoHora(d.valido_en))}</td>
      <td class="fw-semibold text-nowrap">${diario ? `<span class="text-secondary">${Number(d.minima_c).toFixed(1)}°</span> / ${Number(d.maxima_c).toFixed(1)}°` : `${Number(d.temperatura_c).toFixed(1)} °C`}</td>
      <td><span class="clima-celda-condicion"><i class="bi bi-${iconoClima(d.codigo_wmo, d.es_dia ?? true)}" aria-hidden="true"></i>${esc(d.condicion)}</span></td>
      <td>${d.probabilidad_lluvia_pct == null ? 'Sin datos' : `${Number(d.probabilidad_lluvia_pct).toFixed(0)} %`}</td>
    </tr>`).join('') || '<tr><td colspan="4" class="text-secondary py-4 text-center">El pronóstico diario estará disponible en la próxima actualización.</td></tr>';
  }
  selectorClima.addEventListener('change', mostrarClima);
  document.querySelectorAll('[data-clima-vista]').forEach(btn => btn.addEventListener('click', () => {
    vistaClima = btn.dataset.climaVista;
    document.querySelectorAll('[data-clima-vista]').forEach(b => {
      const activo = b === btn;
      b.classList.toggle('active', activo);
      b.setAttribute('aria-pressed', String(activo));
    });
    mostrarClima();
  }));
  async function cargarClima() {
    try {
      const r = await fetch('/api/visualizador/clima', { headers: H, cache: 'no-store' });
      if (!r.ok) throw new Error('Clima no disponible');
      const datos = await r.json();
      const seleccion = selectorClima.value;
      sitiosClima = datos.items;
      selectorClima.replaceChildren(...sitiosClima.map(s => new Option(s.nombre, String(s.sitio_id))));
      selectorClima.disabled = !sitiosClima.length;
      if (sitiosClima.some(s => String(s.sitio_id) === seleccion)) selectorClima.value = seleccion;
      mostrarClima();
    } catch {
      const estado = document.getElementById('clima-estado');
      estado.className = 'small text-warning-emphasis mb-0';
      estado.textContent = 'Actualización pendiente. Reintentando…' + (sitiosClima.length ? ' Se muestra la última consulta recibida.' : '');
    }
  }

  // Botones 24 h / 7 días
  document.querySelectorAll('[data-horas]').forEach(btn => btn.addEventListener('click', () => {
    horasGrafico = Number(btn.dataset.horas);
    document.querySelectorAll('[data-horas]').forEach(b => b.classList.toggle('active', b === btn));
    cargarGraficos();
  }));

  // Al cambiar de diapositiva, Chart.js recalcula el tamaño (estaba oculta)
  document.getElementById('carrusel-graficos')?.addEventListener('slid.bs.carousel', () => {
    panelGraficos.redimensionar();
  });

  async function cargarAlertas(){try{const r=await fetch('/api/visualizador/alertas',{headers:H});if(!r.ok)return;const datos=await r.json();let box=document.getElementById('avisos-alertas');if(!box){box=document.createElement('div');box.id='avisos-alertas';box.className='alert alert-warning';document.getElementById('seccion-resumen')?.prepend(box);}box.replaceChildren();box.hidden=!datos.items.length;for(const a of datos.items){const p=document.createElement('p');p.className='mb-1';p.textContent=`${a.tipo==='tecnica'?'Recepción de datos':'Umbral configurado'} · nodo ${a.nodo_id}: ${a.observacion}`;box.append(p);}}catch{}}

  try {
    const r = await fetch('/api/me', {
      headers: { 'Authorization': 'Bearer ' + token }
    });

    if (!r.ok) {
      throw new Error('Sesión inválida');
    }

    const me = await r.json();
    
    if (me.rol === 'Administrador') {
      window.location.href = '/dashboard.html';
      return;
    }

    if (me.rol !== 'Visualizador') {
      alert('Rol no autorizado para esta vista.');
      localStorage.removeItem('token');
      window.location.href = '/';
      return;
    }

    document.getElementById('nombre-usuario').textContent = me.nombre;
    
    configurarNavegacion();
    
    // Cargar todos los datos
    cargarResumen();
    cargarSitios();
    cargarParametros();
    cargarGraficos();
    cargarSemanal();
    cargarAlertas();
    cargarClima();
    let actualizando = false, refrescoPendiente = false;

    async function actualizarPanel() {
      if (document.hidden) return;
      refrescoPendiente = true;
      if (actualizando) return;
      actualizando = true;
      try {
        do {
          refrescoPendiente = false;
          await Promise.all([cargarResumen(), cargarSitios(), cargarParametros(), cargarGraficos(), cargarSemanal(), cargarAlertas(), cargarClima()]);
        } while (refrescoPendiente && !document.hidden);
      } finally {
        actualizando = false;
      }
    }
    setInterval(actualizarPanel, 15000);
    window.observarLecturas(token, actualizarPanel);

  } catch (err) {
    console.error(err);
    localStorage.removeItem('token');
    window.location.href = '/';
  }
});
