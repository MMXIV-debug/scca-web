# Mejoras en las APIs y el Modelo de Machine Learning

Documentación técnica consolidada de los cambios en las tres capas de API (Node/Express, .NET `Scca.Api` y Python FastAPI v2) y en el motor de Machine Learning (`ml_engine/`) que complementan las bitácoras históricas de [cambios-api-ml.md](cambios-api-ml.md), [inferencia-versionada-ml.md](inferencia-versionada-ml.md) y [persistencia-ml-demo.md](persistencia-ml-demo.md).

---

## Arquitectura de comunicación y seguridad

El sistema separa las responsabilidades en tres procesos locales conectados entre sí:

| Capa | Proceso / Puerto | Autenticación | Rol principal |
|---|---|---|---|
| **Web / Panel** | Node.js (`server.js`, puerto `3000`) | `Bearer JWT` (validado en BD por `auth` y `soloAdmin`) | Sirve vistas, gestiona usuarios, políticas, cuarentena, alertas, series y actúa como proxy autenticado hacia .NET y Python. |
| **API de ingesta y evaluación** | .NET 10 (`backend/Scca.Api`, puerto `5051`) | `X-Api-Key` (`Iot:ApiKey`, comparación en tiempo constante con `FixedTimeEquals`) | Recibe muestras IoT/simuladas (`POST /api/lecturas`), evalúa modelos horarios (`POST /api/modelo/evaluar`) y persiste resultados demo. |
| **Servicio ML** | Python FastAPI (`ml_engine/inferencia.py`, puerto `8000`) | `X-Api-Key` (`Iot__ApiKey` o `IOT_API_KEY`, verificada con `hmac.compare_digest`) | Expone inferencia versionada (`/api/v2/modelos/*`) y el estado legado de respaldo (`/api/modelo`). |

- **Secretos aislados del navegador:** El cliente web únicamente posee su JWT de usuario. La clave `IOT_API_KEY` nunca se envía al frontend; las llamadas del panel administrativo hacia .NET o Python pasan primero por `services/panelMlService.js` en el servidor Node.

---

## 1. Mejoras en la API .NET (`backend/Scca.Api`)

### Conexión y clientes HTTP (`Program.cs`)
- `Program.cs` construye `NpgsqlDataSource` a partir de `DATABASE_URL` (admitiendo `sslmode`: `disable`, `allow`, `prefer`, `require`, `verify-ca`, `verify-full`) y registra clientes `HttpClient` dedicados: `ModeloMl` (`Ml:BaseUrl`, timeout `15 s`) y `Panel` (`Panel:BaseUrl`, timeout `8 s`, sin redirecciones automáticas).

### Ingesta por perfil y trazabilidad (`LecturasController.cs`)
`POST /api/lecturas` reemplazó la validación genérica por un contrato estricto por perfil:

- **Perfiles soportados:** `dht11` (`TEMP` 0–50 °C, `HUM` 0–100 %), `bme680` (`TEMP` ≥ -273.15 °C, `HUM` 0–100 %, `PRES` > 0 hPa, `GAS` > 0 ohm) y `contaminantes_simulados` (`CO`, `PM1`, `PM10`, `PM25` ≥ 0 µg/m³). Rechaza muestras incompletas, variables repetidas, más de 4 decimales o unidades incompatibles (`400`/`422`).
- **Serialización e idempotencia:** Adquiere `pg_advisory_xact_lock(192837, @sensor)` y comprueba duplicados `(sensor_id, id_muestra)` tanto en `lectura_original` como en `lectura_cuarentena` (`409 Conflict`).
- **Evaluación ML acotada a `3 s`:** Consulta `POST /api/v2/modelos/muestra` enviando `nodo_id`, `sensor_id`, `perfil` y `valores`. Valida que la respuesta devuelva identidad coincidente y versión hex válida (`32` caracteres para `evaluado_demo`, `64` para `evaluado_legacy`). Si ML está caído, responde lento o devuelve un payload inválido, conserva la muestra con `es_anomalia = null` (`ml_no_disponible` / `respuesta_invalida`) sin derribar la ingesta.
- **Trazabilidad inmutable:** Inserta cada intento en `evaluacion_muestra` con `estado`, `modelo_version` y `evidencia` JSONB. Solo si `esAnomalia == true` desvía la muestra a `lectura_cuarentena`; en caso contrario guarda en `lectura_original` como `valida`.

