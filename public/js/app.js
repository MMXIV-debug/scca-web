document.addEventListener('DOMContentLoaded', () => {
  const $ = id => document.getElementById(id);

  const alertBox = $('feedback-alert');
  const formLogin = $('form-login');
  const formRegister = $('form-register');
  const btnLogin = $('btn-login');
  const btnRegister = $('btn-register');

  const showMessage = (text, isSuccess) => {
    if (!alertBox) return;
    alertBox.textContent = text;
    alertBox.className = `alert text-center small mt-3 p-2 rounded-3 ${isSuccess ? 'alert-custom-success' : 'alert-custom-error'}`;
    alertBox.classList.remove('d-none');
  };

  const clearMessage = () => {
    if (!alertBox) return;
    alertBox.classList.add('d-none');
    alertBox.textContent = '';
  };

  const setButtonLoading = (btn, isLoading, defaultText) => {
    if (!btn) return;
    if (isLoading) {
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Procesando...`;
    } else {
      btn.disabled = false;
      btn.innerHTML = `<span>${defaultText}</span>`;
    }
  };

  // Limpiar mensajes al cambiar de pestaña
  document.querySelectorAll('button[data-bs-toggle="pill"]').forEach(tabBtn => {
    tabBtn.addEventListener('shown.bs.tab', clearMessage);
  });

  async function post(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return [response.ok, await response.json()];
  }

  // Evento Login
  if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearMessage();
      setButtonLoading(btnLogin, true, 'Entrar');

      try {
        const [ok, data] = await post('/api/login', {
          username: $('lu').value.trim(),
          password: $('lp').value
        });

        if (!ok) {
          showMessage(data.error || 'Credenciales incorrectas.', false);
          return;
        }

        localStorage.setItem('token', data.token);
        window.location.href = '/dashboard.html';
      } catch (err) {
        showMessage('No se pudo conectar con el servidor.', false);
      } finally {
        setButtonLoading(btnLogin, false, 'Entrar');
      }
    });
  }

  // Evento Registro
  if (formRegister) {
    formRegister.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearMessage();
      setButtonLoading(btnRegister, true, 'Solicitar acceso');

      try {
        const [ok, data] = await post('/api/register', {
          username: $('ru').value.trim(),
          nombre_completo: $('rn').value.trim(),
          email: $('re').value.trim(),
          password: $('rp').value,
          rol_solicitado: $('rr').value
        });

        showMessage(ok ? (data.mensaje || 'Registro enviado.') : (data.error || 'No se pudo registrar.'), ok);
        if (ok) formRegister.reset();
      } catch (err) {
        showMessage('No se pudo conectar con el servidor.', false);
      } finally {
        setButtonLoading(btnRegister, false, 'Solicitar acceso');
      }
    });
  }
});