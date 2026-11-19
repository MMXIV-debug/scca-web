# Revisión después del pull — 18/11/2026

Esta revisión corresponde al commit `9841b803fe2ef6ae822ac16136a2775a507fd408` y actualiza las conclusiones de `REVISION_INTEGRAL_2026-11-18.md`. En esta ocasión sí se encontró el `.env` y se comprobó la base en nube. No se modificó código funcional, configuración, modelos, migraciones ni tareas programadas.

## Comparación y prueba de ejecución

La referencia anterior al pull quedó fuera del repositorio en `C:\Users\ykira\.codex\visualizations\2026\11\19\01a1f1dc-59e9-7321-b538-3d46c2e14a95\scca-antes-del-pull-90beb4ba`, correspondiente al commit `23eb49060abffc2c5a35671806c34af0cda4036b`. Conserva fuentes, configuración, modelos, respaldos locales y hashes; excluye dependencias y compilados regenerables.

El pull incorpora 45 archivos afectados en Git: preparación/evaluación/inferencia ML versionada, persistencia demo, revisión de cuarentena, alertas técnicas y navegación administrativa. El `.env`, el iniciador, el módulo de conexiones y el controlador de ingesta coinciden con la referencia anterior al pull. El SQL `db/sistema_calidad_aire.sql` dejó de estar en el árbol actual, pero se conserva en la referencia.

**El arranque normal funcionó.** Se ejecutó `node iniciar.js --sin-navegador`: compiló .NET, inició FastAPI, conectó PostgreSQL en nube, envió su primera muestra habitual del simulador y abrió el servidor web. La API devolvió **201 / guardada** para la muestra `1795060457088` del sensor 1: cuatro lecturas de origen simulado. No se generaron muestras sintéticas adicionales en la nube.

Se comprobaron:

| Comprobación | Resultado |
|---|---|
| Web `/` | 200 |
| API `/api/estado` | 200, PostgreSQL conectado |
| API `/api/modelo` | 200, detector disponible para CO/PM1/PM10/PM25 |
| Administración sin sesión | 401 |
| Calibración v2, sensor simulado y DHT11 | 200, `sin_modelo`, sin resultado inventado |
| Pronósticos v2 PM2.5 a 1/3/6 h | 200 en los tres, `sin_modelo` |
| Pronóstico legacy | 422, artefacto incompatible con entrada univariante |
| Compilación .NET | Cero errores y cero advertencias |
| Suite Python | 41/41 correctas |
| Persistencia PostgreSQL/.NET | 13 comprobaciones correctas en base temporal |
| Cuarentena | 17 solicitudes verificadas en base temporal |
| Alertas técnicas | Suite correcta en base temporal |

Los procesos iniciados para comprobar el arranque y PostgreSQL temporal se cerraron al terminar. Las consultas de inspección en nube usaron `BEGIN READ ONLY`; no se aplicó SQL de migración ni se activaron modelos. La única escritura intencional en nube fue la muestra ordinaria del propio iniciador.

## Lo comprobado en la nube

Las migraciones nuevas sí están desplegadas: existen `ml_demo_version`, `ml_demo_resultado`, `ux_cuarentena_decision` y `ux_alerta_tecnica_sensor_abierta`. Los triggers de protección de originales, auditoría y resultados demo están habilitados. La restricción de estados de usuario **sí permite `inactivo`**. Por tanto, el defecto del bootstrap SQL señalado anteriormente no prueba un bloqueo en esta base actual.

Instantánea de datos durante la revisión:

- Un nodo y dos sensores: Python Script simulado con CO/PM1/PM10/PM25 en µg/m³; DHT11 real con TEMP en °C y HUM en %.
- 572 lecturas originales: 134 por contaminante y 18 por variable del DHT11.
- Cero registros en políticas, modelos operacionales, validaciones, referencias, correcciones, cuarentena, alertas, versiones demo y resultados demo.
- Cuatro registros de auditoría.
- No hay un BME680 registrado en esta instantánea.

Los conteos vacíos no prueban por sí solos ausencia de funcionalidad. Aquí coinciden con la ausencia de registro local activo, las respuestas `sin_modelo` y las opciones de escritura deshabilitadas.