### Evaluación horaria y respaldo Open-Meteo (`EvaluacionMlController.cs` y `ResultadosMlStore.cs`)
- **Política versionada en .NET:** Cuando `Ml:PoliticaVersionadaHabilitada=true`, `EvaluacionMlController.Evaluar` (`POST /api/modelo/evaluar`) lee `politica_ml.configuracion` vigente para obtener `arranque_demo` e `intervalos_sensor` por sensor, manteniendo compatibilidad con la configuración estática `Ml:IntervalosSensor`.
- **Agregación por slots y conmutación automática en arranque:** Agrupa lecturas válidas por `date_bin` del intervalo del sensor dentro de una transacción `RepeatableRead` en modo `SET TRANSACTION READ ONLY`. Si un pronóstico de un sensor `simulado` no alcanza cobertura en una hora cerrada y `arranque_demo` está activo, delega la consulta en `POST /api/v2/modelos/inferir-fuente` en lugar de devolver `datos_incompletos`.
- **Persistencia idempotente (`ResultadosMlStore.Guardar`):**
  - Bloquea por hash de versión (`pg_advisory_xact_lock(hashtextextended(@version, 0))`), revalida catálogo/unidades del sensor y verifica que los metadatos del resultado coincidan con la versión registrada en `ml_demo_version`.
  - Serializa la entrada ordenada (`EntradaCanonica` con `SortedDictionary`) para generar `entrada_sha256` e inserta en `ml_demo_resultado` (`ON CONFLICT DO NOTHING`).
  - **Corrección aplicada en reintentos:** Al repetir la evaluación de una misma hora con respaldo de Open-Meteo, la marca de tiempo `entrada_fuente.procedencia.consultado_en` cambia en cada llamada al proveedor externo. La verificación de idempotencia excluye ahora esa ruta mediante `#- '{entrada_fuente,procedencia,consultado_en}'` para evitar falsos `InvalidOperationException` y conservar el `resultado_id` original.

---

## 2. Mejoras en la API interna Python v2 (`ml_engine/inferencia.py` e `inferencia_registro.py`)

- **Retiro de contratos legados:** En `ml_engine/inferencia.py`, las rutas antiguas `POST /api/predict/anomaly` y `POST /api/predict/forecast` responden `HTTP 410` indicando los nuevos contratos (`/api/lecturas` y `/api/modelo/evaluar`). La ruta `GET /api/modelo` y el router legado de `integracion_iot.py` se conservan solo como respaldo explícito (`evaluado_legacy`) para contaminantes simulados.
- **Router versionado (`/api/v2/modelos`):**

| Endpoint | Uso principal | Validaciones clave |
|---|---|---|
| `POST /api/v2/modelos/muestra` | Detección instantánea en ingesta (`.NET`) | Exige perfil completo y rangos físicos. Carga el detector activo (`entrada_agregado_s == 0`); si no existe versión para `contaminantes_simulados`, recurre al `.joblib` legado (`evaluado_legacy`), nunca para hardware físico. |
| `GET /api/v2/modelos/registro` | Panel administrativo y monitoreo | Devuelve `items` (hasta 500 recientes más activos), `activos`, `total` y los últimos `10` informes de `ciclos/*.json`. |
| `POST /api/v2/modelos/estado` | Pre-consulta de .NET antes de agregar datos | Devuelve disponibilidad (`disponible_demo` / `sin_modelo`), `modelo_version`, `variables_entrada`, `intervalo_s`, `completitud_minima` y `modelo_metadatos`. |
| `POST /api/v2/modelos/inferir` | Calibración y pronóstico por hora cerrada | Exige `modelo_version` coincidente (`409 Conflict` si cambió entre `estado` e `inferir`), verifica integridad `SHA-256` del `.joblib` en memoria antes de `predict`, valida `feature_names_in_` y salidas físicas (`HUM` en `0..100`, no negativos salvo `TEMP`). Si `arranque_demo` está activo en pronósticos, permite evaluar fuera de dominio marcando `fuera_dominio_entrada: true`. |
| `POST /api/v2/modelos/inferir-fuente` | Respaldo Open-Meteo para pronósticos simulados | Solo admite `perfil == 'contaminantes_simulados'`, `proposito == 'pronostico'`, `arranque_demo == true` y horas cerradas dentro de los últimos 3 días. Usa `@lru_cache(maxsize=32)` por bloques de 10 minutos, estima `PM1 = 0.70 × PM25` y adjunta `entrada_fuente` con procedencia completa. |
| `POST /api/v2/modelos/revertir` | Reversión administrativa | Recibe `clave` y `motivo` (10–1000 caracteres); restaura la versión previa verificada o devuelve `409` si no es posible. |

---

## 3. Mejoras en el Modelo ML y ciclo automático (`ml_engine/`)

### Pronóstico y modo de arranque (`modelos_arranque.py` y `evaluacion.py`)
- **Selección y prevención de fuga temporal (`dividir_temporal`):** Separa la prueba final (30 % por defecto) y realiza una purga temporal (`hora_objetivo < prueba.index[0]` y `hora_objetivo < validacion.index[0]`) para que ningún objetivo futuro de 1, 3 o 6 horas filtre información hacia el entrenamiento o validación interna.
- **Candidatos por propósito (`candidatos`):**
  - `calibracion`: compite `LinearRegression` vs `RandomForestRegressor` (`n_estimators=80`, `max_depth=8`).
  - `pronostico` normal: entrena `XGBRegressor` (`objective='reg:squarederror'`, `n_estimators=80`, `max_depth=3`, `learning_rate=0.05`).
  - `pronostico` con `arranque_demo`: compite `Persistencia` (`modelos_arranque.py`, devuelve el valor actual de la variable objetivo), `LinearRegression` y `RandomForestRegressor` regulado (`max_depth=4`, `min_samples_leaf=3`). Si ningún candidato supera los criterios (`mejora_rmse_minima`, MAE y sesgo) ni empeora al vigente, se activa explícitamente un respaldo `persistencia` etiquetado como `respaldo_persistencia_sin_mejora_demostrada` (`tipo_pronostico: 'respaldo_persistencia'`).

