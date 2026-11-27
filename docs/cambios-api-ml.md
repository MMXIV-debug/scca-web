Para los sprints 1 y 2, esto es lo que todavía falta según el Excel y lo que revisamos del proyecto.

Del sprint 1 falta completar la gestión de nodos y sensores por el administrador: altas, mantenimiento, referencias y reemplazos, conservando el historial. También falta demostrar que un reemplazo desactiva el modelo anterior y que se rechazan duplicados y unidades incompatibles.

La política ML ya tiene versiones, pero falta completar la configuración de referencias y rangos. Además, existe una ruta que permite editar una política existente; hay que corregirla para que los cambios creen una nueva versión y no alteren la utilizada en evaluaciones anteriores.

La auditoría ya registra operaciones y tiene protecciones, pero la aplicación se conecta a PostgreSQL como superusuario. Falta configurar una cuenta con permisos limitados y comprobar que no pueda modificar, borrar ni vaciar los originales o la auditoría.

Del sprint 2 falta revisar el código del ESP32, el archivo .ino. Hay que completar la captura y el envío configurables, el almacenamiento de 24 horas sin conexión y el reenvío sin duplicados. Si mantienes el criterio del Excel, puede capturar cada minuto y enviar un lote cada 15 minutos: así conserva las 1.440 muestras exigidas durante un día sin red.

También falta integrar y probar físicamente el BME680: registrar sus variables y unidades, recibirlas por la API y comprobar su almacenamiento. Actualmente comprobamos el DHT11 y el simulador.

En la recepción de datos falta cerrar el tratamiento de lecturas inválidas. Algunos casos se rechazan directamente, mientras que el Excel pide conservarlos en cuarentena. Debemos definir cuáles corresponde rechazar y cuáles guardar para revisión, y demostrarlo con pruebas.

La prueba técnica de corrección ML 10 → 21 ya está implementada y comprobada, con el original intacto y el resultado separado. Para corregir mediciones reales todavía faltan datos emparejados con un instrumento de referencia calibrado, entrenamiento y evaluación con un periodo posterior separado. Hay que demostrar la mejora de RMSE de al menos 20 %, sin empeorar MAE ni sesgo absoluto, antes de activar esa corrección.

Finalmente, falta reunir las evidencias de aceptación de esos puntos. La estructura de la base, las consultas, la simulación, el recorrido API → PostgreSQL y la prueba controlada de corrección ya están comprobados; no hace falta rehacerlos.# Estado actual para el responsable de API

Actualización del 19/11/2026: las migraciones `04`–`10` ya fueron aplicadas en la base compartida, las pantallas administrativas viven integradas dentro de `dashboard.html` (Políticas versionadas, Revisión de cuarentena, Machine Learning, Alertas y Reportes ML), el modo de arranque ML y las pruebas integradas están documentados en [CORRECCIONES_2026-11-19.md](CORRECCIONES_2026-11-19.md), [ARRANQUE_ML_2026-11-19.md](ARRANQUE_ML_2026-11-19.md) y [arquitectura-apis-modelo-ml.md](arquitectura-apis-modelo-ml.md).

Actualización de revisión: 18/11/2026. Todas las entregas descritas abajo están publicadas en main hasta d0e6b59. Las secciones posteriores conservan la secuencia histórica; sus pendientes se interpretan según este resumen.