El simulador usa 900 s, pero el nodo tiene 60 s. No está configurado `Ml__IntervalosSensor__1`, necesario para evaluar ese simulador con un modelo activo. Bajo la hipótesis de 900 s para su historial, se contaron 29 horas cerradas con cobertura ≥75% por contaminante. El DHT11 no tiene ninguna hora con esa cobertura bajo el intervalo de 60 s. Esa estimación no certifica la frecuencia histórica: debe confirmarse antes de preparar datasets.

## Estado de los ocho puntos

| Punto | Estado actual | Pendiente concreto |
|---|---|---|
| 1. Auditoría de versión, artefactos, API, tablas y conexiones | Realizada para esta versión, incluida nube | La calidad predictiva y el hardware no quedan validados por comprobar disponibilidad. |
| 2. Perfiles y trazabilidad | Parcial | Preparación/v2 separan perfiles, nodo y sensor. La ingesta sigue usando DHT11 frente a detector legado; no conserva versión del detector por muestra. |
| 3. Anomalías y cuarentena | Parcial | Hay interfaz, decisiones, motivo y auditoría; la escritura está deshabilitada. Falta evaluación de anomalías por perfil. DHT11 no pasa por ML y BME680 sería incompatible con el detector actual. |
| 4. Calibración demo | Mecanismo implementado; no hay una calibración ejecutada y apta con estos datos | Hay referencia modelada, separación de resultados y estados explícitos. Faltan datos/pares suficientes, un modelo apto y demostración integrada. No equivale a calibración física validada. |
| 5. Pronósticos PM2.5 1/3/6 h | Parcial | Contrato y entrenador admiten los tres horizontes, pero ninguno tiene modelo activo. Falta ejecución periódica y consumo integrado. Mantener BME680 como alcance adicional por definir. |
| 6. Alertas y reportes con periodos | Parcial | Existen alertas por falta de recepción y consulta/exportación de resultados demo. Faltan alertas ambientales/predictivas persistidas, periodos por variable y reportes completos por rango. |
| 7. Cuatro pestañas administrativas | Navegación creada; funcionalidad parcial | Políticas solo consulta; ML lista versiones usadas en resultados; Alertas tiene gestión técnica; Reportes exporta una página. Falta administración completa de políticas/candidatos/modelos activos. |
| 8. Automatización, evaluación, activación y modelo anterior | Parcial y con incompatibilidad en la tarea instalada | Hay evaluación temporal, promoción demo y reversión. Existe tarea semanal, pero no está adaptada al nuevo entrenador. |

Las opciones efectivas `Ml__PersistenciaDemoHabilitada`, `CUARENTENA_REVISION_HABILITADA`, `ALERTAS_TECNICAS_HABILITADAS` y `ALERTAS_TECNICAS_AUTO` están deshabilitadas. No se cambiaron para la prueba.

## Hallazgos que requieren atención

### P1 — La tarea semanal quedó incompatible después del pull

Existe `SCCA_Entrenamiento_ML` y apunta a `C:\Users\ykira\scca-web`. Su última ejecución registrada fue el 16/11/2026 con resultado 0. La siguiente está programada para el **23/11/2026 a las 10:00, America/La_Paz**.

El comando instalado invoca `entrenador.py` sin el subcomando `evaluar`, sin `--dataset` y sin `--proposito`. La nueva CLI los exige. Se ejecutó únicamente el entrenador nuevo sin argumentos: terminó con **código 2 / falta comando**, antes de entrenar o escribir modelos. El éxito de la tarea del día 16 corresponde a una versión anterior y no acredita compatibilidad con el pull.

No se ejecutó ni modificó la tarea. Necesita un flujo de preparación/evaluación por perfil y propósito que conserve el vigente cuando los datos sean insuficientes. No basta con añadir cualquier dataset para forzar entrenamiento: el historial revisado no cumple los mínimos de evaluación de 540 pares y 30 días.

### P1 — Se mantiene el fallo capaz de terminar la web al perder una conexión

`db/database.js:8` crea un pool sin manejador para el evento `error`. Ese archivo es idéntico al de la revisión anterior, donde la desconexión de un backend temporal reprodujo `Unhandled 'error' event` y salida de Node con código 1. No se terminó ninguna conexión de la nube para repetirlo.

Además, el iniciador detiene sus demás hijos cuando la web termina inesperadamente. Conviene corregir el manejo de errores del pool y comprobar reconexión con PostgreSQL temporal antes de considerar robusto el funcionamiento continuo.

