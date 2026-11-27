#pragma once

// ============================================================================
// Configuración del nodo ESP32 — SCCA (Sprint 2)
// Edita estos valores antes de compilar y subir al ESP32.
// ============================================================================

// --- Red WiFi ---
#define WIFI_SSID "TU_WIFI"
#define WIFI_PASSWORD "TU_CLAVE_WIFI"

// --- API .NET SCCA (puerto por defecto 5051) ---
// Usa la IP local del equipo donde corre Scca.Api o el dominio de despliegue.
#define API_BASE_URL "http://IP_DE_TU_PC:5051"
#define API_ENDPOINT_LOTE   "/api/lecturas/lote"
#define API_KEY_IOT "TU_CLAVE_API"

// --- Identidad del sensor registrado en PostgreSQL (tabla sensor) ---
// Sustituye 3 por el ID asignado al BME680 en la instalación de destino.
#define SENSOR_ID           3

// --- Selección de hardware físico (deja activo exactamente uno) ---
#define PERFIL_BME680
// #define PERFIL_DHT11

// Pin GPIO para DHT11 (solo si PERFIL_DHT11 está activo)
#define DHT_PIN             4
#define DHT_TYPE            DHT11

// Dirección I2C del BME680 (0x76 o 0x77 según el módulo)
#define BME680_I2C_ADDR     0x76

// --- IDs de unidad en la tabla public.unidad de PostgreSQL ---
// Verificar con: SELECT id, simbolo FROM public.unidad ORDER BY id;
#define UNIDAD_ID_TEMP      3   // °C
#define UNIDAD_ID_HUM       4   // %
#define UNIDAD_ID_PRES      5   // hPa
#define UNIDAD_ID_GAS       6   // ohm

// --- Tiempos por defecto (también configurables en vivo vía Serial y NVS) ---
// Criterio del Sprint 2: captura cada 60 s y envío en lote cada 900 s (15 min).
// 24 horas * 60 muestras/hora = 1440 muestras retenidas sin red.
#define INTERVALO_CAPTURA_SEG_DEF   60U
#define INTERVALO_ENVIO_SEG_DEF     900U
#define MAX_MUESTRAS_BUFFER         1440U
#define TAMANO_LOTE_ENVIO           15U

// --- Sincronización horaria NTP (UTC) ---
#define NTP_SERVIDOR_1      "pool.ntp.org"
#define NTP_SERVIDOR_2      "time.nist.gov"
#define HTTP_TIMEOUT_MS     15000U
