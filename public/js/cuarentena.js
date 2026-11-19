document.addEventListener('DOMContentLoaded', async () => {
  const $ = id => document.getElementById(id);
  const token = localStorage.getItem('token');
  let cursor = '0', siguiente = '0', ocupado = false;
  const mensaje = texto => { $('mensaje').textContent = texto; };
  async function api(url, opciones = {}) {
    const respuesta = await fetch(url, { ...opciones, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });
    const cuerpo = await respuesta.json();
    if (!respuesta.ok) throw new Error(cuerpo.error || 'No se pudo completar la operación.');
    return cuerpo;
  }
  async function cargar() {
    const pagina = await api(`/api/admin/cuarentena?estado=${encodeURIComponent($('estado').value)}&despuesDe=${cursor}&limite=50`);
    siguiente = pagina.siguiente_despues_de;
    $('filas').replaceChildren();
    for (const item of pagina.items) {
      const fila = document.createElement('tr');
      for (let i = 0; i < 4; i++) fila.appendChild(document.createElement('td'));
      if (item.estado === 'pendiente') {
        const check = document.createElement('input'); check.type = 'checkbox'; check.value = item.id;
        check.setAttribute('aria-label', `Seleccionar muestra ${item.id}`); fila.children[0].append(check);
      }
      fila.children[1].textContent = `${item.id} · ${new Date(item.recibido_en).toLocaleString()}`;
      const detalles = document.createElement('details'), resumen = document.createElement('summary'), datos = document.createElement('pre');
      resumen.textContent = item.causa; datos.textContent = JSON.stringify(item.payload, null, 2);
      detalles.append(resumen, datos); fila.children[2].append(detalles);
      fila.children[3].textContent = item.estado + (item.motivo ? ` · ${item.motivo} · administrador ${item.usuario_id}` : '');
      $('filas').append(fila);
    }
    $('siguiente').disabled = pagina.items.length < 50;
    mensaje(pagina.items.length ? `${pagina.items.length} muestras en esta página.` : 'No hay muestras para este filtro.');
  }
  async function actualizar() { try { await cargar(); } catch (e) { mensaje(e.message); } }
  $('estado').addEventListener('change', () => { cursor = '0'; actualizar(); });
  $('recargar').addEventListener('click', () => { cursor = '0'; actualizar(); });
  $('siguiente').addEventListener('click', () => { cursor = siguiente; actualizar(); });
  $('decision').addEventListener('submit', async evento => {
    evento.preventDefault(); if (ocupado) return;
    const ids = [...$('filas').querySelectorAll('input:checked')].map(i => i.value);
    if (!ids.length) return mensaje('Selecciona al menos una muestra.');
    const accion = $('accion').value, motivo = $('motivo').value.trim();
    if (!confirm(`¿Confirmas ${accion} ${ids.length} muestras?\nMotivo: ${motivo}`)) return;
    ocupado = true; $('guardar').disabled = true;
    try {
      await api('/api/admin/cuarentena/decisiones', { method: 'POST', body: JSON.stringify({ ids, accion, motivo }) });
      cursor = '0'; await cargar(); $('motivo').value = ''; mensaje('Decisión registrada y auditada.');
    } catch (e) { mensaje(e.message); }
    finally { ocupado = false; $('guardar').disabled = false; }
  });
  try {
    if (!token) throw new Error('Inicia sesión como administrador.');
    const usuario = await api('/api/me');
    if (usuario.rol !== 'Administrador') throw new Error('Esta sección es exclusiva de administradores.');
    $('contenido').hidden = false; await cargar();
  } catch (e) { mensaje(e.message); }
});