### P1 — El inicio continúa dependiendo del simulador y de Open-Meteo

`iniciar.js:120` detiene API/ML si falla la primera muestra del simulador. Hoy pasó, pero una falta de Internet, proveedor indisponible o catálogo incorrecto puede impedir iniciar la web aunque la captura física esté disponible. Es un riesgo previo al pull que permanece sin cambios.

### P2 — El pronóstico legacy falla de forma reproducible

`ml_engine/inferencia.py:57` exige un artefacto con `valor_anterior`, mientras `forecaster.joblib` conserva CO/PM1/PM10/PM25. La solicitud real devolvió **422**. El registro v2 no sustituye ese artefacto ni corrige automáticamente los consumidores antiguos. En v2, los tres horizontes responden correctamente que no tienen modelo.

### P2 — Ingesta, anomalías y catálogo no comparten el contrato de perfiles

`LecturasController.cs:77` solo exceptúa al DHT11 real del detector multivariante de contaminantes. Un BME680 enviado con TEMP/HUM/PRES/GAS no tiene camino compatible; no se insertó uno de prueba en nube.

El mismo controlador inicializa `esAnomalia=false` y acepta un subconjunto del catálogo DHT11. En la revisión anterior se reprodujo una muestra solo TEMP con 201 y falso sin evaluar ML; el controlador es idéntico después del pull. El restaurador de cuarentena, en cambio, exige catálogo completo. Hay que distinguir “evaluado normal” de “no evaluado” y decidir explícitamente si se admiten muestras parciales.

### P2 — Sin trazabilidad del modelo de anomalías por muestra

La cuarentena de ingesta conserva payload y causa genérica, pero no versión/hash del detector ni versión efectiva de política. El nuevo registro versionado sirve a v2; no se aplica automáticamente a esa decisión de la ingesta.

### P2 — Políticas y periodos siguen separados entre módulos

El panel consulta `politica_ml`, actualmente vacío; el entrenador usa `POLITICA` en Python y las alertas leen variables de entorno. La pantalla no representa una política única aplicada por todos los procesos. Si se habilitan alertas con el valor predeterminado de 300 s, el simulador de 900 s produciría episodios de falta de recepción durante operación normal. La plantilla propone 1800 s, pero no está aplicado en el `.env` actual y se necesitará política por sensor/perfil.

### P2 — Resumen y series pueden mezclar fuentes

`server.js:341` toma el último PM2.5 global sin seleccionar nodo/sensor/origen ni exigir antigüedad máxima. Series y media semanal agrupan por variable, con promedios de lecturas sin el contrato horario de cobertura ML. Con más sensores, el resultado puede no representar el lugar o fuente esperados. El índice del resumen tampoco muestra una ventana de cálculo explícita.

### P2 condicionado y P3 — Defectos heredados

- `dashboard.js:406/432` y `visualizador.js:93/118` interpolan catálogos en `innerHTML`. Si esos textos incorporan HTML por una importación/edición, puede ejecutarse en la sesión; no se demostró un canal público de explotación.
- `correctorStrategy.js:12` cambia pendiente 0 por 1 mediante `||`. Las estrategias complejas siguen siendo un factor de ejemplo. No se encontró integración actual del módulo con la ingesta; es un defecto latente.
- El bootstrap `scca.sql` sigue intentando crear una restricción de `usuario.estado` antes de que `02_auth.sql` cree la columna. Afecta instalaciones nuevas; **no se atribuye a la nube actual**, donde el estado `inactivo` está permitido.

## Alcance y siguiente trabajo

El resultado es: **el pull conserva el arranque y la captura, pero no termina los ocho puntos**. No se alteró un sistema que arranca para aparentar que tiene modelos aptos. No se entrenó con datos insuficientes, no se fabricaron referencias ni se insertaron datos sintéticos en la nube.

El orden recomendado es adaptar la tarea semanal y corregir la recuperación del pool/arranque; unificar contratos por perfil y trazabilidad; completar PM2.5 1/3/6 sobre el registro versionado; cerrar políticas, periodos de alertas/reportes y administración. La referencia física independiente y los pronósticos propios del BME680 siguen requiriendo definición de alcance.

Esta entrega es una auditoría y prueba de la versión descargada. No incluye cambios funcionales ni despliegue de correcciones. Evidencias de consultas y tarea en `docs/evidencias-post-pull/`, sin secretos.
