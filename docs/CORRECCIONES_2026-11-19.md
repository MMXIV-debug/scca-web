# Correcciones e integración — 19/11/2026

**Actualización posterior:** el modo con historial corto, la política 4 y los modelos de arranque activos se describen en [ARRANQUE_ML_2026-11-19.md](ARRANQUE_ML_2026-11-19.md). Las cifras de modelos pendientes y política 3 de este informe corresponden a la verificación previa a esa actualización.

## Resultado y límites

Se corrigieron los fallos de arranque, conexiones, contratos y gobierno ML detectados en la revisión. Se habilitaron las funciones verificadas en la base compartida. El programa conserva originales y distingue evaluación de demostración, ausencia de modelo, dependencia no disponible y datos insuficientes.

**No hay todavía un modelo nuevo apto con el historial real.** El ciclo prepara y evalúa candidatos; no fabrica datos, referencias, correcciones ni pronósticos para suplir esa carencia. Los modelos sintéticos de pruebas se generaron exclusivamente en carpetas y bases temporales locales. El detector legado de contaminantes se conserva como respaldo identificado y sin validación independiente.

## Respaldos y cambios desplegados

Antes de modificar la nube se guardó `C:\Users\ykira\scca-web_backup\antes-correcciones-20261119`:

- `base-antes.dump`: copia PostgreSQL en formato custom, 97408 bytes; índice de restauración verificado.
- `codigo-antes.zip`: código del commit anterior a las correcciones.
- `.env`: configuración anterior, conservada de forma local.

Continúan disponibles la copia completa `scca-web_backup\auditoria-20261118-233329` y la referencia anterior al pull fuera del repositorio. Estos respaldos contienen datos privados; no se publicaron.

Se aplicaron las migraciones 07–10. No se borraron lecturas, usuarios ni modelos anteriores. Las comprobaciones de ingesta enviaron muestras ordinarias del simulador, con evaluación y trazabilidad; no se insertaron datos sintéticos de pruebas en la nube. Las migraciones no cambiaron las 572 lecturas ni los 5 usuarios que había antes de las comprobaciones.