- .NET: POST /api/modelo/evaluar; GET /api/modelo/resultados. X-Api-Key de servicio. guardarResultado opcional y deshabilitado por defecto. Entrada por sensor/hora cerrada, identidad desde BD.
- Python interno: POST /api/v2/modelos/estado e /inferir. X-Api-Key, versión precondicional y perfiles; resultados de demostración, sin validación física.
- Node, JWT y solo Administrador: /api/admin/ml/politicas, /modelos y /reportes; /api/admin/cuarentena y /decisiones; /api/admin/alertas, /comprobar y /:id/atender. Consultas, decisiones auditadas y monitor técnico optativo.
- Migración04: dos tablas de resultados horarios demo. El usuario mostró una captura donde su compañero ya las creó; no se verificaron permisos completos de la cuenta de API en nube. El asistente no ejecutó SQL en nube.
- Migración05: índice único de decisiones de cuarentena. Migración06: índice único de alertas técnicas. Probadas localmente; aplicación en nube pendiente de autorización.
- Mantener escrituras deshabilitadas hasta preparar y aprobar el entorno: Ml__PersistenciaDemoHabilitada, CUARENTENA_REVISION_HABILITADA, ALERTAS_TECNICAS_HABILITADAS y ALERTAS_TECNICAS_AUTO. No compartir .env ni claves en frontend o Git.
- Cuatro secciones administrativas publicadas: Políticas (consulta), Machine Learning (versiones usadas), Alertas técnicas y Reportes ML (historial/CSV de página). Cuarentena tiene pantalla propia.
- Pendientes: edición/versionado de políticas desde UI, ejecución de entrenamiento desde panel, reentrenamiento semanal, alertas ambientales/predictivas, registro operacional completo, política de anomalías, validación independiente y pruebas visuales integradas. Las pestañas no significan que esas funciones estén terminadas.

---
# Bitácora de integración API ↔ ML

Se actualiza por cada entrega. Distingue cambios aplicados de propuestas; no sustituye la revisión del responsable de API.

## Entrega 1 — 18/11/2026: datasets y referencia

**Balance:** 0 endpoints modificados, 0 DTO modificados, 0 migraciones ejecutadas, 1 cambio de configuración interna aplicado y 3 asuntos de contrato pendientes. Publicación preparada en rama `Machine-Learning`, separada de main.

### Aplicado: ML-001 — conexión de Python a la misma base configurada

- Archivo: `ml_engine/base_datos.py`.
- Antes: conexión fija a PostgreSQL local, independiente del `.env` usado por el sistema.
- Ahora: lee `DATABASE_URL` del entorno o del `.env` raíz; el entorno tiene prioridad. Adapta esquema PostgreSQL a SQLAlchemy/psycopg2 y usa tiempo límite de conexión.
- API .NET y Node: no necesitan cambiar rutas ni cuerpos de solicitudes. Revisar que los procesos compartan el destino previsto; no copiar credenciales en los mensajes del equipo.
- También afecta al entrenador existente porque importa este módulo. Ese entrenador sigue siendo legado y no incorpora validación/promoción ni consume automáticamente los nuevos datasets. No ejecutarlo para activar modelos durante esta etapa.

### Aplicado: ML-002 — preparación sin cambios HTTP

- Nuevo comando `ml_engine/preparar_datasets.py` y módulos `datasets.py`, `referencias.py`.
- Lee sensor/nodo/sitio/catálogos/lecturas con parámetros SQL y transacción de solo lectura. No llama a POST /api/lecturas.
- Produce archivos separados por nodo, sensor y perfil; exporta cobertura, objetivos temporales y referencia modelada con procedencia y hashes.
- No escribe `referencia_lectura`, no necesita migraciones y no cambia los `.joblib` cargados por FastAPI. La referencia queda local en esta etapa.
- La API actual sigue recibiendo el mismo payload. El frontend y firmware no requieren cambios para esta entrega.

### Pendiente API-001 — perfil BME680 y catálogo

El preparador reserva el perfil BME680 con TEMP (°C), HUM (%), PRES (hPa), GAS (ohm). **PRES/GAS son convenciones locales propuestas**, no un contrato HTTP ya implantado ni un catálogo creado en nube. Confirmarlas con el responsable de API antes de registrar hardware/firmware. GAS representa resistencia, no concentración de VOC.

El endpoint ML actual sigue exigiendo las cuatro variables de contaminantes. Este trabajo NO habilita todavía la inferencia BME680 ni cambia el bypass del DHT11. El futuro selector de modelos necesitará perfil y una identidad confiable de sensor/nodo obtenida desde la base por la API.

