# Auditoría ML SCCA — 18/11/2026

## Alcance y método
Versión local latest version/18-11-2026/scca-web/scca-web. Inspección de código, metadatos de artefactos existentes, endpoints locales de inferencia y conteos PostgreSQL en transacción READ ONLY. No se entrenaron modelos, no se enviaron muestras de prueba a la API de persistencia y no se modificó el esquema. Los conteos son una instantánea; el simulador previamente iniciado puede seguir insertando datos. Esta auditoría no acredita precisión científica ni aprobación municipal.

## Conclusión
La integración de captura y la inferencia de anomalías para cuatro contaminantes están implementadas. El ciclo completo de calibración, pronóstico, alertas y gobernanza ML está incompleto. Tener archivos joblib y un endpoint de disponibilidad exitoso no acredita ese ciclo.

## Hallazgos prioritarios
1. **Pronóstico incompatible (bloqueante).** ml_engine/entrenador.py entrena XGBoost con CO, PM1, PM10 y PM25; inferencia.py exige exclusivamente valor_anterior. El artefacto existente confirma cuatro entradas y POST /api/predict/forecast devuelve 422 con valor_pm25=12. Tampoco existen los horizontes completos 1/3/6 horas. shift(-4) desplaza filas, no garantiza una hora real.
2. **Sin perfiles de hardware (bloqueante).** integracion_iot.py usa un único detector. Su artefacto exige CO, PM1, PM10 y PM25. LecturasController.cs permite DHT11 real mediante límites TEMP/HUM, omitiendo ML; esAnomalia=false en ese camino no significa evaluación por Isolation Forest. El BME680 no tiene un perfil compatible implementado.
3. **Preparación de entrenamiento mezcla fuentes (alto).** entrenador.py consulta todas las lecturas sin separar nodo, sensor u origen. Pivotar por instante promedia coincidencias y dropna exige simultaneidad de todas las variables. Mezclar contaminantes y DHT11 con horarios diferentes puede eliminar las filas utilizables. El mínimo de cinco filas permite que quede una sola después del desplazamiento de cuatro.
4. **Calibración no implementada (bloqueante).** El bloque de calibración del entrenador está dentro de una cadena multilínea, sin ejecución. No se observó un flujo operativo de referencia_lectura a modelo y lectura_corregida. correctorStrategy.js contiene corrección lineal y una multiplicación de ejemplo para modelos complejos, sin integración demostrada al ingreso. Además, pendiente || 1 sustituye incorrectamente una pendiente cero.
5. **Sin validación ni promoción segura (alto).** El entrenamiento ajusta y sobrescribe archivos sin separación temporal, métricas de aceptación, comparación contra vigente, versionado registrado ni reversión. Guarda el detector antes de completar el pronóstico. El servidor carga los artefactos al arrancar y no tiene un mecanismo de activación coordinada. El esquema de referencia db/scca.sql solo permite regresion_lineal/random_forest y un activo por sensor-variable; deberá evolucionar para distinguir propósito/perfil.
6. **Alertas incompletas (alto).** El pronóstico devuelve una cadena de alerta; no registra un ciclo persistente. eventosLectura.js tiene SQL y sockets pendientes y no se encontró una emisión integrada desde la captura. No se debe interpretar una anomalía estadística como prueba de fallo: un episodio real de contaminación también puede ser atípico.
7. **Cuarentena parcial (alto).** La API puede guardar muestras clasificadas como anómalas. Faltan gestión administrativa de revisión/restauración/descarte, motivos, trazabilidad de decisión y vinculación con versión del detector. No se probó inserción de cuarentena durante esta auditoría.
8. **Interfaz administrativa pendiente.** dashboard.html enlaza Políticas a una tabla de parámetros y últimas mediciones. No equivale a edición de políticas. Faltan los flujos completos acordados de Machine Learning, Alertas y Reportes ML.
9. **Programación local no verificada.** La consulta schtasks falló con “La dirección de red no es válida”; no permite afirmar que la tarea exista o no. No se encontró un programador integrado en el código revisado. La tarea del equipo de Mateo no instala la tarea en otros equipos.

## Evidencia de ejecución
- Artefacto detector_anomalias.joblib: IsolationForest, entradas CO/PM1/PM10/PM25.
- Artefacto forecaster.joblib: XGBRegressor, mismas cuatro entradas.
- GET ML /api/modelo: 200, disponible=true, cuatro variables. Solo informa disponibilidad del detector.
- POST ML /api/predict/forecast, valor_pm25=12: 422, modelo incompatible con entrada univariante.
- POST ML /api/predict/anomaly, valor_pm25=12: 422, requiere cuatro variables. No confundir este endpoint legado con /api/predict/muestra, usado por la API de captura.
- PostgreSQL lectura_original: 512; CO/PM1/PM10/PM25: 119 cada una; TEMP/HUM: 18 cada una.
- PostgreSQL lectura_cuarentena, referencia_lectura, lectura_corregida, modelo_ml, validacion_ml y alerta: cero registros cada tabla. Cero filas por sí solo no prueba ausencia de funcionalidad; las conclusiones combinan datos y código.

## Requisitos que deben guiar la implementación
- Perfiles distintos para contaminantes simulados, DHT11 real y BME680 real; no fabricar temperatura/humedad cuando no hay sensor.
- Open-Meteo como referencia de demostración claramente identificada. Evitar entrenar y evaluar contra la misma fuente que alimenta el simulador. No presentar una corrección demostrativa como calibración física validada.
- Conservar originales; separar correcciones y asociar modelo/política. Sin modelo apto, mostrar original identificado como no corregido.
- Respetar criterios del documento original resumidos en MEMORIA_PROYECTO.md: agregación horaria con 75% de completitud, al menos 540 pares válidos, división temporal y prueba independiente, mejora mínima de RMSE de 20% contra original sin empeorar MAE/sesgo. Para reemplazo, además no empeorar el modelo vigente. Los criterios de calibración no deben trasladarse mecánicamente a Isolation Forest sin métricas apropiadas para esa tarea.
- Alertas web Sprint-02; correo Sprint-03. Solo Administrador y Visualizador. No bloquear automáticamente contaminación real solo porque sea estadísticamente inusual.

## Orden recomendado
1. Definir perfiles, unidades, tiempos, procedencia y contratos de ingreso/inferencia; corregir incompatibilidad de pronóstico.
2. Separar datasets por perfil/nodo y construir ventanas temporales; implementar referencia de demostración con trazabilidad.
3. Implementar evaluación, registro, promoción atómica y reversión antes de automatizar entrenamientos.
4. Integrar correcciones, pronósticos persistidos, alertas y cuarentena administrativa.
5. Completar las cuatro secciones administrativas y permisos.
6. Programar lunes 10:00 America/La_Paz y ejecutar pruebas integradas que incluyan falta de sensor, modelo no apto y servicio ML caído.

## Límites
No se ejecutó entrenamiento ni se midió calidad predictiva. No se confirmó el esquema completo de la nube contra db/scca.sql; se verificó existencia y conteos de las tablas indicadas. No se probó hardware BME680 ni se generaron alertas o cuarentenas de prueba. No se cambiaron código funcional, modelos, políticas ni datos como parte de la auditoría.
