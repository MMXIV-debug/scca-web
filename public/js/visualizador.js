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
        const activo = enlace.getAttribute('href') === hash;
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
      const r = await fetch('/api/admin/parametros', { headers: H });
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
            <td>${d.origen === 'simulado' ? 'Simulado' : 'Real · Sensor físico'}</td>
            <td class="${d.ultima_medicion != null ? 'text-success fw-bold' : 'text-muted'}">${valor}<small class="d-block text-secondary">${d.ultima_fecha ? new Date(d.ultima_fecha).toLocaleString("es-BO", { timeZone: "America/La_Paz" }) : ""}</small></td>
          </tr>
        `;
      });
    } catch (e) { console.error(e); }
  }

  // ---------- Gráficos (Chart.js) y media semanal ----------
  const CONFIG_GRAFICOS = [
    { id: 'grafico-pm', series: [
      { codigo: 'PM1',  etiqueta: 'PM1 (µg/m³)',   color: '#c9a227', colorOscuro: '#e6c65c' },
      { codigo: 'PM25', etiqueta: 'PM2.5 (µg/m³)', color: '#1d4f91', colorOscuro: '#5b9dff' },
      { codigo: 'PM10', etiqueta: 'PM10 (µg/m³)',  color: '#0b3d2e', colorOscuro: '#4fd18b' }
    ]},
    { id: 'grafico-clima', series: [
      { codigo: 'TEMP', etiqueta: 'Temperatura (°C)',     color: '#dc3545', colorOscuro: '#ff6b7a', eje: 'y'  },
      { codigo: 'HUM',  etiqueta: 'Humedad relativa (%)', color: '#0d9ec4', colorOscuro: '#38bdf8', eje: 'y1' }
    ]},
    { id: 'grafico-gases', series: [
      { codigo: 'CO', etiqueta: 'CO (µg/m³)', color: '#6f42c1', colorOscuro: '#a78bfa' }
      // VOC: pendiente de implementar (placeholder en el HTML)
    ]}
  ];

  const graficos = {};
  let horasGrafico = 168;

  const esModoOscuro = () => document.documentElement.getAttribute('data-bs-theme') === 'dark';
  const colorSerie = s => (esModoOscuro() && s.colorOscuro ? s.colorOscuro : s.color);
  const paletaGrafico = () => esModoOscuro()
    ? { texto: '#cbd8cf', grilla: 'rgba(228, 237, 231, 0.12)' }
    : { texto: '#495057', grilla: 'rgba(0, 0, 0, 0.08)' };

  function aplicarTemaGraficos() {
    const { texto, grilla } = paletaGrafico();
    Object.entries(graficos).forEach(([id, g]) => {
      const cfg = CONFIG_GRAFICOS.find(c => c.id === id);
      g.options.plugins.legend.labels.color = texto;
      ['x', 'y', 'y1'].forEach(k => {
        if (!g.options.scales[k]) return;
        g.options.scales[k].ticks = { ...(g.options.scales[k].ticks || {}), color: texto };
        if (g.options.scales[k].grid && g.options.scales[k].grid.display !== false) {
          g.options.scales[k].grid.color = grilla;
        }
      });
      if (cfg) {
        g.data.datasets.forEach(d => {
          const s = cfg.series.find(item => d.label.startsWith(item.etiqueta + ' ·'));
          if (!s) return;
          const c = colorSerie(s);
          d.borderColor = c;
          d.backgroundColor = c;
        });
      }
      g.update('none');
    });
  }

  function formatoHora(iso) {
    return new Date(iso).toLocaleString('es-BO', {
      timeZone: 'America/La_Paz', day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
  }

  async function cargarGraficos() {
    try {
      const r = await fetch(`/api/visualizador/series?horas=${horasGrafico}`, { headers: H });
      if (!r.ok) return;
      const filas = await r.json();

      // Eje X común: todas las horas que existen, ordenadas
      const horas = [...new Set(filas.map(f => f.hora))].sort();
      const etiquetas = horas.map(formatoHora);

      // porVariable['PM25']['2026-11-13T00:00:00.000Z'] = valor
      const porVariable = {};
      filas.forEach(f => { (porVariable[f.sensor_id+'/'+f.codigo] ??= {})[f.hora] = f.valor; });
      const { texto, grilla } = paletaGrafico();

      CONFIG_GRAFICOS.forEach(cfg => {
        const datasets = cfg.series.flatMap(s => [...new Map(filas.filter(f=>f.codigo===s.codigo).map(f=>[f.sensor_id,f])).values()].map(f=>{
          const c = colorSerie(s);
          return {
            label: `${s.etiqueta} · nodo ${f.nodo_id}, sensor ${f.sensor_id}, ${f.origen}`,
            data: horas.map(h => porVariable[f.sensor_id+'/'+s.codigo]?.[h] ?? null),
            borderColor: c,
            backgroundColor: c,
            yAxisID: s.eje || 'y',
            tension: 0.35,        // línea suavizada tipo AccuWeather
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 5,
            spanGaps: false       // no presentar huecos como mediciones continuas
          };
        }));

        if (graficos[cfg.id]) {              // ya existe: solo actualizar datos
          graficos[cfg.id].data.labels = etiquetas;
          graficos[cfg.id].data.datasets = datasets;
          graficos[cfg.id].update('none');
          return;
        }

        const dobleEje = cfg.series.some(s => s.eje === 'y1');
        graficos[cfg.id] = new Chart(document.getElementById(cfg.id), {
          type: 'line',
          data: { labels: etiquetas, datasets },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },  // tooltip con todos los valores a esa hora
            plugins: { legend: { position: 'bottom', labels: { color: texto } } },
            scales: {
              x: { ticks: { maxTicksLimit: 8, maxRotation: 0, color: texto }, grid: { display: false } },
              y: { position: 'left', ticks: { color: texto }, grid: { color: grilla } },
              ...(dobleEje ? { y1: { position: 'right', ticks: { color: texto }, grid: { drawOnChartArea: false } } } : {})
            }
          }
        });
      });
    } catch (e) { console.error(e); }
  }

  new MutationObserver(mutaciones => {
    if (mutaciones.some(m => m.attributeName === 'data-bs-theme')) aplicarTemaGraficos();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-bs-theme'] });

  const FILAS_SEMANAL = [
    { codigo: 'PM1',  nombre: 'PM1',               unidad: 'µg/m³' },
    { codigo: 'PM25', nombre: 'PM2.5',             unidad: 'µg/m³' },
    { codigo: 'PM10', nombre: 'PM10',              unidad: 'µg/m³' },
    { codigo: 'TEMP', nombre: 'Temperatura',       unidad: '°C' },
    { codigo: 'HUM',  nombre: 'Humedad relativa',  unidad: '%' },
    { codigo: 'CO',   nombre: 'CO',                unidad: 'µg/m³' },
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
          <td class="fw-bold">${f.nombre}<small class="d-block text-secondary">Sensor ${d.sensor_id} · ${esc(d.origen)} · ${d.horas_validas} h válidas</small></td>
          <td class="text-end">${d.promedio} <small class="text-secondary">${f.unidad}</small></td>
          <td class="text-end small text-secondary">${d.minimo.toFixed(1)} – ${d.maximo.toFixed(1)}</td>
        </tr>`);
      }).join('');
    } catch (e) { console.error(e); }
  }

  // Botones 24 h / 7 días
  document.querySelectorAll('[data-horas]').forEach(btn => btn.addEventListener('click', () => {
    horasGrafico = Number(btn.dataset.horas);
    document.querySelectorAll('[data-horas]').forEach(b => b.classList.toggle('active', b === btn));
    cargarGraficos();
  }));

  // Al cambiar de diapositiva, Chart.js recalcula el tamaño (estaba oculta)
  document.getElementById('carrusel-graficos')?.addEventListener('slid.bs.carousel', () => {
    Object.values(graficos).forEach(g => g.resize());
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
    let actualizando = false;

    setInterval(async () => {
      if (actualizando || document.hidden) return;
      actualizando = true;
      try {
        await Promise.all([cargarResumen(), cargarSitios(), cargarParametros(), cargarGraficos(), cargarSemanal(), cargarAlertas()]);
      } finally {
        actualizando = false;
      }
    }, 15000);

  } catch (err) {
    console.error(err);
    localStorage.removeItem('token');
    window.location.href = '/';
  }
});