### Pendiente API-002 — frecuencia histórica por sensor

Actualmente existe `nodo.intervalo_muestreo_s`; el simulador puede usar 900 s mientras el nodo declara 60 s. Para esta entrega se exige `--intervalo-s` explícito en perfiles simulados, sin tocar la base. A futuro se necesita frecuencia efectiva versionada por sensor para calcular cobertura histórica correctamente. No adoptar un intervalo nuevo sobre todo el historial sin conocer sus cambios.

### Pendiente API-003 — procedencia persistida

El catálogo distingue real/simulado, pero las lecturas no documentan fuente externa, hora del proveedor, consulta ni coordenada de grilla. El simulador actual usa Open-Meteo; una comparación contra la misma fuente no es independiente. Antes de persistir referencias en nube, acordar la migración para esa procedencia, naturaleza modelada, unidades y vínculo a sitio. Hasta entonces los archivos locales preservan esa información y marcan `validacion_independiente=false`.

## Pruebas de entrega

- 10 pruebas unitarias correctas: cobertura, huecos, reenvíos, calidad, ausencia de humedad, unidades de referencia, fechas con zona, separación de perfiles y horizontes reales.
- Consulta real de sensores 1 y 2 del nodo 1, rango UTC [17/11/2026,18/11/2026): 4 filas de contaminantes y 36 de DHT11, en carpetas separadas. Cero horas con cobertura suficiente en ese rango; no se rellenaron.
- Descarga Open-Meteo/CAMS exitosa con respuesta original y metadatos locales; no se fabricó PM1 de referencia.
- No se ejecutó entrenamiento, activación, migración ni escritura de lecturas para estas pruebas.

## Mensaje para el responsable de API

«Añadimos preparación ML por nodo/sensor/perfil y referencias Open-Meteo solo para demostración. No cambiamos endpoints, DTO ni tablas. Python ahora usa DATABASE_URL del entorno/.env en lugar de una conexión local fija. Tenemos pendientes de coordinar los códigos PRES/GAS del BME680, la frecuencia histórica por sensor y la procedencia de referencias. La inferencia por perfiles y la promoción de modelos todavía no están implementadas; el contrato de ingesta actual sigue igual.»

## Protección de secretos para publicación

Por instrucción del usuario, se excluyen todos los archivos de entorno (incluidos ejemplos), claves y respaldos. Se retiran del árbol versionado `.env`, `.env.example` y el respaldo `db/sistema_calidad_aire.sql`. Se conservan localmente. No se ha reescrito el historial remoto ni se han cambiado credenciales; archivos presentes en commits anteriores siguen existiendo allí. Los integrantes deben mantener su configuración local y compartir secretos por un canal privado. Las migraciones de esquema se conservan.

## Entrega 2 — 18/11/2026: evaluación, registro y promoción de demostración

**Balance acumulado HTTP:** 0 endpoints modificados, 0 DTO modificados, 0 migraciones ejecutadas. **Nuevo cambio de ejecución:** un contrato CLI sustituido. Entrega 2 local, todavía sin publicar.

### Aplicado ML-003 — entrenador con dataset explícito

`ml_engine/entrenador.py` ya no descarga todas las lecturas ni sobrescribe los joblib actuales. Requiere `evaluar --dataset RUTA --proposito calibracion|pronostico` (con variable y horizonte opcionales) o `revertir --clave CLAVE --motivo TEXTO`. Invocarlo sin argumentos finaliza con ayuda/error. **Actualizar la tarea programada antigua antes de reutilizarla**; no se modificó ninguna tarea del equipo ni el comando de arranque web.

### Aplicado ML-004 — registro local de demostración

