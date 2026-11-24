# Firmware ESP32 — SCCA (BME680 / DHT11)

Firmware de captura y envío resiliente para ESP32 compatible con la API .NET (`POST /api/lecturas/lote`).

## Características (Sprint 2)

- **Captura y envío configurables:** captura por defecto cada `60 s` y envía lotes cada `900 s` (`15 min`). Pueden cambiarse sin recompilar mediante comandos Serial (`SET_CAP <seg>`, `SET_ENV <seg>`) persistidos en NVS (`Preferences`).
- **24 horas sin conexión (`1.440` muestras):** guarda cada muestra en un buffer circular binario (`/buffer_scca.bin`, ~62 KB en `LittleFS`) con CRC32 y punteros en NVS, resistiendo cortes de WiFi y reinicios eléctricos.
- **Reenvío sin duplicados:** cada muestra lleva un `idMuestra` monotónico único persistido en NVS y fecha `medidoEn` UTC por NTP. Al reconectar, los códigos `201` (guardada/cuarentena) y `409` (ya recibida) confirman la entrega y retiran la muestra de la cola; solo errores de red/`5xx` la retienen para reintento.
- **Perfiles físicos:** soporta **BME680** (`TEMP` °C, `HUM` %, `PRES` hPa, `GAS` ohm) y **DHT11** (`TEMP` °C, `HUM` %) seleccionando `#define PERFIL_BME680` o `#define PERFIL_DHT11` en `config.h`.

## Librerías necesarias (Arduino IDE / PlatformIO)

- Paquete de placa: `esp32` by Espressif Systems (incluye `WiFi`, `HTTPClient`, `LittleFS`, `Preferences`).
- `ArduinoJson` (v7.x).
- Para BME680: `Adafruit BME680 Library` y `Adafruit Unified Sensor`.
- Para DHT11: `DHT sensor library` (Adafruit).

## Cableado rápido

- **BME680 (I2C en ESP32 estándar):** `VCC -> 3.3V`, `GND -> GND`, `SDA -> GPIO 21`, `SCL -> GPIO 22`. Dirección `0x76` o `0x77` en `config.h`.
- **DHT11:** `VCC -> 3.3V`, `GND -> GND`, `DATA -> GPIO 4` (configurable en `DHT_PIN`).

## Preparación antes de subir

1. Registra el sensor desde el panel Administrador (**Sitios y fuentes → Registrar sensor**) eligiendo modelo `BME680` o `DHT11`, y anota su `sensor_id`.
2. Verifica los `unidad_id` en la tabla `unidad` (`°C`, `%`, `hPa`, `ohm`) y colócalos en `config.h`.
3. Configura `WIFI_SSID`, `WIFI_PASSWORD`, `API_BASE_URL` (IP del servidor SCCA en puerto `5051`), `API_KEY_IOT` (igual a `IOT_API_KEY` del `.env`) y `SENSOR_ID`.
4. Selecciona un esquema de partición con `LittleFS` en Arduino IDE (por ejemplo *Default 4MB with spiffs/LittleFS*) y sube el sketch.
