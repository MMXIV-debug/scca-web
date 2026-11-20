# Preparar el proyecto en otra computadora

El archivo `.env` real se conserva localmente y no se distribuye automáticamente con Git. Las dependencias, entornos virtuales y salidas compiladas se regeneran en cada equipo.

1. Descargar o actualizar `main`.
2. Ejecutar `Copy-Item .env.example .env` solo si todavía no existe `.env`.
3. Completar DATABASE_URL, JWT_SECRET e IOT_API_KEY con los datos privados entregados por el equipo. No ejecutar la plantilla con los valores de ejemplo. Si la contraseña contiene caracteres especiales, codificarlos correctamente en la URL PostgreSQL.
4. Instalar Node.js, Python 3.12 y .NET SDK10. Ejecutar `npm.cmd ci`.
5. Crear el entorno: `py -3.12 -m venv .venv`; instalar Python: `.\.venv\Scripts\python.exe -m pip install -r requirements.txt`.
6. Iniciar con `npm.cmd start` o con `Iniciar SCCA.cmd`.

## Instalación automática en Windows (`Iniciar SCCA.cmd` e `instalar.ps1`)

En una computadora Windows 10/11 limpia (sin Node.js, Python ni .NET instalados), puedes preparar todo y arrancar el sistema en un solo paso haciendo doble clic en `Iniciar SCCA.cmd` o ejecutando en PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\instalar.ps1
```

Qué realiza `instalar.ps1`:

1. Recarga el `PATH` del sistema/usuario y rutas estándar (`Actualizar-Path`) para detectar instalaciones recientes sin reiniciar la consola.
2. Verifica e instala mediante `winget` si faltan: **Node.js LTS** (`OpenJS.NodeJS.LTS`), **Python 3.12+** (`Python.Python.3.12`, evitando el alias de Microsoft Store en `WindowsApps`) y **.NET SDK 10.0** (`Microsoft.DotNet.SDK.10`).
3. Instala las dependencias de Node (`npm.cmd ci`, con respaldo `npm.cmd install`) si faltan `node_modules\pg` o `node_modules\express`.
4. Crea el entorno virtual `.venv` si no existe, comprueba que se importen los paquetes de `requirements.txt` y, si falta alguno, actualiza `pip` e instala `requirements.txt`.
5. Ejecuta `dotnet restore backend/Scca.Api/Scca.Api.csproj` si falta `backend\Scca.Api\obj\project.assets.json`.
6. Si no existe `.env`, copia `.env.example` (guardado en UTF-8 sin BOM); si `DATABASE_URL` falta o conserva el valor de ejemplo, la pide por consola, y genera claves aleatorias para `JWT_SECRET` e `IOT_API_KEY` si siguen con `REEMPLAZAR_POR_...`.
7. Si no existe `ml_engine\registro_modelos_demo\registro.json`, intenta generar el registro inicial ejecutando `.venv\Scripts\python.exe -u ml_engine\ciclo_automatico.py` (de forma no bloqueante si aún no hay conexión o datos suficientes).
8. Lanza `node iniciar.js` reenviando cualquier argumento recibido (por ejemplo `Iniciar SCCA.cmd --sin-navegador`). Con `-SoloInstalar` (`.\instalar.ps1 -SoloInstalar`), prepara el entorno sin abrir los servicios.

## Qué copiar y qué no copiar entre equipos

- **Conservar en la copia / repositorio:** `iniciar.js`, `server.js`, `instalar.ps1`, `Iniciar SCCA.cmd`, `package.json`, `package-lock.json`, `requirements.txt`, `.env.example` (o `.env` privado), `public/`, `services/`, `db/`, `backend/`, `python/` y `ml_engine/` (incluyendo `ml_engine/modelos_guardados/*.joblib`).
- **No copiar entre computadoras (se regeneran):** `node_modules/`, `.venv/`, `backend/Scca.Api/bin/`, `backend/Scca.Api/obj/`, `__pycache__/` y `ml_engine/registro_modelos_demo/`.

## Nota sobre la base compartida y configuración

La API .NET recibe su conexión desde el iniciador, que convierte DATABASE_URL a ConnectionStrings__Postgres. No es necesario publicar contraseñas en appsettings.json. Mantener iguales las claves del ESP32 y de la API.

Las migraciones 04–10 ya se confirmaron en la base compartida; no importar un respaldo ni recrear la base para abrir el proyecto. Comprobar el destino antes de aplicar cualquier SQL. Ver `CORRECCIONES_2026-11-19.md` para la configuración vigente y `ARRANQUE_ML_2026-11-19.md` para el modo de demostración activo. Las opciones que escriben resultados o ejecutan trabajo automático permanecen desactivadas en `.env.example` para un equipo nuevo.

Para Mateo: el propietario del entorno debe entregar por un canal privado las tres variables requeridas o una copia privada de `.env`. El código fuente, migraciones y archivos de dependencias están en Git; `.venv`, node_modules y bin no deben copiarse entre computadoras.
