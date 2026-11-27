# Paso 1: entrada BME680 y modelo ML

Se conserva el contrato y el catálogo existente del BME680: `TEMP` (°C),
`HUM` (%), `PRES` (hPa) y `GAS` (ohm). No requiere migraciones, tablas,
unidades ni variables nuevas. No registra ni modifica sensores en la BD.
El sensor y sus cuatro variables deben estar configurados previamente.

## Lectura indicada

| Dato del sensor | Entrada al proyecto |
| --- | --- |
| Temperature = 26.47 °C | TEMP = 26.47 |
| Pressure = 969.35 hPa | PRES = 969.35 |
| Humidity = 68.98 % | HUM = 68.98 |
| Gas = 68.14 kΩ | GAS = 68140 ohm |
| Approx. Altitude = 372.00 m | altitudAproximadaM = 372.00 |

La API recibe JSON, no el texto del monitor serial. En `POST /api/lecturas`
y en cada muestra de `POST /api/lecturas/lote` se puede añadir
`"altitudAproximadaM": 372.00` junto a `sensorId`, `idMuestra`, `medidoEn`
y `lecturas`. Cada lectura sigue usando su `unidadId` real del catálogo.
No enviar `68.14` como GAS con una unidad ohm: sería mil veces menor.
El firmware ya obtiene la resistencia de Adafruit en ohmios, sin conversión.

La altitud es opcional para aceptar firmware y muestras anteriores. Solo
se admite para BME680, entre -1000 y 20000 m. Se remite a la API ML como
`altitud_aproximada_m` y se conserva en el JSON `evidencia` que ya existe en
`evaluacion_muestra`; también se conserva en muestras en cuarentena.
No se añade a `lectura_original` ni a las columnas de los detectores.

El firmware calcula la altitud desde la presión de la muestra guardada,
sin cambiar el formato de su buffer offline. Usa 1013.25 hPa de presión
al nivel del mar, ajustable mediante `PRESION_NIVEL_MAR_HPA` en `config.h`.
Es una estimación dependiente de esa referencia, no una medición
independiente; puede diferir del valor mostrado por otro sketch.
Al cambiar esa referencia, enviar antes las muestras pendientes del buffer.

## Recorrido por ML

Las cuatro mediciones conservan el flujo .NET → `/api/v2/modelos/muestra`
→ detector por nodo/sensor/perfil. La API ML valida también los rangos
de temperatura y presión del BME680. La altitud se valida y se devuelve
como `derivada_no_evaluada_por_detector`: no se afirma que el modelo la
haya aprendido. Un sensor sin detector activo sigue devolviendo
`sin_modelo`; aceptar datos no implica que ya esté entrenado.

El ciclo de preparación incorpora la referencia histórica meteorológica
de Open-Meteo para el BME680. Empareja horas UTC de TEMP, HUM y PRES con
`temperature_2m`, `relative_humidity_2m` y `surface_pressure`, respectivamente.
Estos pares alimentan la evaluación de calibración ya existente.
Se usa presión superficial, no presión reducida al nivel del mar.
La comparación se realiza al preparar/evaluar el modelo, no mediante una
consulta meteorológica nueva por cada captura.

Open-Meteo no proporciona resistencia de gas en ohmios ni una referencia
equivalente a la altitud barométrica del sketch. GAS participa en el
detector multivariable del sensor; su calibración queda sin pares de
referencia. No se convierte GAS a CO, PM ni índices de calidad del aire.
Los datos ausentes del proveedor no se rellenan. Si falla la descarga,
el ciclo conserva el comportamiento opcional y prepara sin referencia;
no acredita una calibración que no se realizó.

Referencia de unidades y variables:
[Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api).

## Verificación y alcance

Pruebas locales sin PostgreSQL: contratos ASGI con la muestra indicada,
altitud opcional, DHT11 anterior, rangos físicos, detector BME680 entrenado
con datos temporales de prueba y referencia Open-Meteo simulada con unidades,
nulos y emparejamiento por hora. Compilación de la API .NET.

No se ejecuta el ciclo contra la BD ni se entrenan/activan modelos reales.
La integración con el dispositivo físico y la compilación Arduino quedan
pendientes de un entorno ESP32/Adafruit disponible. No se implementan aún
fusión entre nodos, nuevos gráficos, parámetros previstos ni dashboard.
