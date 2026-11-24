/*
 * SCCA - Firmware ESP32 (Sprint 2)
 *
 * Funcionalidades:
 *  - Soporte configurable para BME680 (TEMP, HUM, PRES, GAS) y DHT11 (TEMP, HUM).
 *  - Intervalos de captura (defecto 60 s) y envío en lote (defecto 900 s = 15 min)
 *    configurables por Serial y persistidos en NVS (Preferences).
 *  - Buffer circular persistente en LittleFS con capacidad para 1440 muestras
 *    (24 horas continuas sin conexión a red, sobrevive reinicios).
 *  - Identificador idMuestra monotónico persistente e idempotente: ante reenvíos,
 *    la API responde 201 (guardada/cuarentena) o 409 (duplicada) y el nodo retira
 *    la muestra confirmada sin generar duplicados en PostgreSQL.
 *
 * Comandos por Monitor Serial (115200 baudios):
 *  - STATUS            : muestra estado de red, NTP, intervalos y cola pendiente.
 *  - SET_CAP <seg>     : cambia intervalo de captura (10..3600 s) y guarda en NVS.
 *  - SET_ENV <seg>     : cambia intervalo de envío (30..3600 s) y guarda en NVS.
 *  - FLUSH             : fuerza el envío inmediato de las muestras pendientes.
 */

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <time.h>
#include "config.h"

#if defined(PERFIL_BME680)
  #include <Adafruit_Sensor.h>
  #include <Adafruit_BME680.h>
  static Adafruit_BME680 bme;
#elif defined(PERFIL_DHT11)
  #include <DHT.h>
  static DHT dht(DHT_PIN, DHT_TYPE);
#else
  #error "Define PERFIL_BME680 o PERFIL_DHT11 en config.h"
#endif

static const char* ARCHIVO_BUFFER = "/buffer_scca.bin";
static const uint32_t MAGIC_REGISTRO = 0x53434341UL; // 'SCCA'
static const int64_t EPOCH_MINIMO_VALIDO = 1704067200LL; // 2024-01-01T00:00:00Z

struct __attribute__((packed)) RegistroMuestra {
  uint32_t magic;
  uint64_t idMuestra;
  int64_t  epochUtc;
  float    temp;
  float    hum;
  float    pres;
  float    gas;
  uint32_t crc;
};

static Preferences prefs;
static uint32_t colHead = 0;
static uint32_t colCount = 0;
static uint32_t colOverflow = 0;
static uint64_t siguienteIdMuestra = 1;
static uint32_t intervaloCapturaSeg = INTERVALO_CAPTURA_SEG_DEF;
static uint32_t intervaloEnvioSeg = INTERVALO_ENVIO_SEG_DEF;

static unsigned long ultimaCapturaMs = 0;
static unsigned long ultimoEnvioMs = 0;
static unsigned long ultimoIntentoWifiMs = 0;
static bool relojSincronizado = false;

static uint32_t calcularCrc(const RegistroMuestra& r) {
  const uint8_t* p = reinterpret_cast<const uint8_t*>(&r);
  size_t len = sizeof(RegistroMuestra) - sizeof(uint32_t);
  uint32_t crc = 0xFFFFFFFFUL;
  for (size_t i = 0; i < len; ++i) {
    crc ^= p[i];
    for (int b = 0; b < 8; ++b) {
      crc = (crc & 1) ? ((crc >> 1) ^ 0xEDB88320UL) : (crc >> 1);
    }
  }
  return ~crc;
}

static void guardarEstadoCola() {
  prefs.putUInt("head", colHead);
  prefs.putUInt("count", colCount);
  prefs.putUInt("ovf", colOverflow);
  prefs.putULong64("next_id", siguienteIdMuestra);
}

static void asegurarArchivoBuffer() {
  if (!LittleFS.exists(ARCHIVO_BUFFER)) {
    File f = LittleFS.open(ARCHIVO_BUFFER, "w");
    if (f) f.close();
  }
}

static bool escribirSlot(uint32_t indice, const RegistroMuestra& reg) {
  File f = LittleFS.open(ARCHIVO_BUFFER, "r+");
  if (!f) f = LittleFS.open(ARCHIVO_BUFFER, "w+");
  if (!f) return false;
  size_t pos = static_cast<size_t>(indice) * sizeof(RegistroMuestra);
  if (!f.seek(pos)) { f.close(); return false; }
  size_t escritos = f.write(reinterpret_cast<const uint8_t*>(&reg), sizeof(RegistroMuestra));
  f.flush();
  f.close();
  return escritos == sizeof(RegistroMuestra);
}