`evaluacion.py` y `gobernanza.py` seleccionan mediante validación temporal interna, consumen una sola prueba final, comparan candidato/vigente sobre las mismas filas y mantienen estados/versiones/hashes/eventos. Solo apto_demo cambia la referencia activa del registro local; mantiene separado el ámbito operacional. Hay reversión explícita con motivo, validación de integridad y suspensión del reemplazado. El registro está excluido de Git y no es una tabla nueva en nube.

### Pendiente API-004 — conectar el registro con inferencia y PostgreSQL

Para la siguiente entrega coordinar identidad de nodo/sensor/perfil, propósito/variable/horizonte, versión del modelo y estado de evaluación. No asumir que existe ya un endpoint de activar/revertir ni cambiar el firmware. FastAPI sigue leyendo los artefactos actuales y la API .NET conserva su contrato.

La persistencia operacional necesita distinguir calibración, anomalías y pronóstico en modelo_ml, agregar los algoritmos correspondientes y guardar métricas/particiones/dataset/política en validacion_ml. No se ha aplicado SQL. El índice actual de un activo por sensor-variable no representa varios propósitos/horizontes.

### Pendiente ML-005 — políticas específicas de anomalías y pronóstico

Isolation Forest queda pendiente de etiquetas y política propia; RMSE no aprueba un detector. Pronóstico usa provisionalmente las reglas conservadoras de calibración en demostración, hasta acordar sus criterios específicos. No afirmar que un modelo de demostración es físicamente validado. Reversión manual implementada; supervisión y reversión automática por degradación pendientes.

### Evidencia

30 pruebas correctas, incluidos entrenamiento sintético temporal, promoción, rechazo por métricas, integridad, reutilización prohibida de prueba, guardado fallido y reversión. Evaluación del dataset real: pendiente por falta de pares, sin entrenar ni reemplazar modelos. Las pruebas sintéticas no escriben en PostgreSQL.

### Mensaje actualizado para el responsable de API

«El entrenador ahora consume datasets explícitos y guarda evaluación/versiones en un registro local de demostración. Cambió su comando, por lo que habrá que actualizar la tarea programada. No cambiamos endpoints, DTO ni base de datos; la API sigue usando sus modelos actuales. En el siguiente paso debemos coordinar cómo pasar sensor/perfil y devolver versión/estado del modelo, además de adaptar modelo_ml para propósito y horizonte. Los resultados de demostración no activan modelos operacionales.»


## Entrega 3 — 18/11/2026: consulta de inferencia por identidad

**Balance de esta entrega:** 1 endpoint nuevo .NET, 2 rutas internas nuevas Python, 1 DTO de solicitud nuevo, 0 cambios de payload del ESP32, 0 migraciones y 0 escrituras en PostgreSQL. Cambios locales, todavía sin publicar.

### Aplicado API-005 — POST /api/modelo/evaluar (.NET)

Nuevo archivo `backend/Scca.Api/Controllers/EvaluacionMlController.cs`. Recibe sensorId/proposito/variable/horizonteH/horaInicio con X-Api-Key. Obtiene nodo/perfil/unidades desde PostgreSQL; no confía en identidad o valores enviados por el cliente. Consulta el modelo y agrega una hora cerrada de lecturas válidas con cobertura mínima. Reutiliza el cliente ModeloMl y la configuración privada de autenticación existente. Las rutas /api/lecturas, /api/modelo y sus DTO anteriores no se modificaron.

Para datos simulados configurar la frecuencia histórica por sensor en Ml:IntervalosSensor:ID (por ejemplo 900 segundos si corresponde). El intervalo debe coincidir con el contrato del modelo. Consulta la guía `inferencia-versionada-ml.md` para estados HTTP y ejemplos.

### Aplicado API-006 — rutas internas /api/v2/modelos/estado e /inferir

`ml_engine/inferencia_registro.py` y registro en `inferencia.py`. Selección exacta por nodo/sensor/perfil/propósito/variable/horizonte, comprobación de contrato temporal/columnas/dominio e integridad del artefacto. Inferencia exige modelo_version para detectar cambios concurrentes (409), y períodos horarios explícitos. La promoción y reversión se reflejan sin reiniciar. Ambas rutas requieren X-Api-Key; Python lee Iot__ApiKey o IOT_API_KEY. No exponer esa clave al frontend.