### Detección de anomalías por perfil (`anomalias.py`)
- **Modo supervisado por defecto (`evaluar_anomalias`):** Entrena `IsolationForest(n_estimators=100, contamination='auto', random_state=42)` sobre originales completos anteriores al corte temporal y evalúa clasificación binaria sobre `anomalias_revisadas.csv` (etiquetas humanas `0/1` de cuarentena). Exige criterios configurables (`muestras_entrenamiento`, `dias_minimos`, `normales_prueba`, `fallos_prueba`, `precision_minima: 0.90`, `recall_minimo: 0.90`, `fpr_maxima: 0.05`) y compara contra el detector vigente antes de promover.
- **Modo arranque no supervisado (`evaluar_arranque`):** Cuando `arranque_demo=true`, ajusta `IsolationForest` por perfil desde un mínimo de `8` muestras completas distintas (`originales.csv` para hardware físico o `historial_fuente.csv` para contaminantes simulados), registra `modo_evaluacion: 'arranque_no_supervisado'`, `validacion_etiquetada: false` y `entrenamiento_sha256` para evitar reentrenar si no hay datos nuevos (`sin_datos_nuevos`).

### Ciclo orquestado (`ciclo_automatico.py`)
- Lee la política vigente y los sensores activos en transacción `SET TRANSACTION READ ONLY` (`statement_timeout='30s'`).
- Prepara datasets de cada sensor (`preparar_datasets.py`) usando una ventana de `2` días cuando `arranque_demo` está activo (o historial ampliado en modo normal), y ejecuta calibración (por variable), detección de anomalías (sobre `PM25` o `TEMP` según perfil) y pronósticos `PM25` a `1`, `3` y `6` horas, guardando el resumen y errores en `ml_engine/registro_modelos_demo/ciclos/`.

---

## 4. Mejoras en la API Node administrativa y trabajadores (`services/`)

### Panel ML en Node (`services/panelMlService.js` y `politicasService.js`)
Todas las rutas bajo `/api/admin/ml` exigen `auth` + `soloAdmin`:

- `GET /politicas` y `POST /politicas`: consulta y creación versionada de `politica_ml` mediante `crearPolitica` (`politicasService.js`), con bloqueo `pg_advisory_xact_lock(192840, 1)`, control de versión optimista (`409` si cambió `version_anterior`), validación de intervalos divisores de 3600 s, reglas ambientales/predictivas, criterios de anomalías y registro en `auditoria_evento`.
- `GET /sensores` y `GET /modelos`: lista sensores activos con sus variables configuradas y consulta el registro v2 en Python.
- `GET /operacion`: informa el estado de entrenamiento en curso, la `politica_version` vigente y el último resultado de `procesamientoMlService`.
- `POST /procesar` y `POST /comprobar-alertas`: disparan manualmente la evaluación de la última hora cerrada y la revisión de reglas ambientales/predictivas.
- `POST /evaluar`, `POST /revertir` y `POST /entrenar`: permiten evaluación puntual vía .NET, reversión auditada en `auditoria_evento` (`solicitar_reversion` / `revertir`) y lanzamiento asíncrono de `ml_engine/ciclo_automatico.py`.
- `GET /reportes` y `GET /reportes.csv`: filtran por `sensorId`, cursor `despuesDe` y rango `desde`–`hasta` (hasta `366` días). La exportación CSV sanea celdas que comienzan con `=`, `+`, `-`, `@` o espacios contra inyección de fórmulas y rechaza rangos mayores a `10000` filas con `HTTP 413`.

### Trabajadores periódicos en segundo plano (`server.js`)
Al arrancar Express, `server.js` inicializa tres procesos opcionales gobernados por variables de entorno:

1. **`procesamientoMlService.js` (`ML_RESULTADOS_AUTO=true`):** Cada `300000` ms (5 minutos) consulta los modelos activos de calibración y pronóstico y solicita a .NET evaluar y persistir (`guardarResultado: true`) la última hora cerrada.
2. **`alertasAmbientalesService.js` (`ALERTAS_AMBIENTALES_AUTO=true`):** Cada `300000` ms evalúa `alertas_ambientales` (promedios de horas completas sobre ventanas `1..168` h con cobertura mínima) y `alertas_predictivas` (solo contra pronósticos vigentes de modelos activos verificables en el registro ML), resolviendo automáticamente alertas vencidas o retiradas de supervisión sin atribuir recuperación ambiental falsa.
3. **`entrenamientoScheduler.js` (`ML_ENTRENAMIENTO_AUTO=true`):** Revisa cada 5 minutos el directorio `ciclos/` (respetando `.lock` y enfriamiento de 1 hora). En modo normal recupera el ciclo semanal perdido desde el lunes a las 10:00 `America/La_Paz` (`semanaVigente`); si `ML_ARRANQUE_DEMO=true`, reduce la ventana de recuperación a la última hora.
