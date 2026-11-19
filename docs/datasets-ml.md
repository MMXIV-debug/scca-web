# Preparar datos ML por sensor y perfil

Este paso produce conjuntos locales reproducibles. No entrena, activa modelos, publica resultados ni cambia PostgreSQL. El entrenador legado todavía no consume estos artefactos: su integración pertenece al paso de evaluación y promoción.

## Ejecutar desde la raíz del proyecto

```powershell
.\.venv\Scripts\python.exe ml_engine/preparar_datasets.py --sensor-id 1 --desde 2026-11-17T00:00:00Z --hasta 2026-11-18T00:00:00Z --intervalo-s 900 --referencia-open-meteo
.\.venv\Scripts\python.exe ml_engine/preparar_datasets.py --sensor-id 2 --desde 2026-11-17T00:00:00Z --hasta 2026-11-18T00:00:00Z --intervalo-s 60
```

Los IDs son los comprobados en esta instalación, no constantes del código. Seleccionar fechas con registros y un intervalo que corresponda al historial real. Usar horas completas con zona horaria y un límite final pasado. El rango incluye desde y excluye hasta. Para simuladores el intervalo es obligatorio; para físicos usa el del nodo salvo indicación explícita. Si cambió históricamente la frecuencia, preparar períodos separados.

`DATABASE_URL` se toma del entorno o `.env` raíz. Los datos permanecen bajo `ml_engine/datasets_generados`, excluidos de Git. Cada ejecución crea una carpeta nueva nodo/sensor/perfil/ejecución. Puede usarse `--salida` para otro destino local.

## Archivos y significado

- `originales.csv`: filas extraídas de ese sensor y rango, incluidas las no válidas para conservar evidencia del filtro. No mezcla sensores.
- `horas.csv`: medias horarias UTC; huecos como celdas vacías. Solo calidad válida y valores finitos contribuyen.
- `completitud.csv`: fracción de intervalos ocupados por variable. Múltiples envíos dentro del mismo intervalo no aumentan cobertura ni peso.
- `objetivos_pm25.csv`: objetivo PM25 exactamente a 1/3/6 horas. No se desplazan filas sobre huecos. Solo para perfiles con PM25. No es un pronóstico generado.
- `referencia_respuesta.json`, `referencia_procedencia.json`, `referencia_horaria.csv`: respuesta original, procedencia y valores normalizados del proveedor.
- `pares_demostracion.csv`: coincidencia exacta de hora y variable con valores presentes en ambos lados. PM1 no tiene referencia en este adaptador.
- `manifiesto.json`: perfil, identidad, ubicación, unidades, fechas, frecuencia, política de completitud, conteos, limitaciones y SHA-256 de los archivos.

Una hora requiere al menos 75% de intervalos por variable (configurable mediante `--completitud`). Las variables se validan por separado; para entrenamiento multivariante se exige luego una fila completa de las variables del perfil. No se rellena, extrapola ni simula TEMP/HUM. No se infiere frecuencia observando huecos, porque confundiría pérdida de datos con menor frecuencia.

Los perfiles son DHT11 real; BME680 real; contaminantes simulados. El BME680 exige un catálogo completo TEMP/HUM/PRES/GAS con °C/%/hPa/ohm. PRES/GAS son códigos a coordinar con API, no una migración aplicada. No se detectó ni probó hardware BME680 en esta entrega.

## Referencia y límites

Open-Meteo Air Quality ofrece valores modelados CAMS. Se consulta la ubicación registrada en el sitio del nodo y se conserva la coordenada de grilla devuelta. Se mantienen tiempos del proveedor en UTC, unidades y fecha de consulta. La referencia cubre PM25/PM10/CO, no humedad/temperatura, PM1 ni resistencia del BME680. Fechas no disponibles o errores del proveedor detienen la preparación solicitada; no se sustituyen por ceros.

El simulador existente usa Open-Meteo. Compararlo con este proveedor puede resultar circular: todos los manifiestos marcan que no existe validación independiente ni calibración física validada. La referencia modelada histórica tampoco acredita una predicción emitida antes del hecho. No usar estos pares para afirmar mejora ambiental ni promover modelos de producción.

Fuente técnica: https://open-meteo.com/en/docs/air-quality-api — atribución Open-Meteo y Copernicus Atmosphere Monitoring Service (CAMS).

No se cambia automáticamente el entrenamiento ni el comando general de arranque. Descargar históricos cada vez que se abre la web no forma parte de este proceso. La integración futura debe consumir manifiestos y aplicar los criterios de evaluación antes de activar modelos.

## Verificación

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s ml_engine -p test_datasets.py -v
```

Pruebas locales sin red ni escrituras en base. La prueba de integración del 18/11 produjo conjuntos separados de sensores 1 y 2 y descargó la referencia. En el rango 17/11 UTC no hubo cobertura suficiente: cero horas completas es un resultado válido, no un fallo que deba ocultarse.
