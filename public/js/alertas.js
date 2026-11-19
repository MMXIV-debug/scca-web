document.addEventListener('DOMContentLoaded', async () => {
  const $ = id => document.getElementById(id), token = localStorage.getItem('token');
  let cursor = '0', siguiente = '0';
  const mensaje = t => { $('mensaje').textContent = t; };
  async function api(url, body) {
    const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await r.json(); if (!r.ok) throw Error(data.error || 'No se pudo consultar alertas.'); return data;
  }
  async function cargar() {
    const data = await api(`/api/admin/alertas?estado=${encodeURIComponent($('estado').value)}&despuesDe=${cursor}`);
    siguiente = data.siguiente_despues_de; $('filas').replaceChildren();
    for (const a of data.items) {
      const tr = document.createElement('tr'); for (let i=0; i<4; i++) tr.append(document.createElement('td'));
      tr.children[0].textContent = `${a.id} / nodo ${a.nodo_id}`;
      tr.children[1].textContent = `${a.regla}: ${a.observacion || ''}`;
      tr.children[2].textContent = `${a.estado} · ${new Date(a.generada_en).toLocaleString()}`;
      if (a.estado === 'abierta') {
        const motivo = document.createElement('textarea'); motivo.placeholder = 'Describe la intervención (mínimo 10 caracteres)'; motivo.setAttribute('aria-label', 'Motivo para alerta ' + a.id); motivo.maxLength = 1000;
        const boton = document.createElement('button'); boton.textContent = 'Registrar atención'; boton.className = 'btn btn-primary btn-sm';
        boton.addEventListener('click', async () => {
          if (motivo.value.trim().length < 10) return mensaje('Describe el motivo con al menos 10 caracteres.');
          boton.disabled = true;
          try { await api(`/api/admin/alertas/${a.id}/atender`, { motivo: motivo.value.trim() }); await cargar(); mensaje('Atención registrada.'); }
          catch (e) { mensaje(e.message); boton.disabled = false; }
        }); tr.children[3].append(motivo, boton);
      } else tr.children[3].textContent = a.atendida_por ? `Administrador ${a.atendida_por}` : '—';
      $('filas').append(tr);
    }
    $('siguiente').disabled = data.items.length < 50; mensaje(data.items.length ? `${data.items.length} alertas en esta página.` : 'No hay alertas para este filtro.');
  }
  const recargar = async () => { try { await cargar(); } catch (e) { mensaje(e.message); } };
  $('actualizar').onclick = () => { cursor='0'; recargar(); };
  $('estado').onchange = () => { cursor='0'; recargar(); };
  $('siguiente').onclick = () => { cursor=siguiente; recargar(); };
  $('comprobar').onclick = async () => {
    $('comprobar').disabled = true;
    try { const r=await api('/api/admin/alertas/comprobar', {}); cursor='0'; await cargar(); mensaje(`${r.abiertas} nuevas, ${r.resueltas} resueltas. Umbral: ${r.umbral_s} segundos.`); }
    catch(e){ mensaje(e.message); } finally { $('comprobar').disabled=false; }
  };
  try { const u=await api('/api/me'); if(u.rol!=='Administrador')throw Error('Se requiere sesión de Administrador.'); $('contenido').hidden=false; await cargar(); }
  catch(e){ mensaje(e.message); }
});