static bool leerSlot(uint32_t indice, RegistroMuestra& reg) {
  File f = LittleFS.open(ARCHIVO_BUFFER, "r");
  if (!f) return false;
  size_t pos = static_cast<size_t>(indice) * sizeof(RegistroMuestra);
  if (!f.seek(pos)) { f.close(); return false; }
  size_t leidos = f.read(reinterpret_cast<uint8_t*>(&reg), sizeof(RegistroMuestra));
  f.close();
  if (leidos != sizeof(RegistroMuestra)) return false;
  return reg.magic == MAGIC_REGISTRO && reg.crc == calcularCrc(reg);
}

static bool encolarMuestra(const RegistroMuestra& reg) {
  uint32_t destino;
  if (colCount < MAX_MUESTRAS_BUFFER) {
    destino = (colHead + colCount) % MAX_MUESTRAS_BUFFER;
    if (!escribirSlot(destino, reg)) return false;
    colCount++;
  } else {
    // Buffer lleno (24 h completas sin conexión): sobrescribe la más antigua.
    destino = colHead;
    if (!escribirSlot(destino, reg)) return false;
    colHead = (colHead + 1) % MAX_MUESTRAS_BUFFER;
    colOverflow++;
  }
  guardarEstadoCola();
  return true;
}

static void desencolarUno() {
  if (colCount == 0) return;
  colHead = (colHead + 1) % MAX_MUESTRAS_BUFFER;
  colCount--;
  guardarEstadoCola();
}

static void formatearIsoUtc(int64_t epochUtc, char* salida, size_t tam) {
  time_t t = static_cast<time_t>(epochUtc);
  struct tm tmUtc;
  gmtime_r(&t, &tmUtc);
  strftime(salida, tam, "%Y-%m-%dT%H:%M:%SZ", &tmUtc);
}

static void conectarWifiYNtp() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!relojSincronizado) {
      time_t ahora = time(nullptr);
      if (ahora >= EPOCH_MINIMO_VALIDO) {
        relojSincronizado = true;
        Serial.println("[NTP] Hora UTC sincronizada.");
      }
    }
    return;
  }
  unsigned long ahoraMs = millis();
  if (ahoraMs - ultimoIntentoWifiMs < 15000UL && ultimoIntentoWifiMs != 0) return;
  ultimoIntentoWifiMs = ahoraMs;

  Serial.printf("[WiFi] Conectando a %s...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < 8000UL) {
    delay(250);
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WiFi] Conectado. IP: %s\n", WiFi.localIP().toString().c_str());
    configTime(0, 0, NTP_SERVIDOR_1, NTP_SERVIDOR_2);
    for (int i = 0; i < 20; ++i) {
      if (time(nullptr) >= EPOCH_MINIMO_VALIDO) {
        relojSincronizado = true;
        Serial.println("[NTP] Hora UTC sincronizada.");
        break;
      }
      delay(250);
    }
  } else {
    Serial.println("[WiFi] Sin conexión. Las capturas se conservarán en LittleFS.");
  }
}

static bool leerSensor(RegistroMuestra& reg) {
  memset(&reg, 0, sizeof(reg));
  reg.magic = MAGIC_REGISTRO;

  time_t ahora = time(nullptr);
  if (ahora < EPOCH_MINIMO_VALIDO) {
    Serial.println("[CAPTURA] Esperando sincronización NTP inicial antes de registrar muestra.");
    return false;
  }
  reg.epochUtc = static_cast<int64_t>(ahora);

#if defined(PERFIL_BME680)
  if (!bme.performReading()) {
    Serial.println("[BME680] Error leyendo el sensor.");
    return false;
  }
  reg.temp = bme.temperature;
  reg.hum  = bme.humidity;
  reg.pres = bme.pressure / 100.0f;      // Pa -> hPa
  reg.gas  = static_cast<float>(bme.gas_resistance); // ohm
#elif defined(PERFIL_DHT11)
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (isnan(t) || isnan(h)) {
    Serial.println("[DHT11] Lectura NaN ignorada.");
    return false;
  }
  reg.temp = t;
  reg.hum  = h;
  reg.pres = 0.0f;
  reg.gas  = 0.0f;
#endif

  // idMuestra monotónico único persistido en NVS para reenvío idempotente sin duplicados.
  uint64_t candidato = static_cast<uint64_t>(reg.epochUtc) * 1000ULL;
  if (candidato <= siguienteIdMuestra) candidato = siguienteIdMuestra + 1ULL;
  reg.idMuestra = candidato;
  siguienteIdMuestra = candidato;
  reg.crc = calcularCrc(reg);
  return true;
}