La política vigente es la **versión 3**. Conserva la demostración de PM2.5 autorizada por el propietario: **35,4 µg/m³ sobre las últimas 24 horas completas**, perfil de contaminantes simulados. Requiere la cobertura configurada y no se presenta como norma municipal ni como medición física calibrada. Los rangos del indicador PM2.5 se actualizaron según la [tabla informativa EPA de 2024](https://www.epa.gov/system/files/documents/2024-02/pm-naaqs-air-quality-index-fact-sheet.pdf). El indicador usa una ventana móvil explícita, no se presenta como NowCast ni reporte oficial.

## Cambios funcionales

### Disponibilidad

- El pool PostgreSQL maneja las desconexiones de clientes inactivos. La siguiente consulta abre una conexión válida; el error no termina Node.
- Las conexiones y consultas tienen límites de espera.
- El iniciador abre web y API sin exigir una primera inserción del simulador. Un error de Open-Meteo, del simulador o de ML no derriba los demás servicios. Se probó un sensor simulado inválido solo en el proceso de prueba: web/API siguieron disponibles.
- `node iniciar.js --sin-navegador --sin-simulador` permite comprobar disponibilidad sin iniciar capturas simuladas. El inicio habitual conserva la simulación cada 900 s.

### Ingesta, perfiles y trazabilidad

- DHT11: TEMP y HUM; BME680: TEMP, HUM, PRES y GAS; contaminantes simulados: CO, PM1, PM10 y PM25.
- Se exige el conjunto completo del perfil, catálogo y unidades compatibles, fecha con zona explícita, valores finitos y rangos físicos básicos. BME680 admite temperatura negativa; DHT11 mantiene su rango 0–50 °C.
- `evaluacion_muestra` conserva sensor, muestra, nodo, perfil, origen, fecha, unidades, estado ML y versión del detector. Sus registros son inmutables.
- `esAnomalia: null` significa **no evaluada**, nunca normal. Ante ML caído o bloqueado se conservan originales con el estado correspondiente; la espera de ML en ingesta está acotada a tres segundos.
- Los detectores versionados se seleccionan por nodo/sensor/perfil. Solo los contaminantes simulados pueden recurrir al detector legado. La respuesta incluye identidad y versión, verificadas por .NET.
- La cuarentena conserva la evidencia de evaluación. Los IDs de muestra del payload se guardan como texto para evitar pérdida de precisión en JavaScript; se admiten también los payloads numéricos antiguos válidos.

### Anomalías y revisión

El administrador puede distinguir lectura normal, episodio ambiental real, fallo de sensor confirmado, dato inválido o muestra sin etiqueta para entrenamiento. La clasificación debe ser compatible con restaurar/descartar y queda auditada junto con el motivo. No se deduce que todo descarte sea un fallo. No se elimina el payload.

El preparador exporta etiquetas humanas compatibles, con unidad y fecha verificadas. El entrenador Isolation Forest ajusta con originales válidos anteriores al corte temporal y se evalúa sobre revisiones posteriores. No usa RMSE para aprobar anomalías. Se registran precisión, recall, falsos positivos y matriz de clasificación; se compara contra el vigente sobre las mismas filas y no se reutiliza una prueba consumida.

Criterios provisionales de demostración, visibles/editables en Políticas: 200 muestras distintas para ajuste, 7 días de historial, al menos 50 normales y 20 fallos revisados en prueba, precisión ≥90%, recall ≥90% y falsos positivos ≤5%. Quedan copiados en cada informe. Las revisiones de cuarentena pueden tener sesgo de selección: estos resultados no constituyen una estimación independiente de precisión operacional.

Sin etiquetas o historial suficientes, el candidato queda pendiente. Si confunde episodios legítimos con fallos, se rechaza. Un candidato apto de demostración puede activarse en el registro local y se conserva el anterior. No se fuerza ningún modelo operacional.

### Calibración y pronósticos

- Continúan la referencia Open-Meteo de demostración, los pares horarios sin interpolación y la separación de resultados respecto de originales.
- Se comprueban unidades del dataset y cobertura temporal del periodo, además del mínimo de pares y duración. Tener 540 pares dispersos en 60 días no sustituye la cobertura mínima del periodo.
- Los modelos conservan división temporal, métricas, integridad SHA-256, criterios de aceptación y comparación contra vigente. No se reentrenan con la prueba final ni se reutiliza una prueba consumida.
- El MVP automático genera candidatos y resultados de PM2.5 a **1, 3 y 6 horas**. No se añadieron pronósticos propios del BME680.
- El trabajador consulta los modelos activos y calcula la última hora cerrada cada cinco minutos. Los reintentos son idempotentes; un dato tardío que modifica la entrada conserva también el resultado anterior.
- Las antiguas rutas univariantes `/api/predict/forecast` y `/api/predict/anomaly` están retiradas con HTTP 410 e instrucciones de migración. No tenían un contrato compatible con los artefactos incluidos. El panel utiliza la evaluación versionada; la ingesta utiliza el endpoint protegido por perfil.
- El helper Strategy respeta una pendiente cero y rechaza parámetros no finitos. Ya no simula Random Forest/XGBoost mediante un factor: estos algoritmos se ejecutan en Python.

### Alertas, periodos y vistas

- La inactividad usa la mayor espera entre el mínimo de política y el intervalo del sensor multiplicado por el margen. Para el simulador de 900 s, el margen 2 implica 1800 s; no produce una alerta por cada intervalo normal de envío.
- Las reglas ambientales promedian primero por intervalo y luego por hora, y requieren cobertura por hora y por periodo. Sin cobertura suficiente no se crea ni se resuelve una alerta afirmando recuperación.
- Las reglas predictivas son configurables por horizonte; solo utilizan un resultado de demostración vigente, no expirado y de un modelo activo verificable. Quedan sin activar hasta que se configure un umbral predictivo.
- Se evitan duplicados y se auditan creación, atención y resolución. Un pronóstico expirado o una regla retirada se resuelven con ese motivo, sin atribuir recuperación ambiental.
- Las series y medias semanales separan sensores, nodos y orígenes, usan horas cerradas y representan huecos explícitos. El resumen indica sensor, fuente, antigüedad y cobertura. Ya no calcula el índice a partir de la última lectura instantánea global.
- Se escaparon los textos de catálogos y se corrigió el conteo de nodos cuando un nodo tiene varios sensores.

### Administración

Todos los módulos se presentan dentro de `dashboard.html`, después de Parámetros previstos, con las mismas tarjetas, tablas y tema de la dashboard. Los enlaces laterales desplazan el contenedor hasta cada sección; Políticas, Revisión de cuarentena, Machine Learning, Alertas y Reportes ML tienen controles independientes. Las antiguas URLs redirigen a sus secciones y ya no tienen HTML separado. Se verificaron en navegador local la navegación, la ausencia de IDs duplicados, los filtros independientes, la carga de modelos y la consulta de reportes de 100 filas, sin errores en consola.

Políticas permite crear versiones con motivo, intervalos, periodos, reglas ambientales/predictivas y criterios de anomalías. Revalida al administrador dentro de la transacción y detecta versiones concurrentes.

Machine Learning muestra candidatos pendientes/rechazados/aptos, métricas, motivos y activos; permite solicitar evaluación, consultar una hora, calcular resultados horarios y revertir con motivo. No expone rutas ni archivos joblib al navegador. El cliente nunca recibe la clave IoT.

Alertas permite gestionar las intervenciones. Reportes ML filtra por sensor y periodo, pagina la consulta y exporta el periodo completo, hasta 10000 resultados; si se supera ese límite pide acortar el rango, sin truncarlo silenciosamente. Se probó una exportación de 140 filas con página visible de 100.

### Automatización

La tarea existente `SCCA_Entrenamiento_ML` sigue programada los lunes a las 10:00 de La Paz. Windows denegó modificar su definición; se conservó el XML anterior en `backups/tareas`. No se duplicó ni se afirmó haber cambiado la tarea.

Su llamada instalada, `python entrenador.py` desde `ml_engine`, ahora ejecuta el ciclo evaluado. Si resuelve Python global, el script reutiliza `.venv` antes de importar dependencias. Se probó la misma invocación y terminó con código 0; los ciclos quedaron registrados localmente.

El servidor también comprueba si falta la evaluación de la semana y la recupera al abrir el programa. Respeta el bloqueo del ciclo y limita los reintentos. Esto cubre un lunes perdido cuando el equipo estuvo apagado; no ejecuta trabajo con la computadora apagada.

`ml_engine/registro_modelos_demo` conserva versiones, pruebas consumidas, eventos, ciclos y datasets. Una promoción solo modifica la referencia activa después de evaluar y verificar integridad; conserva artefactos anteriores. El almacenamiento sigue siendo un registro local de demostración, no un coordinador multi-host.

## Uso y verificación

Inicio normal: `npm.cmd start` o `Iniciar SCCA.cmd`. En esta computadora quedaron habilitados los módulos probados en `.env`. La base compartida ya tiene las migraciones; no es necesario reimportar un respaldo para abrir el programa.

`npm.cmd test` ejecuta contratos Node y pruebas Python. Las suites PostgreSQL exigen explícitamente un host local, puerto y una base `scca_test_*`; no deben apuntarse a la nube. Para instalación nueva, aplicar el esquema base y luego 02, 03, 04, 05, 06, 07, 08, 09 y 10 en orden. `07_estado_usuarios.sql` corrige el bootstrap sin alterar cuentas.

Se verificaron: compilación .NET sin errores; pruebas de datasets/gobernanza/inferencia/anomalías; instalación SQL real y repetición de migraciones; recepción con ML caído o bloqueado; recuperación del pool; cuarentena con lotes y concurrencia; políticas, alertas con ventanas completas y modelo activo; exportación de más de una página; ciclo con referencia caída y datos insuficientes; login y edición de política desde navegador local. Las pruebas de interfaz usaron una base local aislada y nunca mostraron resultados sintéticos como datos de la nube.

Las comprobaciones autenticadas en nube devolvieron 200 para políticas, registro, operación, reportes, resumen, series, media semanal y alertas. La última evaluación del indicador revisada tenía 10/24 horas válidas, por lo que informó cobertura insuficiente. Los candidatos reales siguen pendientes. No se midió precisión ambiental real ni se probó hardware BME680.

### Cierre de verificación

- La última ejecución de `npm.cmd test` terminó correctamente: 49 pruebas Python y 4 Node. La ejecución restringida quedó bloqueada; se cerró exclusivamente ese proceso y se repitió la suite fuera de esa restricción, con resultado correcto.
- La compilación final .NET terminó con 0 errores y 0 advertencias. El arranque sin simulador conectó con la nube y abrió los tres servicios.
- Se repitieron las ocho consultas autenticadas principales: todas respondieron HTTP 200. Se observaron política 3, 33 candidatos registrados y 0 modelos nuevos activos; el trabajador horario terminó sin errores ni resultados inventados.
- La inferencia directa, sin persistir muestras de prueba, devolvió `evaluado_legacy` con versión para contaminantes y `sin_modelo` para BME680.
- Anomalías se consulta como **perfil completo**. Tanto Python como .NET rechazan seleccionar una variable distinta de la identidad canónica del detector, evitando informar falsamente ausencia de modelo.

Los cambios quedan en el árbol de trabajo para revisión; no se creó un commit ni se publicaron credenciales. Para abrir el programa, ejecutar `npm.cmd start` desde la carpeta del proyecto.
