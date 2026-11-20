# Inferencia versionada — entrega 3

Actualización del 19/11/2026: la persistencia horaria (`guardarResultado`), las rutas añadidas (`/api/v2/modelos/muestra`, `/registro`, `/revertir`, `/inferir-fuente`), la lectura de política versionada (`politica_ml`), la política de arranque `arranque_demo` y la integración con el panel están descritas en [CORRECCIONES_2026-11-19.md](CORRECCIONES_2026-11-19.md), [ARRANQUE_ML_2026-11-19.md](ARRANQUE_ML_2026-11-19.md) y [arquitectura-apis-modelo-ml.md](arquitectura-apis-modelo-ml.md). Las notas de «Lo que todavía falta» de este documento son históricas de la entrega 3.

Conecta el registro local de demostración con Python y ofrece una consulta desde .NET. **No persiste correcciones, pronósticos ni alertas.** Las lecturas originales permanecen intactas. La ingesta ESP32 y el simulador conservan su contrato actual.

## Endpoint de .NET

`POST /api/modelo/evaluar`, cabecera `X-Api-Key` con la misma configuración privada `Iot:ApiKey` utilizada por la API.

```json
{
  "sensorId": 2,
  "proposito": "calibracion",
  "variable": "TEMP",
  "horizonteH": 0,
  "horaInicio": "2026-11-17T11:00:00Z"
}
```

Propósitos: `calibracion`, `pronostico`, `anomalias`. Pronóstico requiere horizonte 1/3/6; los demás 0. La hora debe estar alineada a UTC y completamente cerrada. El ejemplo no garantiza que ese sensor disponga de modelo: `sin_modelo` es la respuesta esperada cuando no existe uno apto.

El cliente no envía valores, nodo ni perfil. La API deriva identidad y catálogo desde PostgreSQL, verifica unidades y calcula promedios horarios de lecturas válidas del sensor seleccionado. Primero promedia dentro de cada intervalo y después entre intervalos, como el preparador de datasets. Requiere la cobertura definida por el modelo (mínimo 75%). Toda la consulta de base usa una transacción de solo lectura.

La frecuencia debe coincidir con la usada para entrenar. Para simuladores se exige configurar `Ml:IntervalosSensor:ID` (variable de entorno equivalente: `Ml__IntervalosSensor__1`, valor 900 para el sensor 1 si realmente muestreó cada 15 minutos). Para sensores físicos usa `nodo.intervalo_muestreo_s`, salvo configuración explícita por sensor. No inferir frecuencia desde huecos. Si el historial cambió de frecuencia, consultar solo períodos cuya frecuencia se conozca y coincida.

## Respuestas

| HTTP / estado | Significado |
|---|---|
| 200 / `sin_modelo` | No hay modelo activo para esa identidad, propósito y variable/horizonte. `valor` y `es_anomalia` son null. |
| 200 / `datos_incompletos` | La hora no alcanza cobertura suficiente; incluye cobertura por variable. No calcula ni rellena resultados. |
| 200 / `fuera_dominio` | La entrada excede el dominio de entrenamiento. No extrapola una corrección. |
| 200 / `evaluado_demo` | Resultado con unidad, versión del modelo y períodos de entrada/objetivo. Siempre ámbito demostración. |
| 400 | Hora o horizonte inválidos. |
| 401 | Credencial ausente o incorrecta. |
| 404 | Sensor inexistente o inactivo. |
| 409 | El modelo cambió entre consultar estado y ejecutar. Reintentar recalcula la entrada. |
| 422 | Variable, catálogo, unidades, intervalo o entrada incompatible. |
| 502/503 | Contrato de respuesta, registro, artefacto, configuración o dependencia no disponible. Sin resultado inventado. |

El DTO de solicitud .NET usa camelCase. La respuesta ML conserva snake_case, incluyendo `modelo_version`, `sensor_id`, `nodo_id`, `calibracion_fisica_validada`. No interpretar `es_anomalia: null` como `false`: no hubo evaluación de anomalías.

No hay aún modelos de anomalías aprobados por perfiles; consultar ese propósito normalmente devuelve `sin_modelo`. El detector legado para contaminantes sigue funcionando por sus rutas anteriores, sin pasar el DHT11/BME680 por él en esta consulta.

## Rutas internas de Python

- `POST /api/v2/modelos/estado`: identidad `nodo_id`, `sensor_id`, `perfil`, `proposito`, `variable`, `horizonte_h`.
- `POST /api/v2/modelos/inferir`: lo anterior más `modelo_version`, `valores`, `periodo_inicio` y `periodo_fin`.

Ambas requieren `X-Api-Key`. Python toma la credencial de `Iot__ApiKey` o `IOT_API_KEY`; no se guarda en código ni en Git. Configurar el mismo secreto en los dos procesos por canales privados. No publicar estas rutas internas sin control de red ni trasladar esta clave al JavaScript del navegador. La integración posterior con el panel debe pasar por autenticación y permisos de servidor.

Python lee `ML_REGISTRO_DIR` si existe; por defecto `ml_engine/registro_modelos_demo`. Cada solicitud consulta la referencia activa, de modo que una promoción o reversión se observa sin reiniciar. Comprueba identidad, perfil, propósito, horizonte, estado, dominio, columnas y SHA-256 del artefacto antes de ejecutarlo. No hace fallback al modelo de otro sensor ni a los archivos legados.

Las nuevas versiones generadas por el entrenador incluyen `entrada_agregado_s=3600` e `intervalo_s`. Un artefacto antiguo sin ese contrato temporal se rechaza; no asumir que admite muestras instantáneas. No editar hashes/metadatos manualmente para forzarlo ni reutilizar una prueba final consumida para reevaluarlo.

## Lo que todavía falta

- Integración operacional y persistencia de modelo/validación/corrección/pronóstico en PostgreSQL.
- Generación de alertas persistidas y administración de cuarentena.
- Selector de anomalías por perfil con evaluación propia.
- Presentación y permisos del panel administrativo.

La salida de demostración no se muestra automáticamente como un dato corregido real del dashboard. El límite anterior evita atribuir validez física a la referencia modelada compartida con el simulador.

## Verificación

41 pruebas Python correctas, incluyendo contratos ASGI autenticados, aislamiento por sensor, integridad, fuera de dominio y cambio de versión. Compilación .NET sin errores ni advertencias. Prueba HTTP en puertos temporales con la base en solo lectura: rutas legacy, 401, sensor inexistente, perfil incorrecto, horizonte inválido, DHT11 sin modelo y agregación SQL con cobertura insuficiente. Para verificar esta última rama se usó un proveedor ML de prueba que anunciaba un modelo; no se activó un modelo sintético en el servicio habitual.

No se escribieron registros en PostgreSQL ni se reiniciaron los servicios habituales durante estas pruebas. Los procesos de prueba fueron cerrados al terminar. En Windows restringido, asyncio puede necesitar permisos para su socket interno incluso en las pruebas ASGI sin servidor HTTP público.
