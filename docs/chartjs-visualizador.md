# Uso y funcionamiento de Chart.js en el proyecto

Documentación técnica sobre la integración de `Chart.js` (`4.4.3`) en el panel de visualizador (`/visualizador.html`), desde la consulta horaria en PostgreSQL hasta el renderizado interactivo y la sincronización con el tema claro/oscuro.

## Integración en HTML y CSS (`public/visualizador.html` y `public/css/styles.css`)

`Chart.js` se carga desde CDN (`chart.js@4.4.3/dist/chart.umd.min.js`) junto con el bundle de Bootstrap `5.3.3` (`bootstrap.bundle.min.js`) antes de `js/visualizador.js`, dentro de `public/visualizador.html`.

Dentro de `#seccion-resumen`, el carrusel `#carrusel-graficos` (`data-bs-interval="false"`) contiene tres diapositivas (`.carousel-item`), cada una con un contenedor `.grafico-alto` y un `<canvas>`:

| Diapositiva | ID de `<canvas>` | Variables previstas | Observaciones visuales |
|---|---|---|---|
| 1 | `#grafico-pm` | `PM1`, `PM25`, `PM10` | Tres series sobre un eje izquierdo (`µg/m³`). |
| 2 | `#grafico-clima` | `TEMP`, `HUM` | Doble eje Y: izquierdo `y` (`°C`) y derecho `y1` (`%`). |
| 3 | `#grafico-gases` | `CO` (y `VOC` pendiente) | Muestra la insignia `.voc-placeholder` (`VOC: próximamente`). |

En `public/css/styles.css`, `.grafico-alto` fija `position: relative; height: 320px; padding: 0 2.5rem;` para darle un alto explícito al lienzo (`maintainAspectRatio: false`) y reservar espacio lateral para las flechas del carrusel sin tapar las etiquetas de los ejes.

---

## Flujo de datos extremo a extremo

1. **PostgreSQL → `services/seriesService.js` (`horas`):**
   - El frontend solicita `GET /api/visualizador/series?horas=24` o `?horas=168` (controlado por `horasGrafico`, inicializado en `168` para cubrir los últimos 7 días).
   - En `server.js`, el parámetro `horas` se acota al rango `1..168` y se valida con el middleware `auth`.
   - `seriesService.horas` agrupa primero las lecturas válidas (`l.calidad = 'valida'`) por slots del intervalo de muestreo de cada sensor (`date_bin` con `politica_ml.configuracion.intervalos_sensor` o `nodo.intervalo_muestreo_s`) y luego promedia esos slots por hora UTC cerrada mediante `generate_series`.
   - Si una hora no alcanza la cobertura mínima de la política (`3600.0 / intervalo * (completitud_min_pct / 100)`), la fila conserva `g.hora` pero devuelve `valor: null`.
2. **Eje X y agrupación en `public/js/visualizador.js` (`cargarGraficos`):**
   - Extrae y ordena las marcas temporales únicas (`const horas = [...new Set(filas.map(f => f.hora))].sort()`) y las formatea en hora local de Bolivia con `formatoHora(iso)` (`es-BO`, zona `America/La_Paz`, formato `dd/mm hh:mm` 24 h).
   - Indexa los valores por sensor y código (`porVariable[f.sensor_id + '/' + f.codigo][f.hora] = f.valor`) para no mezclar lecturas de distintos sensores o orígenes en una misma línea.

---

## Configuración declarativa (`CONFIG_GRAFICOS`) y opciones de trazado

`CONFIG_GRAFICOS` define en un solo arreglo los tres gráficos y sus series:

- Cada serie indica `codigo`, `etiqueta`, `color` (modo claro), `colorOscuro` (modo oscuro) y opcionalmente `eje` (`'y'` o `'y1'`).
- Para cada serie configurada, `cargarGraficos()` busca qué sensores aparecen en la respuesta (`filas.filter(f => f.codigo === s.codigo)`) y genera un dataset por sensor con la etiqueta `${s.etiqueta} · nodo ${f.nodo_id}, sensor ${f.sensor_id}, ${f.origen}`.

### Opciones principales de cada instancia `new Chart(...)`

