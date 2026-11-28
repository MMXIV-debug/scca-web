(function () {
  const INACTIVIDAD_MS = 15 * 60 * 1000;

  window.iniciarControlInactividad = function iniciarControlInactividad(onCerrarSesion) {
    let timer = null;
    let cerrado = false;

    const cerrarPorInactividad = () => {
      if (cerrado) return;
      cerrado = true;
      const token = localStorage.getItem('token');
      if (token) {
        fetch('/api/logout', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token },
          keepalive: true,
        }).catch(() => {});
      }
      localStorage.removeItem('token');
      try {
        sessionStorage.setItem(
          'scca_motivo_salida',
          'Tu sesión se cerró automáticamente tras 15 minutos de inactividad.',
        );
      } catch {
        /* Ignorar si sessionStorage no está disponible. */
      }
      if (typeof onCerrarSesion === 'function') onCerrarSesion();
      else window.location.href = '/';
    };

    let ultimoAviso = 0;
    const avisarServidor = () => {
      const t = localStorage.getItem('token');
      if (!t || Date.now() - ultimoAviso < 60000) return;
      ultimoAviso = Date.now();
      fetch('/api/sesion/actividad', { method: 'POST', headers: { Authorization: 'Bearer ' + t } })
        .then((r) => { if (r.status === 401) cerrarPorInactividad(); })
        .catch(() => {});
    };
    const reiniciar = () => {
      if (cerrado) return;
      clearTimeout(timer);
      timer = setTimeout(cerrarPorInactividad, INACTIVIDAD_MS);
      avisarServidor();
    };

    ['pointerdown', 'keydown', 'mousemove', 'scroll', 'touchstart'].forEach((ev) => {
      window.addEventListener(ev, reiniciar, { passive: true });
    });

    reiniciar();
    return () => {
      cerrado = true;
      clearTimeout(timer);
    };
  };
})();
