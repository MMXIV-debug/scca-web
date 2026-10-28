document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('token');
  if (!token) {
    window.location.href = '/';
    return;
  }

  const H = {
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json'
  };

  const quienEl = document.getElementById('quien');
  const btnSalir = document.getElementById('btn-salir');

  const salir = () => {
    localStorage.removeItem('token');
    window.location.href = '/';
  };

  if (btnSalir) btnSalir.addEventListener('click', salir);

  async function init() {
    try {
      const r = await fetch('/api/me', { headers: H });
      if (!r.ok) return salir();

      const me = await r.json();
      quienEl.textContent = `${me.nombre} (${me.rol})`;

      if (me.rol !== 'Administrador') {
        alert('Acceso restringido: debes ser Administrador.');
        return salir();
      }

      cargarTodo();
    } catch (err) {
      console.error(err);
      salir();
    }
  }

  window.cargarTodo = async function() {
    await Promise.all([
      cargarSolicitudes(), 
      cargarUsuarios(), 
      cargarMetricasMonitoreo()
    ]);
  };

  // 1. Solicitudes pendientes
  async function cargarSolicitudes() {
    try {
      const r = await fetch('/api/admin/solicitudes', { headers: H });
      if (!r.ok) return;

      const lista = await r.json();
      const tb = document.getElementById('filas-solicitudes');
      const nada = document.getElementById('nada-solicitudes');
      const kpi = document.getElementById('kpi-solicitudes');
      const tag = document.getElementById('tag-pendientes');

      tb.innerHTML = '';
      kpi.textContent = `${lista.length} pendientes`;
      tag.textContent = `${lista.length} por revisar`;

      if (lista.length === 0) {
        nada.classList.remove('d-none');
        return;
      }
      nada.classList.add('d-none');

      lista.forEach(s => {
        const tr = document.createElement('tr');

        tr.innerHTML = `
          <td class="fw-bold">${s.username}</td>
          <td>${s.nombre_completo}</td>
          <td><span class="badge bg-light text-dark border">${s.rol_solicitado}</span></td>
        `;

        const tdSel = document.createElement('td');
        const sel = document.createElement('select');
        sel.className = 'form-select form-select-sm';
        ['Visualizador', 'Administrador'].forEach(opt => {
          const o = new Option(opt, opt);
          if (opt === s.rol_solicitado) o.selected = true;
          sel.add(o);
        });
        tdSel.appendChild(sel);
        tr.appendChild(tdSel);

        const tdAcc = document.createElement('td');
        tdAcc.className = 'text-end text-nowrap';

        const btnAprobar = document.createElement('button');
        btnAprobar.className = 'btn-aprobar me-2';
        btnAprobar.textContent = 'Aprobar';
        btnAprobar.onclick = () => resolver(s.id, 'aprobar', { rol: sel.value });

        const btnRechazar = document.createElement('button');
        btnRechazar.className = 'btn-rechazar';
        btnRechazar.textContent = 'Rechazar';
        btnRechazar.onclick = () => resolver(s.id, 'rechazar', {});

        tdAcc.append(btnAprobar, btnRechazar);
        tr.appendChild(tdAcc);

        tb.appendChild(tr);
      });
    } catch (e) {
      console.error(e);
    }
  }

  // 2. Usuarios activos
  async function cargarUsuarios() {
    try {
      const r = await fetch('/api/admin/usuarios', { headers: H });
      if (!r.ok) return;

      const usuarios = await r.json();
      const tb = document.getElementById('filas-usuarios');
      const nada = document.getElementById('nada-usuarios');
      const kpi = document.getElementById('kpi-usuarios-activos');

      tb.innerHTML = '';
      kpi.textContent = `${usuarios.length} cuentas activas`;

      if (usuarios.length === 0) {
        nada.classList.remove('d-none');
        return;
      }
      nada.classList.add('d-none');

      usuarios.forEach(u => {
        const tr = document.createElement('tr');
        const rolBadge = u.rol === 'Administrador' ? 'badge-admin' : 'badge-vis';

        tr.innerHTML = `
          <td class="fw-bold">${u.username}</td>
          <td>${u.nombre_completo}</td>
          <td class="text-muted small">${u.email || '—'}</td>
          <td><span class="badge-rol ${rolBadge}">${u.rol}</span></td>
          <td><span class="badge bg-success-subtle text-success border border-success-subtle">Activo</span></td>
        `;
        tb.appendChild(tr);
      });
    } catch (e) {
      console.error(e);
    }
  }

  // 3. Métricas operativas de nodos y sensores
  async function cargarMetricasMonitoreo() {
    try {
      const r = await fetch('/api/admin/metricas-monitoreo', { headers: H });
      if (!r.ok) return;

      const d = await r.json();
      const kpiFuentes = document.getElementById('kpi-fuentes-fisicas');
      const kpiSim = document.getElementById('kpi-simulaciones');

      if (kpiFuentes) {
        const textoNodo = d.nodos_activos === 1 ? 'nodo' : 'nodos';
        const textoSensor = d.sensores_reales === 1 ? 'sensor' : 'sensores';
        kpiFuentes.textContent = `${d.nodos_activos} ${textoNodo} / ${d.sensores_reales} ${textoSensor}`;
      }

      if (kpiSim) {
        if (d.sensores_simulados > 0) {
          const textoEj = d.sensores_simulados === 1 ? 'ejecución activa' : 'ejecuciones activas';
          kpiSim.textContent = `${d.sensores_simulados} ${textoEj}`;
        } else {
          kpiSim.textContent = '0 activas';
        }
      }
    } catch (err) {
      console.error('Error cargando métricas de monitoreo:', err);
    }
  }

  async function resolver(id, accion, body) {
    try {
      await fetch(`/api/admin/solicitudes/${id}/${accion}`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify(body)
      });
      cargarTodo();
    } catch (e) {
      console.error(e);
    }
  }

  init();
});