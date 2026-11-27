# Paso 2: temperatura y humedad entre nodos

El visualizador recibe una medición de temperatura y una de humedad por
sitio. Cada una conserva los sensores, nodos, valores y porcentajes usados
en `componentes`. Los originales permanecen separados; no se guardan
promedios como si fueran lecturas del hardware.

Los sensores DHT11 y BME680 deben estar registrados como reales y activos,
en nodos distintos del mismo sitio. No se mezclan sitios. Este cambio no
crea ni mueve nodos o sensores y no modifica la base de datos.

## Selección y porcentajes

- Solo participan muestras con evaluación ML `evaluado_demo`, sin anomalía,
  con versión de modelo, identidad de nodo/perfil coincidente y lectura válida.
- Las mediciones actuales se consultan contra la última evaluación del
  sensor, aunque sea un rechazo. No se retrocede a una lectura buena anterior
  para ocultar un fallo reciente.
- Una lectura actual caduca después del mayor de 30 minutos o tres intervalos
  de captura. Los 30 minutos permiten dos ciclos del envío por lotes de
  15 minutos del firmware existente.
- Con ambos sensores utilizables: 50 % DHT11 y 50 % BME680. En las series
  horarias ese peso se ajusta por cobertura: 50 % de cobertura DHT11 y
  100 % BME680 dan participaciones de 33,33 % y 66,67 %, respectivamente.
- Si uno no aporta datos utilizables, el otro participa al 100 %. Si ninguno
  aporta datos utilizables, se devuelve `null` y se conserva el hueco.
- Si hay varios sensores del mismo modelo, se selecciona uno por cobertura,
  fecha y, en empate, identificador. No se aumenta el peso de un modelo por
  tener más sensores. Dos sensores del mismo nodo no forman una pareja.

Los porcentajes son ponderaciones, no porcentajes de exactitud. La ausencia
de anomalía tampoco demuestra que una lectura sea la verdad física. No se
inventa una medición de Open-Meteo cuando falta un sensor.

## APIs, ML y vista

El recorrido de ingesta sigue siendo hardware → API .NET → API ML, con
evaluación por sensor/perfil. La combinación consume esa evidencia existente.
No vuelve a ejecutar el detector ni dispara entrenamiento al abrir el gráfico.
Se conserva la preparación de referencias Open-Meteo del paso 1.

`/api/visualizador/parametros` entrega las mediciones combinadas.
`/api/visualizador/series` combina TEMP/HUM por hora y sitio; sus filtros por
sensor y nodo se aplican antes de combinar. La media semanal usa esa misma
serie. Los porcentajes y nodos aparecen en la tabla y en el detalle del gráfico.
La hora actual excluye una fuente cuya última evaluación fue rechazada o
cuyos datos son antiguos; las horas históricas conservan sus muestras válidas.

Un sensor con `sin_modelo`, `ml_no_disponible`, `respuesta_invalida` o
`dato_invalido` no aporta una medición presentada como evaluada. Por eso,
para la prueba física deben existir detectores activos para ambos sensores.

No se añaden los gráficos BME680 del paso 3, los parámetros previstos del
paso 4 ni los cambios al dashboard administrativo del paso 5.

## Verificación

Pruebas de combinación, respaldo, fallos simultáneos, ceros, rangos, unidades,
separación de sitios y nodos, cobertura, servicios y actualización del
visualizador con respuestas simuladas. Las dos consultas nuevas/adaptadas
se validaron con `EXPLAIN` en PostgreSQL dentro de una transacción `READ ONLY`.
No se ejecutaron migraciones ni escrituras sobre la BD.

La prueba con los dos dispositivos físicos queda pendiente para el final
de los cinco pasos, como se acordó.
