// Limitador de intentos en memoria (sin dependencias externas).
function crearLimitador({ ventanaMs, max, maxClaves = 20000 }) {
  const mapa = new Map();
  const limpiar = () => {
    const ahora = Date.now();
    for (const [clave, e] of mapa) if (e.reinicio <= ahora) mapa.delete(clave);
  };
  setInterval(limpiar, 60000).unref();

  const vigente = (clave) => {
    const e = mapa.get(clave);
    if (!e) return null;
    if (e.reinicio <= Date.now()) { mapa.delete(clave); return null; }
    return e;
  };
  const respuesta = (e) => ({
    permitido: !e || e.n < max,
    reintentarEn: e ? Math.max(1, Math.ceil((e.reinicio - Date.now()) / 1000)) : 0,
  });

  return {
    // Consulta sin contar un intento.
    revisar(clave) { return respuesta(vigente(clave)); },
    // Cuenta un intento y devuelve si aún está permitido.
    consumir(clave) {
      let e = vigente(clave);
      if (!e) {
        if (mapa.size >= maxClaves) limpiar();
        if (mapa.size >= maxClaves) return { permitido: false, reintentarEn: Math.ceil(ventanaMs / 1000) };
        e = { n: 0, reinicio: Date.now() + ventanaMs };
        mapa.set(clave, e);
      }
      e.n++;
      return { permitido: e.n <= max, reintentarEn: Math.max(1, Math.ceil((e.reinicio - Date.now()) / 1000)) };
    },
    reiniciar(clave) { mapa.delete(clave); },
  };
}

// Middleware: cuenta cada petición por IP.
function limitarPorIp(limitador, mensaje) {
  return (req, res, next) => {
    const r = limitador.consumir(req.ip || 'desconocida');
    if (r.permitido) return next();
    res.set('Retry-After', String(r.reintentarEn));
    return res.status(429).json({ error: mensaje, reintentar_en_s: r.reintentarEn });
  };
}

module.exports = { crearLimitador, limitarPorIp };
