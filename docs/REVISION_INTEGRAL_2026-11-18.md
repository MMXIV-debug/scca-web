# Revisión integral de SCCA — 18/11/2026

## Resultado

Los ocho puntos **no están terminados como flujo operativo completo**. Hay avances importantes respecto de `AUDITORIA_ML_2026-11-18.md`: preparación por perfil, evaluación temporal, registro local versionado, inferencia demo, persistencia opcional, decisiones de cuarentena y alertas técnicas. Las cuatro entradas administrativas existen, pero varias solo permiten consultar.

Esta revisión analiza y reproduce problemas; no corrige código funcional, no entrena modelos operacionales y no aplica migraciones en la nube.

## Backup

Se inició la copia antes de revisar el proyecto y terminó correctamente en:

`C:\Users\ykira\scca-web_backup\auditoria-20261118-233329`

La carpeta solicitada ya existía; se creó una subcarpeta para conservar lo anterior. Se copió el árbol completo, incluidos `.git`, `.venv`, `node_modules`, modelos y respaldos locales. Se comprobaron hashes SHA-256 coincidentes de `server.js`, `iniciar.js`, `package.json`, ambos `.joblib`, `LecturasController.cs` y `db/scca.sql`.

**La copia del proyecto no equivale a un respaldo de PostgreSQL en la nube.** No se ejecutó `pg_dump` sobre esa base.

## Estado de los ocho puntos

| Punto | Estado comprobado | Qué falta para darlo por terminado |
|---|---|---|
| 1. Auditar versión, entrenamiento, joblib, API, tablas y conexiones | Revisión local realizada; nube pendiente de conexión | Verificar esquema, permisos, datos y configuración desplegados contra la base real. |
| 2. Perfiles y trazabilidad | Parcial | `datasets.py` y evaluación v2 separan DHT11, BME680 y contaminantes simulados por nodo/sensor. La ingesta sigue con una bifurcación DHT11/detector legado; no persiste versión de detector por muestra ni procedencia histórica detallada. |
| 3. Anomalías y cuarentena | Parcial | Hay listado, restauración/descarte, motivo, auditoría y concurrencia. No existe detector aprobado por cada perfil; `evaluacion.py` deja anomalías pendiente y v2 no las ejecuta. |
| 4. Calibración de demostración | Implementada como mecanismo técnico, pendiente de demostración con datos reales suficientes | Hay referencia modelada, pares horarios, selección/evaluación, estados explícitos e inferencia separada. No se encontró registro local activo ni datasets generados en esta copia. Referencias actuales para contaminantes; no para calibrar DHT11/BME680. No acredita validación física. |
| 5. Pronósticos PM2.5 1/3/6 h | Parcial | El nuevo flujo soporta horizontes por hora real y ejecución individual. Falta generación periódica integrada, modelos activos/evidencia real y presentación completa del MVP. La ruta legacy de pronóstico continúa incompatible. Pronósticos BME680 siguen siendo alcance adicional por concretar. |
| 6. Alertas y reportes con periodos | Parcial | Hay inactividad por recepción y consulta/exportación de resultados demo. Faltan alertas ambientales/predictivas persistidas y políticas de cálculo por variable/perfil. El CSV descarga solo la página consultada. |
| 7. Cuatro pestañas del administrador | Navegación creada; funcionalidad parcial | Políticas es consulta, ML muestra versiones usadas en resultados persistidos, Alertas gestiona las técnicas y Reportes consulta resultados demo. No hay edición/versionado de políticas, gestión completa de candidatos/activos/reversión ni reportes completos por periodo. |
| 8. Automatizar entrenamiento y conservar anterior | Parcial, sin programador integrado | Evaluación, promoción demo atómica y reversión conservan versiones. El entrenador es CLI manual. No hay coordinación automática de preparación, evaluación y ejecución periódica en el proyecto; no se verificó una tarea externa de Windows. |

## Hallazgos prioritarios

### 1. P1 — Una pérdida de conexión del pool puede terminar Node

**Archivo:** `db/database.js:8`.

El `Pool` no tiene manejador de `error`. Una conexión inactiva que se termina emite ese evento fuera del `try/catch` de las rutas. Se reprodujo con el módulo real contra PostgreSQL temporal: se abrió una conexión, se devolvió al pool y otra conexión de prueba terminó ese backend. Node lanzó `Unhandled 'error' event` y salió con código **1**.

Con `npm start`, la salida inesperada de la web llama además a `detener(1)` y detiene los otros procesos iniciados por el lanzador. La reproducción verifica el efecto de una desconexión; no afirma que haya ocurrido ya en la nube.

**Corrección recomendada:** manejar errores del pool, registrar el incidente sin secretos y definir límites de conexión/consulta y recuperación. Probar reconexión tras caída sin matar el proceso.

### 2. P1 — Instalación desde SQL falla y deja incompatible la inhabilitación