static bool enviarLotePendiente() {
  if (colCount == 0 || WiFi.status() != WL_CONNECTED) return false;

  uint32_t cantidad = colCount < TAMANO_LOTE_ENVIO ? colCount : TAMANO_LOTE_ENVIO;
  JsonDocument doc;
  JsonArray muestras = doc["muestras"].to<JsonArray>();

  uint32_t validasEnLote = 0;
  for (uint32_t i = 0; i < cantidad; ++i) {
    uint32_t slot = (colHead + i) % MAX_MUESTRAS_BUFFER;
    RegistroMuestra reg;
    if (!leerSlot(slot, reg)) {
      Serial.printf("[BUFFER] Registro corrupto en slot %u; se descartará al avanzar.\n", slot);
      if (i == 0) { desencolarUno(); return true; }
      break;
    }
    char fechaIso[32];
    formatearIsoUtc(reg.epochUtc, fechaIso, sizeof(fechaIso));

    JsonObject m = muestras.add<JsonObject>();
    m["sensorId"] = SENSOR_ID;
    m["idMuestra"] = reg.idMuestra;
    m["medidoEn"] = fechaIso;

    JsonArray lecturas = m["lecturas"].to<JsonArray>();
    auto agregar = [&](const char* codigo, int unidadId, float valor) {
      JsonObject l = lecturas.add<JsonObject>();
      l["variableCodigo"] = codigo;
      l["unidadId"] = unidadId;
      l["valor"] = roundf(valor * 10000.0f) / 10000.0f;
    };
    agregar("TEMP", UNIDAD_ID_TEMP, reg.temp);
    agregar("HUM",  UNIDAD_ID_HUM,  reg.hum);
#if defined(PERFIL_BME680)
    agregar("PRES", UNIDAD_ID_PRES, reg.pres);
    agregar("GAS",  UNIDAD_ID_GAS,  reg.gas);
#endif
    validasEnLote++;
  }

  if (validasEnLote == 0) return false;

  String payload;
  serializeJson(doc, payload);

  HTTPClient http;
  String url = String(API_BASE_URL) + String(API_ENDPOINT_LOTE);
  http.begin(url);
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Api-Key", API_KEY_IOT);

  int httpCode = http.POST(payload);
  String respuesta = http.getString();
  http.end();

  if (httpCode != 200) {
    Serial.printf("[ENVIO] Fallo HTTP %d (%u pendientes conservadas).\n", httpCode, colCount);
    return false;
  }

  JsonDocument resDoc;
  if (deserializeJson(resDoc, respuesta)) {
    Serial.println("[ENVIO] Respuesta JSON inválida; se reintentará el lote.");
    return false;
  }

  JsonArray resultados = resDoc["resultados"].as<JsonArray>();
  uint32_t confirmadas = 0;
  for (JsonObject item : resultados) {
    int st = item["statusCode"] | 500;
    // 201 = guardada/cuarentena, 409 = duplicada ya recibida, 400/422 = error permanente de esquema.
    // Solo 5xx conserva la muestra en cola para reintentar después.
    if (st == 201 || st == 409 || st == 400 || st == 422) {
      desencolarUno();
      confirmadas++;
    } else {
      break;
    }
  }

  Serial.printf("[ENVIO] Lote OK: confirmadas=%u (guardadas=%d, cuarentena=%d, duplicadas=%d). Pendientes=%u\n",
                confirmadas,
                resDoc["guardadas"] | 0,
                resDoc["cuarentena"] | 0,
                resDoc["duplicadas"] | 0,
                colCount);
  return confirmadas > 0;
}

static void drenarCola() {
  // Al reconectar tras horas sin red, vacía en tandas sin bloquear capturas futuras.
  for (int tandas = 0; tandas < 10 && colCount > 0 && WiFi.status() == WL_CONNECTED; ++tandas) {
    if (!enviarLotePendiente()) break;
    delay(200);
  }
}

