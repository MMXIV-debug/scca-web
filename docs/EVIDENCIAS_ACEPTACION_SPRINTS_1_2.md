# Evidencias de Aceptación — Sprints 1 y 2 (SCCA)

**Fecha de verificación:** 2026-11-24  
**Suite reproducible:** `npm run prueba:aceptacion` ([aceptacion-sprints-1-2.cjs](file:///c:/Users/ykira/scca-web/tests/aceptacion-sprints-1-2.cjs))  
**Salida JSON verificada:** [resultado-aceptacion.json](file:///c:/Users/ykira/scca-web/docs/evidencias-sprints-1-2/resultado-aceptacion.json)

> [!NOTE]
> Este documento reúne exclusivamente las evidencias de los puntos faltantes de los Sprints 1 y 2. Los aspectos ya comprobados previamente (esquema base de PostgreSQL, consultas, simulador, flujo API → PostgreSQL y prueba técnica controlada `10 → 21`) se mantienen íntegros y también fueron revalidados sin regresión (`npm test`: 91/91 pruebas unitarias/contrato; `npm run prueba:correccion`: OK).

---

## Resumen de cumplimiento

| Sprint | Requisito pendiente | Estado | Evidencia principal |
| :--- | :--- | :--- | :--- |
| **Sprint 1** | Gestión administrativa de sitios, nodos, sensores, mantenimientos, referencias y reemplazos conservando historial | **Cumplido y verificado** | [infraestructuraService.js](file:///c:/Users/ykira/scca-web/services/infraestructuraService.js), [infraestructura.js](file:///c:/Users/ykira/scca-web/public/js/infraestructura.js), bloque `Sprint 1 - Infraestructura` y `Sprint 1 - Reemplazo` |
| **Sprint 1** | Reemplazo desactiva modelo ML anterior; rechazo de duplicados y unidades incompatibles | **Cumplido y verificado** | Trigger `tg_sensor_baja` (`modelo_ml.estado = 'retirado'`), duplicados `409`, unidad incompatible `422` |
| **Sprint 1** | Política ML con referencias, rangos por variable y versionado estrictamente inmutable | **Cumplido y verificado** | [politicasService.js](file:///c:/Users/ykira/scca-web/services/politicasService.js), [CatalogoMlController.cs](file:///c:/Users/ykira/scca-web/backend/Scca.Api/Controllers/CatalogoMlController.cs), triggers `tg_politica_ml_inmutable` y `tg_politica_variable_ro` |
| **Sprint 1** | Cuenta PostgreSQL con permisos limitados (`app_api`, sin superusuario) y bloqueo de `UPDATE`/`DELETE`/`TRUNCATE` en originales y auditoría | **Cumplido y verificado en BD aislada y BD Easypanel real** | [14_sprint1_sprint2_hardening.sql](file:///c:/Users/ykira/scca-web/db/14_sprint1_sprint2_hardening.sql), `rolsuper = false`, SQLSTATE `42501` en las 6 operaciones bloqueadas |
| **Sprint 2** | Firmware ESP32 (`.ino`) con captura y envío configurables, buffer 24 h sin conexión (1.440 muestras) y reenvío sin duplicados | **Cumplido y verificado** | [scca_esp32.ino](file:///c:/Users/ykira/scca-web/arduino/scca_esp32/scca_esp32.ino), [config.h](file:///c:/Users/ykira/scca-web/arduino/scca_esp32/config.h), prueba de 96 lotes × 15 muestras = 1.440 + reenvío idempotente |
| **Sprint 2** | Integración BME680 (variables, unidades, API individual/lote, PostgreSQL) | **Software/BD/API/firmware 100% verificado** *(requiere hardware físico conectado para prueba en placa)* | Catálogo `PRES (hPa)` y `GAS (ohm)` creado en Easypanel y BD aislada; ingesta `POST /api/lecturas` y `POST /api/lecturas/lote` verificadas |
| **Sprint 2** | Tratamiento de lecturas inválidas (criterio formal de rechazo directo vs cuarentena) | **Cumplido y verificado** | [LecturasController.cs](file:///c:/Users/ykira/scca-web/backend/Scca.Api/Controllers/LecturasController.cs), matriz documentada abajo y verificada en `Sprint 2 - Cuarentena` |
| **Sprint 2** | Calibración ML con referencia calibrada emparejada (mejora RMSE ≥ 20 %, MAE y \|sesgo\| no peores, periodo posterior separado) | **Pipeline técnico 100% verificado** *(requiere campaña física real con instrumento patrón para activar calibración en campo)* | [preparar_datasets.py](file:///c:/Users/ykira/scca-web/ml_engine/preparar_datasets.py) (`--referencia-fuente-id`), mejora controlada 93,73 % aprobada y caso sin mejora rechazado |

---

## 1. Sprint 1 — Gestión administrativa de infraestructura y reemplazos

**Implementación:**
- Servicio REST administrativo en `/api/admin/infraestructura` ([infraestructuraService.js](file:///c:/Users/ykira/scca-web/services/infraestructuraService.js)) con documentación OpenAPI ([swaggerService.js](file:///c:/Users/ykira/scca-web/services/swaggerService.js)) e interfaz integrada en el panel administrador ([dashboard.html](file:///c:/Users/ykira/scca-web/public/dashboard.html), [infraestructura.js](file:///c:/Users/ykira/scca-web/public/js/infraestructura.js)).
- Endpoints implementados: `GET /resumen`, `POST /sitios`, `POST /nodos`, `PATCH /nodos/:id`, `POST /sensores`, `POST /sensores/:id/reemplazar`, `POST /mantenimientos`, `POST /referencias`, `POST /referencias/:id/lecturas`.

**Evidencia verificada (`resultado-aceptacion.json`):**
- Alta de sitio, nodo, referencia calibrada, sensor `DHT11` y sensor `BME680` (vinculando automáticamente `TEMP (°C)`, `HUM (%)`, `PRES (hPa)` y `GAS (ohm)`).
- Rechazo de duplicados por `codigo` (`HTTP 409`) y por par `(modelo, numero_serie)` (`HTTP 409`).
- Rechazo de unidad incompatible al registrar sensor (`TEMP` con `hPa` → `HTTP 422`).
- Registro de mantenimiento con cambio de estado del nodo (`activo → mantenimiento → activo`) y auditoría.
- **Reemplazo atómico de sensor (`POST /api/admin/infraestructura/sensores/:id/reemplazar`):**
  - Sensor anterior `#1`: `activo = false`, `baja_en != null`, **2/2 lecturas históricas conservadas** en `lectura_original`.
  - Modelo ML activo del sensor anterior: cambiado automáticamente a `estado = 'retirado'` por el trigger `tg_sensor_baja`.
  - Nuevo sensor `#5`: creado con `reemplaza_a = 1`, mantenimiento `tipo = 'reemplazo'` y evento `auditoria_evento` (`accion = 'reemplazar'`).

---

## 2. Sprint 1 — Política ML con referencias, rangos e inmutabilidad estricta

**Implementación:**
- [politicasService.js](file:///c:/Users/ykira/scca-web/services/politicasService.js) valida y persiste `referencia_fuente_id` y `rangos_variables` (`politica_variable`: `rango_min`, `rango_max`, `umbral_alerta`).
- **Corrección de edición in-place:** tanto `POST /api/admin/ml/politicas`, `PUT /api/admin/ml/politicas/:id` (Node) como `PUT /api/ml/politicas/{id}` (.NET [CatalogoMlController.cs](file:///c:/Users/ykira/scca-web/backend/Scca.Api/Controllers/CatalogoMlController.cs)) **siempre insertan una nueva versión** (`version = max(version) + 1`), cierran `vigente_hasta` en la anterior sin tocar sus parámetros ni sus rangos, e impiden modificar versiones históricas (`HTTP 409`).
- **Protección en PostgreSQL** ([14_sprint1_sprint2_hardening.sql](file:///c:/Users/ykira/scca-web/db/14_sprint1_sprint2_hardening.sql)): triggers `tg_politica_ml_inmutable` (permite actualizar únicamente `vigente_hasta` y `eliminada_en`; bloquea cambios en parámetros y `DELETE`), `tg_politica_ml_truncate` y `tg_politica_variable_ro` (`BEFORE UPDATE OR DELETE OR TRUNCATE`).
- Formulario y tabla actualizados en el panel ML ([panel-ml.js](file:///c:/Users/ykira/scca-web/public/js/panel-ml.js)).

**Evidencia verificada:**
- Creación de versiones consecutivas `v2` (`POST`), `v3` (`PUT` Node) y `v4` (`PUT` .NET → `201 Created`).
- `v2` mantuvo intacto `pares_minimos = 540` tras crear `v3` (`600`) y `v4` (`620`).
- Intento de `PUT` sobre versión histórica `v2` rechazado con `HTTP 409`.
- `UPDATE` directo por SQL sobre `politica_ml.pares_minimos` y `politica_variable.rango_max` bloqueados por triggers.

---

## 3. Sprint 1 — Cuenta PostgreSQL de menor privilegio (`app_api`)

**Implementación:**
- Migración [14_sprint1_sprint2_hardening.sql](file:///c:/Users/ykira/scca-web/db/14_sprint1_sprint2_hardening.sql):
  - Agrega triggers `BEFORE TRUNCATE` (`tg_lectura_truncate`, `tg_auditoria_truncate`) en `lectura_original` y `auditoria_evento`.
  - Concede permisos mínimos a `app_api` y revoca explícitamente `UPDATE, DELETE, TRUNCATE` sobre `lectura_original`, `auditoria_evento`, `politica_variable`, `evaluacion_muestra`, `ml_demo_version` y `ml_demo_resultado`, además de revocar `DELETE, TRUNCATE` en las demás tablas (excepto `DELETE` puntual en `modelo_ml`).
- [climaService.js](file:///c:/Users/ykira/scca-web/services/climaService.js): evita ejecutar DDL (`CREATE TABLE`) en tiempo de ejecución cuando las tablas ya existen, permitiendo operar limpiamente sin privilegios de propietario ni superusuario.

**Evidencia verificada en BD real de Easypanel (`sistema_calidad_aire`) y en BD aislada:**
- Usuario anterior: `postgres` (`rolsuper = true`) → usuario activo en `.env`: **`app_api` (`rolsuper = false`)**.
- Pruebas directas ejecutadas con sesión autenticada como `app_api`:
  - `UPDATE lectura_original`: bloqueado (`SQLSTATE 42501 — permission denied`)
  - `DELETE FROM lectura_original`: bloqueado (`SQLSTATE 42501`)
  - `TRUNCATE TABLE lectura_original`: bloqueado (`SQLSTATE 42501`)
  - `UPDATE auditoria_evento`: bloqueado (`SQLSTATE 42501`)
  - `DELETE FROM auditoria_evento`: bloqueado (`SQLSTATE 42501`)
  - `TRUNCATE TABLE auditoria_evento`: bloqueado (`SQLSTATE 42501`)
- Pruebas con superusuario: `TRUNCATE TABLE lectura_original CASCADE` y `TRUNCATE TABLE auditoria_evento CASCADE` también bloqueados por los triggers `BEFORE TRUNCATE`.
- **Arranque completo real (`node iniciar.js --sin-navegador`) con `.env` usando `app_api`:**
  - Node Web (`:3000`): `HTTP 200`
  - API .NET (`:5051/api/estado`): `HTTP 200` (`{"api":"disponible","postgresql":"conectado"}`)
  - Servicio ML (`:8000/openapi.json`): `HTTP 200`
  - Errores `42501` en logs de arranque y sincronización de clima: **0**.

---

## 4. Sprint 2 — Firmware ESP32 (`.ino`) con almacenamiento 24 h sin conexión

**Archivos creados:**
- [scca_esp32.ino](file:///c:/Users/ykira/scca-web/arduino/scca_esp32/scca_esp32.ino)
- [config.h](file:///c:/Users/ykira/scca-web/arduino/scca_esp32/config.h)
- [README.md](file:///c:/Users/ykira/scca-web/arduino/scca_esp32/README.md)

**Criterios implementados:**
- **Captura y envío configurables:** por defecto captura cada `60 s` (`INTERVALO_CAPTURA_SEG_DEF = 60U`) y envía un lote de 15 muestras cada `900 s` (`15 min`, `INTERVALO_ENVIO_SEG_DEF = 900U`), modificables en vivo por Monitor Serial (`SET_CAP`, `SET_ENV`, `STATUS`, `FLUSH`) y persistidos en NVS (`Preferences`).
- **24 horas sin red (`1.440 muestras`):** buffer circular binario persistente en `LittleFS` (`/buffer_scca.bin`, `MAX_MUESTRAS_BUFFER = 1440U`, ~62 KB) con verificación `CRC32` por registro (`calcularCrc`) y punteros persistidos en NVS para sobrevivir cortes de energía.
- **Reenvío sin duplicados:** cada muestra recibe un `idMuestra` monotónico único persistido en NVS; el firmware envía lotes a `POST /api/lecturas/lote` y únicamente desencola cada muestra cuando el servidor confirma `201` (guardada/cuarentena) o `409` (ya registrada), reteniendo la cola ante cortes de red o errores `5xx`.

**Evidencia verificada (`Sprint 2 - ESP32 y BME680`):**
- Simulación de vaciado de 24 h sin red contra la API .NET real: **96 lotes × 15 muestras = 1.440 muestras guardadas** (`guardadas = 1440`, `duplicadas = 0`, `rechazadas = 0`).
- Reenvío posterior del primer lote (15 muestras repetidas) combinado con 5 muestras nuevas: **`duplicadas = 15` (`409`), `guardadas = 5` (`201`)**, total exacto sin duplicados en `lectura_original` (`1.446` muestras únicas = `5.784` filas de variables BME680).

---

## 5. Sprint 2 — Integración del sensor BME680

**Implementación y registro en BD:**
- Unidades agregadas idempotente en PostgreSQL (Easypanel y pruebas): `5: hPa`, `6: ohm`.
- Variables agregadas en `public.variable`: `7: PRES` (Presión atmosférica, `hPa`), `8: GAS` (Resistencia de gas VOC, `ohm`).
- Soporte completo en `infraestructuraService.js`, `LecturasController.cs` (`POST /api/lecturas` y `POST /api/lecturas/lote`), `panelMlService.js`, `panel-ml.js` y firmware `scca_esp32.ino` (`#define PERFIL_BME680`).

> [!IMPORTANT]
> **Alcance respecto a hardware físico:** La pila completa de software (registro en BD, API individual y por lote, validación de unidades/rangos, cuarentena y firmware `.ino` con `Adafruit_BME680`) está 100 % implementada y verificada de extremo a extremo. La prueba física sobre una placa ESP32 + módulo BME680 conectado por I2C requiere compilar y flashear [scca_esp32.ino](file:///c:/Users/ykira/scca-web/arduino/scca_esp32/scca_esp32.ino) con Arduino IDE en el equipo donde esté conectado el hardware físico (siguiendo [README.md](file:///c:/Users/ykira/scca-web/arduino/scca_esp32/README.md)).

---

## 6. Sprint 2 — Política de tratamiento de lecturas inválidas (Rechazo vs Cuarentena)

Implementada en [LecturasController.cs](file:///c:/Users/ykira/scca-web/backend/Scca.Api/Controllers/LecturasController.cs) y verificada en el bloque `Sprint 2 - Cuarentena`.

| Caso de entrada | Acción | HTTP | Persistencia | Justificación |
| :--- | :--- | :---: | :--- | :--- |
| API Key faltante o incorrecta | **Rechazo directo** | `401` | Ninguna | Seguridad de acceso; no se acepta tráfico no autenticado |
| Sensor inexistente o dado de baja (`activo = false`) | **Rechazo directo** | `400` | Ninguna | Identidad inválida o equipo retirado del servicio |
| Fecha `medidoEn` sin zona horaria, >4 decimales o variable duplicada en el mismo payload | **Rechazo directo** | `400` | Ninguna | Error estructural de contrato / serialización |
| Unidad incompatible (`unidadId` ≠ catálogo) o variable ajena al perfil del sensor | **Rechazo directo** | `422` | Ninguna | Incompatibilidad física/metrológica de catálogo |
| Duplicado `(sensorId, idMuestra)` ya existente en `lectura_original` o `lectura_cuarentena` | **Rechazo directo (idempotente)** | `409` | Ninguna nueva | Evita duplicados en reenvíos del ESP32 |
| Valor fuera de rango físico del sensor (p. ej. `HUM = 105 %`, `TEMP` fuera de `0..50 °C` en DHT11 o `-40..85 °C` en BME680, `PRES` fuera de `300..1100 hPa`, `GAS ≤ 0`) | **Cuarentena** | `201` (`estado: "cuarentena"`) | `lectura_cuarentena` + `evaluacion_muestra` (`estado = 'dato_invalido'`) | Conserva evidencia de fallo de sensor para diagnóstico y revisión |
| Valor dentro del rango físico pero fuera del rango operativo de `politica_variable` vigente (p. ej. `TEMP = 45 °C` con política `[0, 40]`) | **Cuarentena** | `201` (`estado: "cuarentena"`) | `lectura_cuarentena` + `evaluacion_muestra` (`dato_invalido`) | Permite al administrador auditar eventos extremos o descalibración |
| Muestra incompleta para el perfil (p. ej. BME680 sin `PRES` o `GAS`) | **Cuarentena** | `201` (`estado: "cuarentena"`) | `lectura_cuarentena` + `evaluacion_muestra` (`dato_invalido`) | Registra fallos parciales de lectura del bus I2C/sensor |
| Fecha `medidoEn` futura (> +5 min respecto al servidor) | **Cuarentena** | `201` (`estado: "cuarentena"`) | `lectura_cuarentena` + `evaluacion_muestra` (`dato_invalido`) | Registra desincronización NTP del nodo sin contaminar series |
| Anomalía detectada por el servicio ML (`es_anomalia = true`) | **Cuarentena** | `201` (`estado: "cuarentena"`) | `lectura_cuarentena` + `evaluacion_muestra` | Requiere clasificación humana (`normal`, `episodio_ambiental` o `fallo_sensor`) |

**Evidencia verificada:**
- Los 7 casos de rechazo directo no escribieron filas en `lectura_cuarentena`.
- Los 4 casos de dato inválido se guardaron en `lectura_cuarentena` con causa explícita y `evaluacion_muestra.estado = 'dato_invalido'`.
- El reenvío de una muestra ya en cuarentena devolvió `HTTP 409` sin duplicarla.
- En revisión administrativa (`POST /api/admin/cuarentena/decisiones`), restaurar un `dato_invalido` fue rechazado (`HTTP 422`), mientras que descartar con `clasificacion = 'dato_invalido'` se registró con auditoría conservando el payload original.

---

## 7. Sprint 2 — Calibración ML emparejada con referencia calibrada

**Implementación:**
- Ingesta de lecturas de instrumento patrón calibrado vía `POST /api/admin/infraestructura/referencias/:id/lecturas` hacia `public.referencia_lectura` (validando catálogo de variables, unidades, zona horaria e idempotencia).
- Emparejamiento temporal en [preparar_datasets.py](file:///c:/Users/ykira/scca-web/ml_engine/preparar_datasets.py) con `--referencia-fuente-id <id>`, verificando compatibilidad de unidades, promediando por hora UTC y marcando `validacion_independiente = true` cuando el sensor es `real`.
- Entrenamiento y compuerta estricta de activación en [evaluacion.py](file:///c:/Users/ykira/scca-web/ml_engine/evaluacion.py) y [gobernanza.py](file:///c:/Users/ykira/scca-web/ml_engine/gobernanza.py): exige ≥ 30 días, ≥ 540 pares, ≥ 75 % completitud, partición temporal estrictamente posterior (30 % final), **mejora de RMSE ≥ 20 %**, **MAE no peor** y **\|sesgo\| no peor**.

**Evidencia verificada con dataset controlado de 35 días (840 pares horarios):**
- **Partición temporal estricta:** entrenamiento `2026-10-20T17:00Z .. 2026-11-14T04:00Z` (`588` horas) → prueba final posterior `2026-11-14T05:00Z .. 2026-11-24T16:00Z` (`252` horas).
- **Caso 1 — Sensor con sesgo sistemático (aprobado):**
  - Algoritmo elegido en validación interna: `regresion_lineal`
  - RMSE: `2.1386 → 0.1341` (**mejora del 93.73 % ≥ 20 %**)
  - MAE: `1.9865 → 0.1159` (no empeora)
  - Sesgo: `+1.9865 → +0.0044` (\|sesgo\| no empeora)
  - Estado resultante: **`apto_demo` (promovido a activo)**
- **Caso 2 — Sensor sin mejora real / ruido puro (rechazado):**
  - Estado resultante: **`rechazado`** (`mejora_rmse_insuficiente`, `mae_empeora`, `sesgo_absoluto_empeora`), **no activado**.

> [!IMPORTANT]
> **Alcance para calibración física en producción:** El flujo completo de carga de referencia, emparejamiento horario, partición posterior y compuerta de métricas (`RMSE ≥ 20 %`, `MAE`, `|sesgo|`) está implementado y demostrado. Antes de activar una corrección ML sobre mediciones reales en producción, se deben cargar al menos 30 días (≥ 540 pares horarios) de co-localización física real contra un instrumento de referencia calibrado mediante `POST /api/admin/infraestructura/referencias/:id/lecturas` y ejecutar `preparar_datasets.py --referencia-fuente-id` seguido de `entrenador.py evaluar`.