Los nuevos modelos incluyen entrada_agregado_s e intervalo_s. Versiones sin esos campos se rechazan en la inferencia nueva, aunque sus rutas legacy no cambian. Un modelo de calibración no se trata como detector: es_anomalia=null significa no evaluado.

### Estado de pendientes anteriores

API-004 queda parcialmente resuelto: selección e inferencia del registro local ya disponibles. Persistencia operacional y migración de modelo_ml/validacion_ml siguen pendientes; no se inventaron equivalencias entre UUID local y modelo_id de PostgreSQL. API-001 (catálogo BME680), API-002 (histórico de frecuencia), API-003 (procedencia persistida) y ML-005 (evaluación de anomalías y política operacional de forecasting) siguen abiertos.

### Evidencia y mensaje para el compañero

41 pruebas Python y compilación .NET correctas. Pruebas HTTP de lectura con PostgreSQL comprobaron autenticación, perfil, sensor inexistente, datos insuficientes y compatibilidad de rutas legacy. Los modelos de prueba viven únicamente en procesos/directorios temporales y no se escribieron lecturas.

«Agregamos POST /api/modelo/evaluar para consultar modelos por sensor sobre horas cerradas. La ingesta ESP32 no cambia. El endpoint obtiene nodo/perfil de la BD y llama a nuevas rutas internas Python autenticadas. Devuelve versión y estados sin_modelo/datos_incompletos/fuera_dominio/evaluado_demo; no persiste resultados todavía. Para el simulador hay que configurar su frecuencia por sensor. El siguiente cambio a coordinar es la persistencia de correcciones/pronósticos y la migración del registro de modelos.»

## Entrega 4 — 18/11/2026: persistencia e historial de demostración

**Cambios de esta entrega:** una propiedad opcional añadida al DTO existente (`guardarResultado`, false por defecto), una ruta GET nueva, un campo interno Python nuevo (`modelo_metadatos`), una migración aditiva de dos tablas y una opción de configuración. Código publicado en main. Migración comprobada localmente, NO aplicada en nube.

### Aplicado API-007 — guardar resultado horario de demostración

`POST /api/modelo/evaluar` admite `guardarResultado:true` solo cuando `Ml:PersistenciaDemoHabilitada=true`. Después de evaluar, la API registra versión/metadatos y resultado en una transacción. Devuelve persistido/resultado_id. Reintentos idénticos conservan el ID; datos agregados distintos conservan un nuevo resultado sin borrar el anterior. Sin modelo o sin cobertura no escribe. No modifica ingesta IoT ni firmware.

Servicio: `backend/Scca.Api/Services/ResultadosMlStore.cs`. Python ahora adjunta metadatos de evaluación seleccionados, sin rutas ni archivos de modelo. No copiar claves al frontend.

### Aplicado API-008 — GET /api/modelo/resultados

Consulta autenticada X-Api-Key por sensorId, cursor despuesDe y limite (1..100). Devuelve items/siguiente_despues_de. Preparada para una futura integración de servidor con el panel, no para exponer credenciales en navegador.

### Migración propuesta DB-001

`db/04_resultados_ml_demo.sql`: ml_demo_version y ml_demo_resultado con FK a catálogo, inmutabilidad e idempotencia. Necesita ejecutarse por el responsable de BD antes de habilitar guardado en nube. Se eligieron tablas aditivas porque lectura_corregida representa muestras individuales, no promedios horarios; modelo_ml/validacion_ml operacionales conservan su diseño actual. No equivaler UUID local a modelo_id entero.

### Estado de pendientes y evidencia

Persistencia del historial horario demo implementada. Siguen pendientes la sincronización completa de versiones/políticas operacionales, trazabilidad por IDs de lectura, alertas, cuarentena administrativa y conexión al dashboard. No se registran todas las versiones pendientes/rechazadas de Python, solo las usadas en resultados persistidos.

