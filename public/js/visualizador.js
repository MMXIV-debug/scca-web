document.addEventListener('DOMContentLoaded', async () => {
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
      kpiIca.innerHTML = `<span class="badge bg-${datos.ica_color} p-2" style="font-size: 0.95em;">${datos.ica_estado}</span>`;

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
      if(badge) badge.textContent = `${datos.length} nodos ubicados`;
      
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
            <td class="fw-bold">${d.sitio}</td>
            <td>Lat: ${d.latitud}, Lon: ${d.longitud}</td>
            <td>${d.nodo || '—'}</td>
            <td>${d.origen === 'simulado' ? 'Simulado · Python' : 'Real'}</td>
            <td><span class="badge bg-success-subtle text-success">${d.estado}</span></td>
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
        const valor = d.ultima_medicion ? parseFloat(d.ultima_medicion).toFixed(2) : 'Sin datos';
        tb.innerHTML += `
          <tr>
            <td class="fw-bold">${d.parametro}</td>
            <td>${d.unidad}</td>
            <td>${d.origen === 'simulado' ? 'Simulado · Python' : 'Real · Sensor físico'}</td>
            <td class="${d.ultima_medicion ? 'text-success fw-bold' : 'text-muted'}">${valor}</td>
          </tr>
        `;
      });
    } catch (e) { console.error(e); }
  }

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

  } catch (err) {
    console.error(err);
    localStorage.removeItem('token');
    window.location.href = '/';
  }
});