**Archivos:** `db/scca.sql:251`, `db/02_auth.sql:9`, `services/usuarioService.js:155`.

`scca.sql` intenta agregar una restricción sobre `usuario.estado`, pero esa columna se agrega posteriormente en `02_auth.sql`. Se reprodujo la importación en una base vacía usando el esquema real, omitiendo únicamente sus instrucciones de creación/selección de base: termina con **column "estado" does not exist**.

Al aplicar después `02_auth.sql` y `03_jerarquia_admin.sql`, la restricción permite pendiente/aprobado/rechazado y excluye `inactivo`. Un UPDATE de un usuario de prueba a `inactivo` produjo **23514 / usuario_estado_check**. La operación del servicio usa exactamente ese estado.

**Corrección recomendada:** crear una migración posterior a autenticación que permita `inactivo`, ordenar el bootstrap y verificar una instalación limpia con todos los SQL. Si la nube ya recibió un arreglo manual, ese entorno podría funcionar; eso no resuelve la instalación reproducible del repositorio.

### 3. P1 — La primera muestra simulada puede impedir que arranque todo el sistema

**Archivo:** `iniciar.js:120`.

El lanzador exige que Open-Meteo, selección de sensor simulado, catálogos, ML y persistencia acepten una muestra antes de abrir la web. Si el simulador falla, lanza una excepción y termina API/ML. Incluso una instalación orientada a sensor físico depende de esa demostración.

**Corrección recomendada:** desacoplar simulador y disponibilidad básica; reportar estado degradado y reintentar sin derribar web/API. El comportamiento se comprobó por seguimiento del código; no se provocó una caída del servicio habitual.

### 4. P1 — BME680 no tiene un camino válido en la ingesta actual

**Archivo:** `backend/Scca.Api/Controllers/LecturasController.cs:77`.

Solo DHT11 real evita el detector legado. Todo otro modelo pasa a `/api/predict/muestra`. El `.joblib` inspeccionado exige **CO, PM1, PM10 y PM25**; el perfil BME680 define **TEMP, HUM, PRES y GAS**. Esa solicitud recibe rechazo por incompatibilidad, aunque la preparación y v2 reconozcan BME680.

**Corrección recomendada:** aplicar un contrato de ingreso por perfil y distinguir explícitamente validación física, anomalía ML y evaluación no disponible. No fabricar contaminantes para satisfacer el detector.

### 5. P2 — DHT11 acepta muestras parciales y declara falso sin evaluación ML

**Archivo:** `backend/Scca.Api/Controllers/LecturasController.cs:114`.

Se ejecutó la API real contra la base temporal con un DHT11 configurado para TEMP/HUM. Una muestra con **solo TEMP** respondió **201**, fue guardada y devolvió `esAnomalia=false` sin consultar ML. Las validaciones verifican las variables enviadas, pero no que esté presente todo el catálogo del perfil.

El servicio de restauración de cuarentena sí exige catálogo completo; los contratos no coinciden. Los conjuntos horarios pueden terminar incompletos y el falso puede interpretarse como evaluación que nunca ocurrió.

**Corrección recomendada:** exigir completitud por perfil o formalizar muestras parciales, y devolver un estado explícito para anomalías no evaluadas.

### 6. P2 — El pronóstico legacy sigue incompatible con su artefacto

**Archivo:** `ml_engine/inferencia.py:57`.

Se cargó el `.joblib` recibido: es `XGBRegressor` con **CO/PM1/PM10/PM25**. La ruta solo acepta modelos cuyo `feature_names_in_` sea `["valor_anterior"]`; por eso devuelve **422** con el artefacto incluido. El nuevo registro v2 no corrige automáticamente esa ruta ni sustituye ese archivo.

**Corrección recomendada:** definir un único contrato para consumidores, migrarlos al flujo versionado y comprobar los tres horizontes con modelos aptos. No marcar el MVP operativo solo porque el entrenador acepta `--horizonte`.

### 7. P2 — Políticas del panel y políticas ejecutadas son fuentes distintas

**Archivos:** `services/panelMlService.js:4`, `ml_engine/gobernanza.py:13`, `services/alertasService.js:89`.

El panel lee `politica_ml`, pero el entrenador utiliza una constante Python y las alertas usan variables de entorno. Consultar una política en la pantalla no demuestra que sea la aplicada al cálculo. El valor de inactividad predeterminado es **300 s**, mientras el simulador envía cada **900 s**: al habilitar el monitor con esos valores puede abrir y resolver alertas repetitivas durante actividad normal.

**Corrección recomendada:** asociar versión efectiva de política a cada cálculo y configurar recepción por sensor/perfil. La demostración puede mantener reglas provisionales si las identifica claramente.

### 8. P2 — Cuarentena no conserva la versión del detector que decidió

**Archivo:** `backend/Scca.Api/Controllers/LecturasController.cs:144`.

