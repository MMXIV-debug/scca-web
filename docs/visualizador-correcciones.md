# Correcciones y mejoras del panel de visualizador — 19/11/2026

Documento técnico de los cambios realizados en `public/visualizador.html`, `public/js/visualizador.js`, `public/css/styles.css`, `server.js` y `services/seriesService.js` para habilitar las tendencias horarias, la media semanal y las correcciones detectadas durante la verificación funcional y visual.

## Resultado y alcance

El panel de consulta (`/visualizador.html`) incluye un carrusel con tres gráficos de línea por tiempo, un cuadro lateral de media semanal de los últimos 7 días, avisos de alertas activas, separación explícita por nodo, sensor y origen, y soporte completo para alternar entre modo claro y modo oscuro sin pérdida de contraste.

- **Variables actuales:** `PM1`, `PM25`, `PM10`, `CO`, `TEMP` y `HUM`. No existe todavía la variable `VOC` ni `CO2` en el catálogo; la tercera diapositiva muestra `CO` con la insignia `VOC: próximamente` y la tabla semanal muestra `Próximamente` como marcador temporal.
- **Integridad de las series:** No se rellenan ni interpolan huecos cuando un sensor estuvo apagado o sin cobertura horaria suficiente; los vacíos se muestran explícitamente como pausas en la línea y como `Sin cobertura suficiente` en los indicadores que no alcanzan el umbral de la política vigente.

---

## API Node/Express y contrato de series (`server.js` y `services/seriesService.js`)

Todas las rutas del visualizador requieren sesión autenticada (`auth` mediante Bearer JWT). Los filtros opcionales `sensorId` y `nodoId` validan enteros positivos y responden `400` ante valores inválidos (`filtros` en `services/seriesService.js`).

- **`GET /api/visualizador/resumen`:**
  - Calcula el indicador ICA a partir de `PM25` sobre las últimas **24 horas UTC cerradas** mediante `seriesService.resumen(pool, calcularAQI_EPA, req.query)`, priorizando sensores reales sobre simulados cuando hay más de una fuente.
  - Exige el porcentaje de horas válidas definido en `politica_ml.completitud_min_pct` y al menos una lectura válida reciente (menor a `3600000` ms); de lo contrario informa `Sin cobertura suficiente` o `Datos desactualizados`.
  - Aplica los tramos de `calcularAQI_EPA` en `server.js` (basados en la tabla informativa EPA 2024 de PM2.5) e incluye `periodo_h`, `horas_validas`, `calibracion_fisica_validada: false` y `fuente` (`sensor_id`, `nodo_id`, `origen`).
- **`GET /api/visualizador/series?horas=24|168`:**
  - Acepta un parámetro `horas` acotado entre `1` y `168` (`parseInt(req.query.horas) || 24`).
  - **Corrección aplicada en `server.js`:** Se corrigió un error de sintaxis/referencia (`req.query,horas` → `req.query.horas`) que provocaba `ReferenceError` fuera del bloque `try` y devolvía HTTP `500` al consultar las series horarias.
  - En `seriesService.horas`: calcula promedios por slot del intervalo del sensor (`date_bin` sobre `politica_ml.configuracion.intervalos_sensor` o `nodo.intervalo_muestreo_s`) y los agrupa por hora UTC cerrada (`generate_series`). Las horas cuya cantidad de slots válidos no alcanza `3600 / intervalo * (completitud_min_pct / 100)` devuelven `valor: null` conservando la marca temporal y la `cobertura`.
- **`GET /api/visualizador/semanal`:**
  - Ejecuta `seriesService.semanal` sobre las últimas `168` horas cerradas, agrupando por `sensor_id/codigo` y devolviendo `promedio`, `minimo`, `maximo` y `horas_validas` sin mezclar sensores distintos.
- **`GET /api/visualizador/alertas`:**
  - Devuelve hasta `100` alertas en estado `abierta` o `atendida` ordenadas por `generada_en DESC` para informar interrupciones técnicas o umbrales vigentes en la parte superior del resumen.

---

## Pantalla y correcciones visuales

### 1. Carrusel de tendencias y media semanal (`public/visualizador.html` y `public/js/visualizador.js`)

Se cargan `bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js` (requerido por el componente Carousel) y `chart.js@4.4.3/dist/chart.umd.min.js`. Dentro de `#seccion-resumen` se dispuso una fila responsiva (`col-xl-8` para el carrusel y `col-xl-4` para la media semanal):

1. **Carrusel `#carrusel-graficos` (`data-bs-interval="false"`):**
   - **Diapositiva 1 (`#grafico-pm`):** `PM1`, `PM25` y `PM10` (`µg/m³`).
   - **Diapositiva 2 (`#grafico-clima`):** `Temperatura` (`°C`, eje izquierdo `y`) y `Humedad relativa` (`%`, eje derecho `y1`).
   - **Diapositiva 3 (`#grafico-gases`):** `CO` (`µg/m³`) más la insignia `.voc-placeholder` (`VOC: próximamente`).
   - **Rango de tiempo (`[data-horas]`):** Botones `24 h` y `7 días` (activo por defecto en `168` h para abarcar historiales dispersos). Al alternar, `cargarGraficos()` actualiza etiquetas y datasets sin destruir las instancias de Chart.js (`update('none')`).
   - **Trazado estricto de huecos (`spanGaps: false`):** No conecta tramos separados por horas en `null`; las horas faltantes de un sensor apagado o con cobertura menor al umbral quedan como cortes visibles.
   - **Redimensionamiento entre diapositivas:** El listener `slid.bs.carousel` llama a `resize()` sobre las instancias activas para que los gráficos creados en diapositivas ocultas adopten la altura correcta (`.grafico-alto { height: 320px }`).