13 verificaciones de integración .NET/PostgreSQL local correctas, 41 pruebas Python y compilación sin errores. No se aplicó SQL ni se insertaron datos en nube. Guía: docs/persistencia-ml-demo.md.

Mensaje para el compañero: «Agregamos guardarResultado opcional en /api/modelo/evaluar y GET /api/modelo/resultados. Para guardar, primero hay que aplicar 04_resultados_ml_demo.sql y habilitar Ml__PersistenciaDemoHabilitada. Son dos tablas nuevas de demostración; no tocamos lectura_original, lectura_corregida ni el contrato ESP32. El guardado es idempotente, conserva metadatos y resultados anteriores. La migración todavía no se aplicó a la base compartida.»

## Entrega 5 — revisión de cuarentena (local)

Balance: dos rutas Node nuevas, pantalla administrativa nueva, un índice adicional en auditoria_evento; cero tablas nuevas, cero cambios a .NET/firmware/ingesta. Publicada en main; migración no aplicada por el asistente en nube.

- GET /api/admin/cuarentena: filtros de estado y cursor por ID, solo Administrador con JWT vigente.
- POST /api/admin/cuarentena/decisiones: ids como texto, accion restaurar/descartar y motivo obligatorio. Lotes atómicos de hasta 50, reintentos idempotentes y auditoría con administrador/fecha/IDs de lecturas restauradas. No se borra la muestra en cuarentena.
- db/05_revision_cuarentena.sql añade índice único parcial para una decisión definitiva por muestra. Requiere revisión y aplicación local; no ejecutar en nube sin autorización.
- CUARENTENA_REVISION_HABILITADA=true habilita decisiones en Node; por defecto deshabilitadas. La lectura no requiere esa opción.
- Pantalla public/cuarentena.html + public/js/cuarentena.js; enlace únicamente en dashboard administrador. Se reutiliza Bearer JWT, nunca clave IoT del servidor.
- Restauración valida el contrato actual y conserva valores/fecha/idMuestra. No se confunde una restauración administrativa con calibración ML. Decisiones se conservan en auditoria_evento existente.

Prueba local: 17 solicitudes correctas con PostgreSQL temporal, concurrencia, roles, atomicidad, validación y paginación. No se modificó dashboard visualizador ni la BD en nube. Guía docs/cuarentena-admin.md. Alertas y otros paneles siguen pendientes.

## Entrega 6 — alertas técnicas (local)

Tres rutas Node nuevas: GET /api/admin/alertas, POST /api/admin/alertas/comprobar y POST /api/admin/alertas/:id/atender. JWT y administrador; sin cambios de .NET ni firmware. Monitor opcional cada 60 s con ALERTAS_TECNICAS_AUTO=true y ALERTAS_TECNICAS_HABILITADAS=true. Por defecto no escribe. ALERTAS_SIN_DATOS_S configura el umbral global: predeterminado 300, pero ajustar a la frecuencia real (simulador 900 s requiere más margen, p. ej. 1800). Política diferenciada por perfil/sensor pendiente.

Migración 06_alertas_tecnicas.sql: solo índice único parcial en alerta para evitar duplicados de interrupciones. No tablas nuevas y no aplicación en nube. Usa auditoria_evento existente para creación, atención y resolución. Revisa cada sensor, no actividad global del nodo; cuarentena recibida también cuenta como comunicación. No modifica estado administrativo de nodo.

Pantalla alertas.html/js con enlace admin; filtro, paginación, comprobación y atención con motivo. Alertas técnicas se resuelven por recepción restablecida o salida de supervisión. No implementa correo, banner visualizador, alertas EPA ni predicciones todavía. Guía docs/alertas-tecnicas.md. Pruebas locales de servicio/DB correctas; revisión visual pendiente. Esta entrega ya está publicada en main.