static void procesarComandosSerial() {
  if (!Serial.available()) return;
  String linea = Serial.readStringUntil('\n');
  linea.trim();
  if (linea.equalsIgnoreCase("STATUS")) {
    Serial.printf("[STATUS] WiFi=%s NTP=%s Captura=%us Envio=%us Cola=%u/%u Overflow=%u NextID=%llu\n",
                  WiFi.status() == WL_CONNECTED ? "OK" : "OFFLINE",
                  relojSincronizado ? "OK" : "PENDIENTE",
                  intervaloCapturaSeg, intervaloEnvioSeg,
                  colCount, MAX_MUESTRAS_BUFFER, colOverflow,
                  static_cast<unsigned long long>(siguienteIdMuestra));
  } else if (linea.startsWith("SET_CAP ")) {
    uint32_t v = linea.substring(8).toInt();
    if (v >= 10 && v <= 3600) {
      intervaloCapturaSeg = v;
      prefs.putUInt("cap_seg", intervaloCapturaSeg);
      Serial.printf("[CONFIG] Captura configurada a %u s.\n", intervaloCapturaSeg);
    } else {
      Serial.println("[CONFIG] Rango válido para SET_CAP: 10..3600 s.");
    }
  } else if (linea.startsWith("SET_ENV ")) {
    uint32_t v = linea.substring(8).toInt();
    if (v >= 30 && v <= 3600) {
      intervaloEnvioSeg = v;
      prefs.putUInt("env_seg", intervaloEnvioSeg);
      Serial.printf("[CONFIG] Envío en lote configurado a %u s.\n", intervaloEnvioSeg);
    } else {
      Serial.println("[CONFIG] Rango válido para SET_ENV: 30..3600 s.");
    }
  } else if (linea.equalsIgnoreCase("FLUSH")) {
    conectarWifiYNtp();
    drenarCola();
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== SCCA ESP32 — Inicio ===");

  if (!LittleFS.begin(true)) {
    Serial.println("[ERROR] No se pudo montar LittleFS.");
  }
  asegurarArchivoBuffer();

  prefs.begin("scca_nodo", false);
  colHead = prefs.getUInt("head", 0) % MAX_MUESTRAS_BUFFER;
  colCount = min(prefs.getUInt("count", 0), static_cast<uint32_t>(MAX_MUESTRAS_BUFFER));
  colOverflow = prefs.getUInt("ovf", 0);
  siguienteIdMuestra = prefs.getULong64("next_id", 1);
  intervaloCapturaSeg = prefs.getUInt("cap_seg", INTERVALO_CAPTURA_SEG_DEF);
  intervaloEnvioSeg = prefs.getUInt("env_seg", INTERVALO_ENVIO_SEG_DEF);

#if defined(PERFIL_BME680)
  Wire.begin();
  if (!bme.begin(BME680_I2C_ADDR)) {
    Serial.println("[ERROR] No se detectó el BME680 en I2C. Verifica cableado y dirección (0x76/0x77).");
  } else {
    bme.setTemperatureOversampling(BME680_OS_8X);
    bme.setHumidityOversampling(BME680_OS_2X);
    bme.setPressureOversampling(BME680_OS_4X);
    bme.setIIRFilterSize(BME680_FILTER_SIZE_3);
    bme.setGasHeater(320, 150);
    Serial.println("[BME680] Inicializado correctamente.");
  }
#elif defined(PERFIL_DHT11)
  dht.begin();
  Serial.println("[DHT11] Inicializado correctamente.");
#endif

  conectarWifiYNtp();
  Serial.printf("[INIT] Cola recuperada: %u/%u muestras. Captura=%us, Envío=%us.\n",
                colCount, MAX_MUESTRAS_BUFFER, intervaloCapturaSeg, intervaloEnvioSeg);
}

void loop() {
  procesarComandosSerial();
  conectarWifiYNtp();

  unsigned long ahoraMs = millis();
  if (ultimaCapturaMs == 0 || ahoraMs - ultimaCapturaMs >= intervaloCapturaSeg * 1000UL) {
    ultimaCapturaMs = ahoraMs;
    RegistroMuestra reg;
    if (leerSensor(reg)) {
      if (encolarMuestra(reg)) {
        Serial.printf("[CAPTURA] idMuestra=%llu T=%.2f H=%.2f P=%.2f G=%.0f (cola=%u/%u)\n",
                      static_cast<unsigned long long>(reg.idMuestra),
                      reg.temp, reg.hum, reg.pres, reg.gas, colCount, MAX_MUESTRAS_BUFFER);
      } else {
        Serial.println("[ERROR] No se pudo escribir la muestra en LittleFS.");
      }
    }
  }

  if (colCount > 0 && (ultimoEnvioMs == 0 || ahoraMs - ultimoEnvioMs >= intervaloEnvioSeg * 1000UL)) {
    ultimoEnvioMs = ahoraMs;
    drenarCola();
  }

  delay(100);
}
