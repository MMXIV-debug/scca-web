# SCCA

Sistema de Monitoreo y Corrección de Calidad del Aire. Versión recibida el 16/11/2026.

## Aplicación web

Requiere Node.js (con fetch integrado), npm, .NET 10 SDK, PostgreSQL iniciado y el entorno Python .venv con requirements.txt instalado.

```powershell
npm ci
npm start
```

Con doble clic en "Iniciar SCCA.cmd" o ejecutando npm start se compila la API y se inician Python/ML, API, web y simulador. La web no depende de que Open-Meteo acepte una primera muestra: el simulador reintenta sus fallos sin derribar los demás servicios. En PowerShell, si npm.ps1 está bloqueado, ejecutar npm.cmd start o node iniciar.js. Mantener la ventana abierta y usar Ctrl+C para detener los procesos. Si hay una ejecución anterior ocupando los puertos, cerrarla primero. PostgreSQL debe estar funcionando antes de iniciar. Para arrancar únicamente la web, usar npm run start:web.

Configurar IOT_API_KEY en .env con la misma API_KEY del ESP32. Los puertos predeterminados son PORT=3000, API_PORT=5051 y ML_PORT=8000. Al cambiar API_PORT, actualizar también la URL del ESP32. Para omitir la apertura del navegador, usar npm start -- --sin-navegador.

Abrir http://localhost:3000 (o el puerto configurado). El archivo `.env` contiene `DATABASE_URL`, `JWT_SECRET` y, opcionalmente, `PORT`. Los archivos de entorno y secretos se configuran localmente y están excluidos de Git. No publicar credenciales ni respaldos de la base.

Antes de probar la versión con jerarquía de administradores, ejecutar una vez `db/03_jerarquia_admin.sql` sobre la base existente usando el propietario de las tablas. La migración agrega `admin_principal` y `administrador_desde`, y requiere una cuenta `admin` activa y aprobada. El iniciador comprueba la conexión a PostgreSQL, pero esta migración se aplica por separado.

Los scripts de `db/` son referencias de la base de datos. Revisarlos antes de ejecutarlos: no importarlos automáticamente sobre una base existente.

## Componentes Python

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

- `python/simulador.py` consulta Open-Meteo y escribe lecturas cada 15 minutos. Requiere sensor 1 y los catálogos esperados. Estima PM1 a partir de PM2.5 e incluye CO.
- `ml_engine/entrenador.py` sin argumentos ejecuta el ciclo semanal evaluado por compatibilidad con la tarea instalada. También admite `evaluar --dataset RUTA --proposito calibracion|pronostico|anomalias` y `revertir`. Solo activa candidatos aptos de demostración y conserva el anterior. Ver `docs/CORRECCIONES_2026-11-19.md`.
- `ml_engine/inferencia.py` expone una API FastAPI. Sus entradas deben reconciliarse con las características usadas al entrenar antes de considerar validada la predicción.
- `ml_engine/base_datos.py` utiliza `DATABASE_URL` del entorno o `.env` local para preparar datasets. El entrenamiento consume esos archivos sin acceder a la base.

Los archivos `.joblib` recibidos se conservan. Su presencia no acredita precisión ni validación ambiental.

## Organización

- `server.js`: rutas HTTP, autenticación y consultas del panel.
- `services/usuarioService.js`: operaciones de usuarios y auditoría.
- `services/validadorEstados.js`: transiciones permitidas.
- `services/correctorStrategy.js`: utilidad lineal legada. Los modelos complejos se ejecutan mediante la inferencia Python versionada; no se simulan con un factor.
- `services/eventosLectura.js`: emisor legado. Las alertas persistidas actuales se calculan con `alertasService.js` y `alertasAmbientalesService.js`; el visualizador las consulta por HTTP.
- `public/`: páginas, estilos y JavaScript del navegador.
- `ml_engine`: MOdelos guardados, conexion del ML a la base de datos, el entrenador del ML (Estado actual de esqueleto), integracion IoT que se conecta al ESP32

`npm.cmd test` ejecuta contratos Node y las pruebas Python. Las pruebas PostgreSQL se ejecutan únicamente contra bases locales temporales `scca_test_*`.

## Simulación e inicio completo

El iniciador ejecuta python/simulador.py con el mismo entorno del servidor. Selecciona el sensor activo de origen simulado que tenga CO, PM1, PM10 y PM25 y consulta sus unidades en PostgreSQL. Si hay varios candidatos, configurar SIMULADOR_SENSOR_ID en .env.

El simulador consulta Open-Meteo y estima PM1 como el 70 % de PM2.5. Envía las cuatro variables a POST /api/lecturas con la clave del proyecto. La API evalúa la muestra con ML y devuelve guardada o cuarentena. Se envía una muestra al arrancar y luego cada 900 segundos. SIMULADOR_INTERVALO_S permite modificar ese intervalo.

Los fallos del simulador se informan y se reintentan sin detener la web. Para iniciar sin simulador: `node iniciar.js --sin-simulador`. El panel de administrador y el de visualizador actualizan las mediciones cada 15 segundos mientras están visibles.

El ESP32 debe estar encendido y configurado para la red, dirección de la API e identificadores de esa base. PostgreSQL y los catálogos deben estar preparados, incluida la migración de administradores. El iniciador levanta la inferencia con los modelos guardados.

## Integración del 19/11

Consulta `docs/CORRECCIONES_2026-11-19.md` para migraciones 07–10, perfiles, trazabilidad, revisión etiquetada, políticas, alertas, reportes y automatización. En la base compartida esas migraciones ya están aplicadas. PM2.5 conserva los horizontes 1/3/6; los resultados reales siguen pendientes hasta disponer de datos y modelos aptos. No se fabrica una corrección ni se declara validación física por tener un joblib.