2. **Cuadro de media semanal (`#filas-semanal`):**
   - Muestra `FILAS_SEMANAL` (`PM1`, `PM2.5`, `PM10`, `Temperatura`, `Humedad relativa`, `CO`, `VOC`). Por cada fuente devuelve promedio, unidad, rango `minimo – maximo`, `sensor_id`, `origen` y cantidad de `horas_validas`; para `VOC` indica `Próximamente` y para variables sin horas válidas en 7 días indica `Sin cobertura suficiente`.
3. **Avisos y seguridad en DOM:**
   - `cargarAlertas()` renderiza los avisos en `#avisos-alertas` usando `textContent`.
   - `cargarResumen()`, `cargarSitios()` y `cargarParametros()` utilizan `esc(...)` al interpolar textos de catálogos, y `badge-sitios` contabiliza nodos únicos mediante `Set` en lugar de contar filas duplicadas por sensor.
   - El refresco automático consulta los seis bloques cada `15000` ms únicamente cuando la pestaña está visible (`!document.hidden`) y sin solapar ejecuciones previas.

### 2. Contraste en modo oscuro (`public/css/styles.css` y `public/js/visualizador.js`)

En la inspección visual inicial con modo oscuro activado se detectaron dos defectos de contraste sobre el fondo verde oscuro (`#162a25`):

- La clase Bootstrap `.carousel-dark` invertía las flechas a negro (`filter: invert(1)`) y pintaba los indicadores superiores en `#000`, volviéndolos poco visibles.
- Chart.js dibujaba ejes, grilla y leyenda con sus colores predeterminados para fondo claro, y la serie `PM10` (`#0b3d2e`) se confundía con el fondo de la tarjeta.

**Corrección aplicada:**

- En `public/css/styles.css`, bajo `[data-bs-theme="dark"] #carrusel-graficos`, se anuló el filtro de las flechas (`filter: none`) y se fijó `#e4ede7` en `.carousel-indicators [data-bs-target]`.
- En `public/js/visualizador.js`:
  - Se agregó `colorOscuro` a cada serie en `CONFIG_GRAFICOS` (`#e6c65c` para `PM1`, `#5b9dff` para `PM2.5`, `#4fd18b` para `PM10`, `#ff6b7a` para `TEMP`, `#38bdf8` para `HUM` y `#a78bfa` para `CO`), junto con `esModoOscuro()`, `colorSerie(s)` y `paletaGrafico()` (`texto: '#cbd8cf'`, `grilla: 'rgba(228, 237, 231, 0.12)'` en oscuro; `texto: '#495057'`, `grilla: 'rgba(0, 0, 0, 0.08)'` en claro).
  - Un `MutationObserver` sobre el atributo `data-bs-theme` de `document.documentElement` invoca `aplicarTemaGraficos()` para actualizar en vivo ejes, grilla, leyenda y líneas al pulsar el botón de tema sin recargar la página.

### 3. Corrección relacionada en persistencia ML (`backend/Scca.Api/Services/ResultadosMlStore.cs`)

Durante las pruebas integradas con todos los servicios activos (`node iniciar.js --sin-navegador`), `EvaluacionMlController` registró `InvalidOperationException` al reintentar el guardado automático de pronósticos horarios con respaldo de Open-Meteo porque `entrada_fuente.procedencia.consultado_en` varía en cada consulta. Se actualizó la comparación JSONB en `ResultadosMlStore.Guardar` usando `#- '{entrada_fuente,procedencia,consultado_en}'` para preservar la idempotencia de los reintentos.

---

## Pruebas y verificación

- **Sintaxis y compilación:** `node --check public/js/visualizador.js` y `node --check server.js` finalizaron sin errores (`0`); la compilación de `backend/Scca.Api/Scca.Api.csproj` tras la corrección en `ResultadosMlStore.cs` terminó con `0` errores y `0` advertencias.
- **API autenticada (`prueba1` como Visualizador y `admin` como Administrador):**
  - `GET /api/visualizador/resumen` (`200`), `GET /api/visualizador/series?horas=24` (`200`, `144` filas), `GET /api/visualizador/series?horas=168` (`200`, `1008` filas), `GET /api/visualizador/series?horas=abc` (`200`, cae a `24` h), `GET /api/visualizador/series?horas=99999` (`200`, tope `168` h), `GET /api/visualizador/series?sensorId=-1` (`400`), `GET /api/visualizador/semanal` (`200`), `GET /api/visualizador/alertas` (`200`).
  - El usuario visualizador recibió `403` en todas las rutas exclusivas de administración probadas.
- **Verificación visual en Chrome (usuario `prueba1`, solo lectura):**
  - Se comprobaron las tarjetas del resumen, las tres diapositivas del carrusel, navegación por flechas e indicadores, cambio `24 h` / `7 días`, tabla de media semanal, tablas de `Sitios y fuentes` (`2` filas) y `Parámetros` (`6` filas), cierre de sesión y bloqueo con redirección a `/visualizador.html` al intentar abrir `/dashboard.html`.
  - Tras la corrección de modo oscuro y recarga limpia (`ignoreCache: true`), se validó el contraste de indicadores, flechas, ejes, leyenda y líneas en las tres diapositivas y su actualización en vivo al alternar claro ↔ oscuro, con `0` errores propios de la aplicación en consola ni fallos HTTP en `/api/...`.
- **Límites de la verificación:** Las pruebas del navegador fueron de solo lectura; el comportamiento de `VOC` permanece como marcador pendiente mientras no exista esa variable y fuente en la base de datos.
