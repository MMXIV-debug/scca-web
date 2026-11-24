# Comprobación de ML durante una demostración

La aplicación muestra el resultado y PostgreSQL permite comprobar su persistencia.
Son verificaciones complementarias. Que una petición responda correctamente no
demuestra la precisión predictiva del modelo.

## Prueba funcional

1. Iniciar el proyecto con `node iniciar.js` y comprobar `/api/estado` en Swagger.
2. En Machine Learning, revisar el modelo en uso para el sensor, propósito y
   horizonte elegidos. Distinguir un algoritmo aprendido del respaldo por persistencia.
3. Seleccionar una hora cerrada, marcar Guardar y pulsar Evaluar hora. Registrar
   estado, valor, unidad, versión, fuente, periodo de entrada, periodo objetivo y
   `resultado_id`. Si faltan datos, explicar el estado devuelto en lugar de tomarlo
   como un pronóstico correcto. La consulta de anomalías de este formulario devuelve
   el estado del detector; la detección se realiza sobre muestras, no medias horarias.
4. Abrir Reportes ML para ese sensor y periodo y encontrar el resultado.
5. Comprobar el mismo identificador en PostgreSQL con la consulta siguiente.
6. Repetir la solicitud con la misma entrada y versión. Debe conservarse el mismo
   registro; si el proveedor revisa su entrada, puede generarse otro resultado.

```sql
-- Sustituir 632 por el resultado_id que devuelva la evaluación.
SELECT r.id, v.sensor_id, v.proposito, v.horizonte_h,
       v.version, v.metadatos->>'algoritmo' AS algoritmo,
       r.periodo_inicio, r.periodo_fin,
       r.resultado->>'estado' AS estado,
       r.resultado->>'valor' AS valor,
       r.resultado->>'unidad' AS unidad,
       r.resultado->>'objetivo_inicio' AS objetivo_inicio,
       r.resultado->>'objetivo_fin' AS objetivo_fin,
       r.entrada, r.resultado
FROM ml_demo_resultado r
JOIN ml_demo_version v ON v.version = r.version
WHERE r.id = 632;
```

## Pruebas automáticas

Ejecutar `npm test`. Incluye contratos Node y pruebas Python de preparación de
datos, evaluación temporal, anomalías y registro de modelos. Utiliza datos de
prueba; no equivale a verificar toda la instalación con el ESP32 conectado.

Para demostrar el recorrido físico, encender el ESP32 y comprobar que una muestra
nueva se recibe por la API, queda guardada o en cuarentena con una causa, y aparece
en el panel con fecha y sensor correctos. Las pruebas de errores, desconexión del
servicio ML y umbrales deben hacerse en una instalación de pruebas, sin insertar
mediciones ficticias en la base compartida.

## Comprobar la utilidad predictiva

Guardar los pronósticos antes del periodo objetivo y compararlos con observaciones
posteriores del mismo sensor, variable, unidad y periodo. Usar varios periodos no
utilizados para elegir el modelo, calcular MAE/RMSE y comparar con persistencia.
Mantener separadas las mediciones físicas y los datos modelados de Open-Meteo;
comparar dos valores de una misma fuente no acredita exactitud física independiente.
Revisar también cuántos periodos no pudieron evaluarse por falta de datos.

Para anomalías se necesitan casos revisados y etiquetas de normal/fallo para medir
precisión, recall y falsos positivos. Para calibración se necesita un instrumento
de referencia adecuado con mediciones emparejadas. No se puede garantizar un 100 %
general: se documentan los escenarios probados, resultados y límites pendientes.

## Por qué puede faltar el índice de calidad del aire

El resumen calcula un indicador de demostración a partir de PM2.5 y horas UTC
cerradas. Con la política del 75 % y el intervalo de 900 segundos:

- Una hora necesita al menos 3 de sus 4 intervalos con lecturas válidas.
- El resumen necesita al menos 18 horas válidas dentro de las últimas 24.
- Además necesita una lectura válida de PM2.5 de menos de una hora de antigüedad.

El panel muestra la última concentración disponible y su fecha aunque no pueda
calcular el índice. Esa concentración no es un AQI. Un pronóstico guardado tampoco
rellena las lecturas originales faltantes ni aumenta su cobertura.
