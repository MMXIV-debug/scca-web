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

**Cambios de esta entrega:** una propiedad opcional añadida al DTO existente (`guardarResultado`, false por defecto), una ruta GET nueva, un campo interno Python nuevo (`modelo_metadatos`), una migración aditiva de dos tablas y una opción de configuración. Entrega preparada para publicación en `Machine-Learning`. Migración comprobada localmente, NO aplicada en nube.

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
