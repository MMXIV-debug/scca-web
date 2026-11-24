// fetch permite enviar el JWT sin ponerlo en la URL de la suscripción.
window.observarLecturas = function observarLecturas(token, actualizar) {
  let detenido = false, controlador, temporizador;
  async function conectar() {
    if (detenido) return;
    controlador = new AbortController();
    try {
      const r = await fetch('/api/visualizador/eventos', {
        headers: { Authorization: 'Bearer ' + token }, signal: controlador.signal
      });
      if (r.status === 401 || r.status === 403) { detener(); return; }
      if (!r.ok || !r.body) throw new Error('Suscripción temporalmente no disponible');
      const lector = r.body.getReader(), decoder = new TextDecoder();
      let buffer = '';
      try {
        while (!detenido) {
          const { value, done } = await lector.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let fin;
          while ((fin = buffer.indexOf('\n\n')) !== -1) {
            const evento = buffer.slice(0, fin);
            buffer = buffer.slice(fin + 2);
            if (evento.startsWith('data:')) {
              try { await actualizar(); } catch { /* El refresco periódico sigue disponible. */ }
            }
          }
        }
      } finally { lector.releaseLock(); }
    } catch { /* Reintentar sin interrumpir el panel ante un corte de red. */ }
    if (!detenido) temporizador = setTimeout(conectar, 5000);
  }
  function detener() {
    detenido = true;
    clearTimeout(temporizador);
    controlador?.abort();
    window.removeEventListener('pagehide', detener);
  }
  window.addEventListener('pagehide', detener);
  void conectar();
  return detener;
};
