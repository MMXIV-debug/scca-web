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
        window.location.href = '/visualizador.html';
        return;
      }

      await cargarTodo();
      configurarNavegacion();
      let actualizando = false;
      setInterval(async () => {
        if (actualizando || document.hidden) return;
        actualizando = true;
        try {
          await Promise.all([cargarMetricasMonitoreo(), cargarSitios(), cargarParametros()]);
        } finally {
          actualizando = false;
        }
      }, 15000);
    } catch (err) {
      console.error(err);
      salir();
    }
  }

window.cargarTodo = async function() {
    await Promise.all([
      cargarSolicitudes(), 
      cargarUsuarios(), 
      cargarMetricasMonitoreo(),
      cargarSitios(),
      cargarParametros()
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

        agregarCelda(tr, s.username, 'fw-bold');
        agregarCelda(tr, s.nombre_completo);
        const tdRol = agregarCelda(tr, '');
        const badge = document.createElement('span');
        badge.className = 'badge bg-light text-dark border';
        badge.textContent = s.rol_solicitado;
        tdRol.appendChild(badge);

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

  function agregarCelda(fila, texto, clase = '') {
    const celda = document.createElement('td');
    celda.className = clase;
    celda.textContent = texto;
    fila.appendChild(celda);
    return celda;
  }

  function agregarRol(fila, usuario) {
    const celda = agregarCelda(fila, '');
    const badge = document.createElement('span');
    badge.className = 'badge-rol ' + (usuario.rol === 'Administrador' ? 'badge-admin' : 'badge-vis');
    badge.textContent = usuario.rol;
    celda.appendChild(badge);
    if (usuario.admin_principal || usuario.administrador_desde) {
      const detalle = document.createElement('small');
      detalle.className = 'd-block text-muted mt-1';
      detalle.textContent = usuario.admin_principal ? 'Principal' :
        'Desde ' + new Date(usuario.administrador_desde).toLocaleDateString('es-BO');
      celda.appendChild(detalle);
    }
    if (!usuario.puede_cambiar_rol) return;

    const controles = document.createElement('div');
    controles.className = 'd-flex flex-wrap align-items-center gap-2 mt-2';
    const selector = document.createElement('select');
    selector.className = 'form-select form-select-sm selector-rol';
    selector.setAttribute('aria-label', 'Cambiar rol de ' + usuario.username);
    ['Visualizador', 'Administrador'].forEach(rol => {
      selector.add(new Option(rol, rol, false, rol === usuario.rol));
    });
    const guardar = document.createElement('button');
    guardar.type = 'button';
    guardar.className = 'btn-aprobar';
    guardar.textContent = 'Guardar';
    guardar.setAttribute('aria-label', 'Guardar rol de ' + usuario.username);
    guardar.disabled = true;
    selector.onchange = () => { guardar.disabled = selector.value === usuario.rol; };
    guardar.onclick = async () => {
      if (!confirm(`¿Cambiar el rol de "${usuario.username}" a ${selector.value}?`)) return;
      selector.disabled = true;
      guardar.disabled = true;
      try {
        const r = await fetch(`/api/admin/usuarios/${usuario.id}/rol`, {
          method: 'PATCH', headers: H, body: JSON.stringify({ rol: selector.value })
        });
        const datos = await r.json();
        if (!r.ok) {
          if (r.status === 401) return salir();
          alert(datos.error || 'No se pudo cambiar el rol');
        }
        await cargarTodo();
      } catch {
        alert('No se pudo conectar con el servidor');
      } finally {
        selector.disabled = false;
        guardar.disabled = selector.value === usuario.rol;
      }
    };
    controles.append(selector, guardar);
    celda.appendChild(controles);
  }

  // 2. Usuarios activos e inactivos separados
  async function cargarUsuarios() {
    try {
      const r = await fetch('/api/admin/usuarios', { headers: H });
      if (!r.ok) return;

      const todos = await r.json();

      const activos = todos.filter(u => u.estado === 'aprobado' && u.activo === true);
      const inactivos = todos.filter(u => u.estado === 'inactivo' || u.activo === false);

      // Tabla: Activos
      const tbActivos = document.getElementById('filas-usuarios');
      const nadaActivos = document.getElementById('nada-usuarios');
      const kpi = document.getElementById('kpi-usuarios-activos');

      tbActivos.innerHTML = '';
      if (kpi) kpi.textContent = `${activos.length} cuentas activas`;

      if (activos.length === 0) {
        nadaActivos.classList.remove('d-none');
      } else {
        nadaActivos.classList.add('d-none');
        activos.forEach(u => {
          const tr = document.createElement('tr');
          agregarCelda(tr, u.username, 'fw-bold');
          agregarCelda(tr, u.nombre_completo);
          agregarCelda(tr, u.email || '—', 'text-muted small');
          agregarRol(tr, u);
          const estado = agregarCelda(tr, '');
          estado.innerHTML = '<span class="badge bg-success-subtle text-success border border-success-subtle">Activo</span>';
          const acciones = agregarCelda(tr, '', 'text-end');
          if (u.puede_inhabilitar) {
            const boton = document.createElement('button');
            boton.className = 'btn-inhabilitar';
            boton.textContent = 'Inhabilitar';
            boton.onclick = () => inhabilitarUsuario(u.id, u.username);
            acciones.appendChild(boton);
          } else {
            acciones.classList.add('text-muted', 'small');
            acciones.textContent = u.motivo_proteccion || 'Sin permiso';
          }
          tbActivos.appendChild(tr);
        });
      }

      // Tabla: Inactivos (difuminados)
      const tbInactivos = document.getElementById('filas-inactivos');
      const nadaInactivos = document.getElementById('nada-inactivos');
      const tagInactivos = document.getElementById('tag-inactivos');

      tbInactivos.innerHTML = '';
      if (tagInactivos) tagInactivos.textContent = `${inactivos.length} inactivos`;

      if (inactivos.length === 0) {
        nadaInactivos.classList.remove('d-none');
      } else {
        nadaInactivos.classList.add('d-none');
        inactivos.forEach(u => {
          const tr = document.createElement('tr');
          agregarCelda(tr, u.username, 'fw-semibold text-secondary text-decoration-line-through');
          agregarCelda(tr, u.nombre_completo);
          agregarCelda(tr, u.email || '—', 'small');
          agregarRol(tr, u);
          const estado = agregarCelda(tr, '');
          estado.innerHTML = '<span class="badge bg-danger-subtle text-danger border border-danger-subtle">Inactivo</span>';
          const acciones = agregarCelda(tr, '', 'text-end');
          if (u.puede_reactivar) {
            const boton = document.createElement('button');
            boton.className = 'btn-reactivar';
            boton.textContent = 'Reactivar';
            boton.onclick = () => reactivarUsuario(u.id);
            acciones.appendChild(boton);
          } else {
            acciones.classList.add('text-muted', 'small');
            acciones.textContent = u.motivo_proteccion || 'Sin permiso';
          }
          tbInactivos.appendChild(tr);
        });
      }

    } catch (e) {
      console.error('Error cargando usuarios:', e);
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
      const r = await fetch(`/api/admin/solicitudes/${id}/${accion}`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify(body)
      });
      const datos = await r.json();
      if (!r.ok) return alert(datos.error || 'No se pudo resolver la solicitud');
      cargarTodo();
    } catch (e) {
      console.error(e);
    }
  }

  window.inhabilitarUsuario = async function(id, username) {
    const motivo = prompt(`¿Por qué motivo deseas inhabilitar al usuario "${username}"?`, 'Violación de políticas / Fin de ciclo');
    if (motivo === null) return;

    try {
      const r = await fetch(`/api/admin/usuarios/${id}/inhabilitar`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ motivo })
      });
      const d = await r.json();
      if (!r.ok) return alert(d.error || 'No se pudo inhabilitar');
      cargarTodo();
    } catch (e) {
      console.error(e);
    }
  };

  window.reactivarUsuario = async function(id) {
    if (!confirm('¿Deseas restaurar el acceso para esta cuenta?')) return;

    try {
      const r = await fetch(`/api/admin/usuarios/${id}/reactivar`, {
        method: 'POST',
        headers: H
      });
      const d = await r.json();
      if (!r.ok) return alert(d.error || 'No se pudo reactivar');
      cargarTodo();
    } catch (e) {
      console.error(e);
    }
  };


  // Desplazar el contenedor de contenido, también al repetir una pestaña.
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


  async function cargarSitios() {
    try {
      const r = await fetch('/api/admin/sitios-fuentes', { headers: H });
      if (!r.ok) return;
      const datos = await r.json();
      document.getElementById('badge-sitios').textContent = `${datos.length} nodos ubicados`;
      
      // Asume que tienes un <tbody> con id="filas-sitios"
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
      
      // Asume que tienes un <tbody> con id="filas-parametros"
      const tb = document.getElementById('filas-parametros');
      if(!tb) return;

      tb.innerHTML = '';
      datos.forEach(d => {
        const valor = d.ultima_medicion != null ? parseFloat(d.ultima_medicion).toFixed(2) : 'Sin datos';
        tb.innerHTML += `
          <tr>
            <td class="fw-bold">${d.parametro}</td>
            <td>${d.unidad}</td>
            <td>${d.origen === 'simulado' ? 'Simulado · Python' : 'Real · Sensor físico'}</td>
            <td class="${d.ultima_medicion != null ? 'text-success fw-bold' : 'text-muted'}">${valor}<small class="d-block text-secondary">${d.ultima_fecha ? new Date(d.ultima_fecha).toLocaleString("es-BO", { timeZone: "America/La_Paz" }) : ""}</small></td>
          </tr>
        `;
      });
    } catch (e) { console.error(e); }
  }

  init();
});