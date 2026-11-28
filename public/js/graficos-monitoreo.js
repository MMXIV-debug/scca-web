  function describirFusion(d) {
    const fuentes = (d.componentes || []).map(c => `${c.modelo} · nodo ${c.nodo_id}: ${c.porcentaje} %`).join(' + ');
    return `Sitio ${d.sitio_id} · ${fuentes || 'Sin datos válidos evaluados por ML'}`
      + (d.estado_fusion === 'respaldo' ? ' · respaldo' : '');
  }

function origenFisico(d) {
  if (d.modelo?.trim().toUpperCase() !== 'BME680') return 'Real · Sensor físico';
  const nodo = Number.isInteger(d.nodo_id) ? ' · nodo ' + d.nodo_id : '';
  return 'BME680' + nodo + (d.codigo === 'ALT' ? ' · estimada' : '');
}
function crearGraficosMonitoreo(H) {
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
    { id: 'grafico-pres', series: [{ codigo: 'PRES', etiqueta: 'Presión atmosférica (hPa)', color: '#237188', colorOscuro: '#73cad3' }] },
    { id: 'grafico-gas', series: [{ codigo: 'GAS', etiqueta: 'Resistencia de gas (Ω)', color: '#237188', colorOscuro: '#73cad3' }] },
    { id: 'grafico-alt', series: [{ codigo: 'ALT', etiqueta: 'Altitud aproximada (m)', color: '#237188', colorOscuro: '#73cad3' }] },
    { id: 'grafico-gases', series: [
      { codigo: 'CO', etiqueta: 'CO (µg/m³)', color: '#6f42c1', colorOscuro: '#a78bfa' }
      // VOC: pendiente de implementar (placeholder en el HTML)
    ]}
  ];

  const graficos = {};


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

  async function cargarGraficos(horasGrafico = 24, filtros = {}) {
    try {
      const sufijo = filtros.sitioId ? `&sitioId=${encodeURIComponent(filtros.sitioId)}` : '';
      const r = await fetch(`/api/visualizador/series?horas=${horasGrafico}${sufijo}`, { headers: H });
      if (!r.ok) return;
      const filas = await r.json();

      // Eje X común: todas las horas que existen, ordenadas
      const horas = [...new Set(filas.map(f => f.hora))].sort();
      const etiquetas = horas.map(formatoHora);

      // porVariable['PM25']['2026-11-13T00:00:00.000Z'] = valor
      const porVariable = {};
      filas.forEach(f => { (porVariable[f.sensor_id+'/'+f.codigo] ??= {})[f.hora] = f; });
      const { texto, grilla } = paletaGrafico();

      CONFIG_GRAFICOS.filter(cfg => document.getElementById(cfg.id)).forEach(cfg => {
        const datasets = cfg.series.flatMap(s => [...new Map(filas.filter(f=>f.codigo===s.codigo).map(f=>[f.sensor_id,f])).values()].map(f=>{
          const c = colorSerie(s);
          return {
            label: f.fusion ? `${s.etiqueta} · sitio ${f.sitio_id} · DHT11/BME680` : `${s.etiqueta} · nodo ${f.nodo_id}, sensor ${f.sensor_id}, ${f.origen}`,
            data: horas.map(h => porVariable[f.sensor_id+'/'+s.codigo]?.[h]?.valor ?? null),
            metadatosHoras: horas.map(h => porVariable[f.sensor_id+'/'+s.codigo]?.[h]),
            borderColor: c,
            backgroundColor: c,
            yAxisID: s.eje || 'y',
            tension: 0.35,        // línea suavizada tipo AccuWeather
            borderWidth: 2,
            pointRadius: 3,
            pointStyle: contexto => contexto.dataset.metadatosHoras[contexto.dataIndex]?.parcial ? 'triangle' : 'circle',
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
            plugins: {
              legend: { position: 'bottom', labels: { color: texto } },
              tooltip: { callbacks: { afterLabel: contexto => {
                const hora = contexto.dataset.metadatosHoras[contexto.dataIndex];
                if (!hora) return '';
                return `${hora.parcial ? 'Parcial' : 'Cobertura suficiente'} · ${Math.round(hora.cobertura * 100)} % de cobertura`
                  + (hora.hora_cerrada === false ? ' · hora en curso' : '')
                  + (hora.fusion ? ` · ${describirFusion(hora)}` : '');
              } } },
            },
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

  return { cargar: cargarGraficos, formatoHora, redimensionar: () => Object.values(graficos).forEach(g => g.resize()) };
}