## Integración autorizada a main y cuatro pestañas administrativas

Por instrucción explícita del usuario se integró Machine-Learning en main, junto con los commits nuevos del equipo, en 95c018a. Se mantienen excluidos .env y respaldos. No se ejecutaron migraciones en nube.

Se agregan tres rutas Node JWT/Administrador de solo lectura: GET /api/admin/ml/politicas, /modelos y /reportes?sensorId=ID&despuesDe=ID. Políticas consulta politica_ml; modelos/reportes consultan tablas ml_demo_* de la migración04, con mensajes de error si no están disponibles. Modelos lista versiones usadas, no afirma cuál está activa. Reportes pagina hasta100 y permite descargar CSV de la página visible. No se envían claves IoT al navegador.

Dashboard administrador incorpora Políticas, Machine Learning, Alertas y Reportes ML. Se corrigió la navegación para interceptar solo enlaces internos #; los enlaces a otras páginas funcionan normalmente. Se conserva cuarentena. No se modificó dashboard visualizador.

Alcance: navegación y consulta; edición de políticas, ejecución de entrenamiento desde panel y alertas ambientales/predictivas siguen pendientes. Pantallas nuevas sin revisión visual automatizada. Sintaxis JS correcta y diez verificaciones HTTP con base simulada correctas (401/403/200 y filtro inválido). Sin acceso a nube.

## Aplicación aprobada de migraciones en nube — 18/11/2026

Con autorización explícita del usuario se ejecutaron correctamente 05_revision_cuarentena.sql y 06_alertas_tecnicas.sql. Se comprobaron los índices ux_cuarentena_decision y ux_alerta_tecnica_sensor_abierta con sus condiciones de unicidad. Esta actualización reemplaza las indicaciones históricas de aplicación pendiente de 05/06. No se habilitaron monitores ni flags de escritura de aplicación y no se insertaron datos de prueba en nube.

## Restauración de entorno por autorización explícita

El usuario autorizó volver a publicar el .env real en el repositorio privado para que el equipo recupere la conexión. Se mantiene .env.example como plantilla. Esta excepción reemplaza la exclusión anterior únicamente para .env; los demás secretos y respaldos siguen excluidos. Retirarlo después no elimina las copias del historial y requiere rotación para invalidar credenciales.

## Recepción y visualización BME680 — 27/11/2026

Los endpoints GET /api/admin/parametros y GET /api/visualizador/parametros incorporan identidad del sensor y nodo para las mediciones físicas. Presión y resistencia de gas se muestran por fuente BME680. ALT representa altitud aproximada en metros obtenida de evaluacion_muestra.evidencia.altitudAproximadaM, vinculada a la misma muestra de presión. Los gráficos horarios incluyen PRES, GAS y ALT y conservan los huecos y la identificación de la fuente.

Ambos paneles muestran los parámetros del BME680. Temperatura y humedad mantienen la condición de evaluación ML válida para la combinación entre nodos. La selección busca dos perfiles distintos en nodos distintos antes de usar una sola fuente disponible.

La recepción continúa utilizando POST /api/lecturas/lote de la API .NET existente. Para recibir un BME680 en una instalación se requiere registrar su nodo, sensor y variables TEMP, HUM, PRES y GAS, configurar las unidades correspondientes y usar esa identidad y la clave IoT de la instalación en el firmware. La plantilla está en arduino/bme680/scca_esp32/config.h. El ID 3 es un ejemplo que debe comprobarse en la base de destino.

La prueba física se realizó con una base PostgreSQL local. Se verificaron recepción de lotes, almacenamiento y gráficos de presión, gas y altitud en ambos roles. Pasaron 49 pruebas de contratos. Quedan pendientes la calibración con suficiente historial y la prueba física simultánea con DHT11. El detector entrenado para el laboratorio, sus datos y sus iniciadores permanecen locales. Esta entrega no aplica migraciones ni registra el nodo en la base compartida.