Se guarda payload y una causa genérica. El endpoint legado tampoco devuelve identificador/hash/versionado del detector. Tras sustituir un archivo y reiniciar, no se puede reconstruir con certeza qué modelo clasificó una muestra histórica. La auditoría de decisión humana sí existe; no reemplaza esa evidencia.

**Corrección recomendada:** guardar identidad de modelo, perfil, política, entradas y resultado de evaluación junto con la decisión automática.

### 9. P2 — Series y resumen mezclan fuentes y periodos insuficientemente identificados

**Archivo:** `server.js:341`, `server.js:368`, `server.js:386`.

El resumen usa el último PM2.5 global sin exigir antigüedad máxima ni seleccionar nodo/sensor/origen. Series y promedio semanal agrupan por variable, mezclando sensores y fuentes; no aplican el contrato de cobertura usado por ML. El resumen calcula su índice con una lectura instantánea, sin una ventana de cálculo explícita. Esto puede producir una pantalla coherente visualmente pero ajena al nodo o periodo esperado.

**Corrección recomendada:** seleccionar fuente/nodo/sensor, mostrar procedencia y antigüedad, y definir ventanas y cobertura de cada indicador. No equiparar automáticamente esa vista con alertas ambientales validadas.

### 10. P2 condicionado — HTML de catálogos se inserta sin escapar

**Archivos:** `public/js/dashboard.js:406`, `public/js/dashboard.js:432`, `public/js/visualizador.js:93`, `public/js/visualizador.js:118`.

Nombres de sitio, nodo, parámetros y unidades se interpolan en `innerHTML`. Si una importación o edición permite introducir HTML en esos campos, se ejecutaría en la sesión del visitante; el token está en localStorage. No se demostró un canal público de escritura de esos catálogos, por lo que no se afirma explotación remota anónima.

**Corrección recomendada:** usar nodos DOM y `textContent`, como ya hacen las nuevas pantallas de cuarentena y ML.

### 11. P3 — Código de corrección antiguo conserva errores y simulaciones

**Archivo:** `services/correctorStrategy.js:12`.

`pendiente || 1` cambia una pendiente válida de cero por uno. La estrategia compleja multiplica por un factor; no ejecuta Random Forest/XGBoost. No se encontró integración de ese módulo con el flujo actual de ingesta: es un defecto latente, no evidencia de que hoy esté alterando mediciones.

**Corrección recomendada:** eliminar ambigüedad entre demostración y ejecución real, y usar valores predeterminados que respeten cero si se conserva el módulo.

## Pruebas ejecutadas

- **41/41 Python:** datasets, métricas, separación temporal, promoción/reversión, integridad y contratos ASGI.
- **.NET:** compilación correcta, cero errores y cero advertencias.
- **13 verificaciones PostgreSQL/.NET:** persistencia demo, concurrencia, idempotencia, datos tardíos e inmutabilidad.
- **17 solicitudes de cuarentena:** permisos, decisiones, lotes y concurrencia.
- **Alertas técnicas:** suite correcta sobre PostgreSQL aislado.
- **Pruebas adicionales:** crash del pool, importación SQL real, rechazo de `inactivo`, muestra DHT11 parcial y falso de anomalía sin ML.
- **Artefactos:** ambos joblib cargan; detector `IsolationForest` y pronosticador `XGBRegressor`, ambos con cuatro contaminantes.
- `npm test` sigue siendo el marcador inicial que termina con error; estas suites no están conectadas a un comando único de validación.

Los primeros intentos de Python dentro del sandbox fallaron por permisos temporales/bloqueo de asyncio. La repetición fuera del sandbox terminó correctamente; esos fallos iniciales no se atribuyen al programa. PostgreSQL de prueba escuchó solo en `127.0.0.1:55439`; las APIs/proveedores de prueba usaron puertos separados. Las tablas simplificadas de las suites existentes no detectaban el problema de las migraciones reales.

## Límites y siguiente orden de corrección

El usuario indicó que la base está en la nube y que la conexión se encuentra en `.env`. Se comprobó la raíz y se buscó recursivamente dentro del proyecto, también fuera del sandbox: **no se encontró ese archivo**. Tampoco se observaron las variables de conexión en el entorno de esta ejecución. `node iniciar.js --sin-navegador` terminó con `Falta DATABASE_URL en .env.` No se concluye por ello que la base en nube esté caída o que su esquema tenga los mismos defectos: falta su conexión para comprobarlo.

No se probó hardware físico, no se midió precisión ambiental ni se inspeccionó visualmente el navegador. No se crearon modelos sintéticos en el registro habitual ni se insertaron datos de prueba en la nube.

Orden propuesto: (1) evitar caída del pool y desacoplar simulador del arranque; (2) reparar y probar instalación/migraciones; (3) unificar ingesta por perfil y trazabilidad; (4) cerrar PM2.5 1/3/6 h mediante v2; (5) unificar políticas y periodos de alertas/reportes; (6) completar administración; (7) automatizar preparación/evaluación/promoción con observabilidad y recuperación.
