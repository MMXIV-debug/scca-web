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

  } catch (err) {
    console.error(err);
    localStorage.removeItem('token');
    window.location.href = '/';
  }
});