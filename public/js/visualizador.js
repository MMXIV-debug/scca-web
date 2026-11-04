document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('token');
  
  // Si no hay token, lo devolvemos al login
  if (!token) {
    window.location.href = '/';
    return;
  }

  // Configurar botón de salir
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


  // Validar sesión con el backend
  try {
    const r = await fetch('/api/me', {
      headers: { 'Authorization': 'Bearer ' + token }
    });

    if (!r.ok) {
      throw new Error('Sesión inválida');
    }

    const me = await r.json();
    
    // Si es Administrador, lo mandamos a su panel
    if (me.rol === 'Administrador') {
      window.location.href = '/dashboard.html';
      return;
    }

    // Por seguridad, confirmamos que su rol exacto sea Visualizador
    if (me.rol !== 'Visualizador') {
      alert('Rol no autorizado para esta vista.');
      localStorage.removeItem('token');
      window.location.href = '/';
      return;
    }

    // Mostrar el nombre del visualizador en pantalla
    document.getElementById('nombre-usuario').textContent = me.nombre;
    configurarNavegacion();

  } catch (err) {
    console.error(err);
    localStorage.removeItem('token');
    window.location.href = '/';
  }
});