| Opción | Valor | Función |
|---|---|---|
| `type` | `'line'` | Gráfico de líneas temporal. |
| `responsive` / `maintainAspectRatio` | `true` / `false` | Se adapta al ancho de la columna y respeta los `320px` de `.grafico-alto`. |
| `tension` | `0.35` | Suaviza la curva entre puntos horarios consecutivos. |
| `borderWidth` / `pointRadius` / `pointHoverRadius` | `2` / `0` / `5` | Mantiene líneas limpias sin puntos fijos y resalta el punto al pasar el cursor. |
| `spanGaps` | `false` | **No** une tramos cuando hay horas en `null`; preserva los cortes donde no hubo cobertura suficiente. |
| `interaction` | `{ mode: 'index', intersect: false }` | Muestra en un mismo tooltip los valores de todas las series en esa hora al mover el cursor horizontalmente. |
| `scales.x.ticks` | `{ maxTicksLimit: 8, maxRotation: 0 }` | Limita a 8 etiquetas horizontales sin inclinación. |
| `scales.y1` | `{ position: 'right', grid: { drawOnChartArea: false } }` | Se agrega solo cuando `CONFIG_GRAFICOS` define una serie con `eje: 'y1'` (`#grafico-clima`), evitando duplicar líneas de grilla. |

---

## Ciclo de vida, actualización y tema oscuro

### 1. Reutilización de instancias (`graficos` + `update('none')`)
Las instancias creadas se guardan en el diccionario `graficos[cfg.id]`. En recargas posteriores (al pulsar `24 h` / `7 días` o en el refresco automático cada `15000` ms si `!document.hidden`), no se destruye el `<canvas>` ni se recrea `Chart`: se reemplazan `data.labels` y `data.datasets` y se invoca `graficos[cfg.id].update('none')` para evitar parpadeos y animaciones innecesarias.

### 2. Redimensionamiento dentro del carrusel Bootstrap
Al cargar la página, las diapositivas 2 y 3 están ocultas (`display: none`), por lo que sus canvas pueden inicializarse con tamaño cero. El listener sobre `#carrusel-graficos`:

```js
document.getElementById('carrusel-graficos')?.addEventListener('slid.bs.carousel', () => {
  Object.values(graficos).forEach(g => g.resize());
});
```

recalcula las dimensiones en cuanto termina la transición de diapositiva.

### 3. Sincronización en vivo con modo claro / modo oscuro
`public/js/theme.js` alterna el atributo `data-bs-theme` (`light` / `dark`) en `document.documentElement`. En `public/js/visualizador.js`:

- `esModoOscuro()`, `colorSerie(s)` y `paletaGrafico()` eligen los colores adecuados para textos de ejes/leyenda (`#cbd8cf` en oscuro, `#495057` en claro), líneas de grilla (`rgba(228, 237, 231, 0.12)` vs `rgba(0, 0, 0, 0.08)`) y líneas de series (`colorOscuro` vs `color`, evitando por ejemplo que `PM10` verde oscuro se pierda sobre el fondo `#162a25`).
- Un `MutationObserver` observa cambios en `data-bs-theme` y ejecuta `aplicarTemaGraficos()`, actualizando en tiempo real todos los gráficos ya dibujados mediante `g.update('none')` sin recargar la página ni volver a pedir datos al servidor.

---

## Cómo agregar una nueva variable o serie (ejemplo: `VOC`)

1. **Base de datos y API:** Registrar la variable en `variable` y `sensor_variable` (y su intervalo en `politica_ml.configuracion.intervalos_sensor` si es simulado). `seriesService.horas` la devolverá automáticamente en `/api/visualizador/series`.
2. **Frontend (`public/js/visualizador.js`):** Agregar el objeto en `CONFIG_GRAFICOS` dentro de `#grafico-gases` (por ejemplo `{ codigo: 'VOC', etiqueta: 'VOC (ppb)', color: '#...', colorOscuro: '#...', eje: 'y1' }` si usa distinta escala) y actualizar o retirar la insignia `.voc-placeholder` en `public/visualizador.html` y el texto de `VOC` en `FILAS_SEMANAL`.
