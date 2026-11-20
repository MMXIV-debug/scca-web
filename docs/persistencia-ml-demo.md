# Persistencia de resultados horarios — entrega 4

Actualización del 19/11/2026: la migración `04_resultados_ml_demo.sql` ya se encuentra aplicada en la base compartida, el panel administrativo consulta estos resultados desde `/api/admin/ml/reportes` en `dashboard.html`, el trabajador automático (`procesamientoMlService.js`) persiste las horas cerradas y `ResultadosMlStore.Guardar` excluye `entrada_fuente.procedencia.consultado_en` al verificar idempotencia con Open-Meteo. Ver [ARRANQUE_ML_2026-11-19.md](ARRANQUE_ML_2026-11-19.md) y [arquitectura-apis-modelo-ml.md](arquitectura-apis-modelo-ml.md). Las referencias abajo sobre migración pendiente en nube y acceso administrativo corresponden al cierre histórico de la entrega 4.

Esta entrega guarda resultados **de demostración** y permite consultar su historial. No cambia lecturas originales, no escribe en `lectura_corregida` y no activa resultados como mediciones reales del dashboard. No genera alertas todavía.

## Migración

`db/04_resultados_ml_demo.sql` crea:

- `ml_demo_version`: UUID local del modelo, identidad de sensor/nodo, propósito, variable, horizonte y copia de los metadatos de evaluación (métricas, política, dominio, particiones y hashes).
- `ml_demo_resultado`: período de entrada, valores y cobertura empleados, hash de esa entrada y resultado de calibración/pronóstico. Mantiene los períodos objetivo en el JSON del resultado evaluado.

Son tablas aditivas. `lectura_corregida` vincula una lectura individual a `modelo_ml`, por lo que no corresponde usarla para una hora agregada ni inventar equivalencias entre los IDs enteros operacionales y los UUID de demostración. Esta migración no modifica ese diseño ni elimina datos.

Ejecutar el SQL con el propietario del esquema sobre la base de destino cuando se despliegue esta entrega. Se verificó en PostgreSQL 18 temporal local, incluida ejecución repetida. **No se aplicó a la nube.** El script concede INSERT/SELECT y uso de secuencia a `app_api` si ese rol existe; si la aplicación usa otro rol, el responsable de la base debe otorgar esos permisos mínimos. El script no incluye credenciales ni creaciones de usuarios.

Las tablas tienen triggers que impiden UPDATE/DELETE/TRUNCATE. El propietario puede alterar ese mecanismo: no constituye protección contra un administrador de base malicioso. No modificar manualmente los registros para reflejar el estado activo; son constancias de las versiones usadas, no el selector de modelos vigentes.

## Activación y compatibilidad

Por defecto, el endpoint sigue sin persistir. Tras aplicar la migración, configurar en el entorno privado de .NET:

```text
Ml__PersistenciaDemoHabilitada=true
```

Mantener también la configuración de frecuencia por sensor de la entrega 3. En la solicitud `POST /api/modelo/evaluar`, añadir opcionalmente:

```json
{
  "sensorId": 1,
  "proposito": "calibracion",
  "variable": "PM25",
  "horizonteH": 0,
  "horaInicio": "2026-11-17T11:00:00Z",
  "guardarResultado": true
}
```

Con `guardarResultado` ausente o falso, el comportamiento previo se conserva. Con true y persistencia deshabilitada responde 503 antes de consultar. Sin modelo o sin cobertura informa el estado sin guardar ni entrenar. Con `evaluado_demo` o `fuera_dominio` guarda en una transacción y añade `persistido: true`, `resultado_id` a la respuesta. Un resultado fuera de dominio conserva `valor: null`.

La versión del modelo y su resultado se insertan en la misma transacción. La versión debe conservar siempre idéntica identidad y metadatos; un conflicto rechaza el guardado sin sobrescribir. El servidor revalida sensor y catálogo antes de insertar.

La clave idempotente es versión + hora de entrada + hash de la entrada canónica (valores agregados, cobertura, intervalo y mínimo de cobertura). Reintentos concurrentes con la misma entrada devuelven el mismo ID. Si llega una lectura tardía que cambia los agregados, se conserva el resultado previo y se inserta otro. Si la misma clave produce un resultado distinto, se rechaza y conserva el primero.

El hash representa la entrada agregada, no una lista de IDs de lecturas. Esta entrega conserva evidencia del cálculo, pero no implementa trazabilidad fila por fila. Tampoco sincroniza todas las versiones pendientes/rechazadas del registro local: solo registra versiones utilizadas para resultados persistidos. Una reversión local no borra resultados históricos.

## Consulta

`GET /api/modelo/resultados?sensorId=1&despuesDe=0&limite=50`

Requiere `X-Api-Key` igual que la evaluación. `limite` admite 1..100; devuelve `items` y `siguiente_despues_de` para continuar por ID creciente. Solo incluye el sensor solicitado. Si no hay resultados devuelve lista vacía. No devuelve claves, rutas de artefactos ni archivos joblib. Si la migración falta o la base no responde, devuelve 503.

Es una ruta interna de servicio, no una ruta para llamar desde navegador con una clave embebida. Queda pendiente el acceso administrativo mediante autenticación y roles del panel.

## Metadatos internos

Las respuestas Python de estado/inferencia incorporan `modelo_metadatos`, una selección explícita sin rutas locales: versión, perfil, propósito, variable, horizonte, algoritmo, hash del artefacto/dataset, política, variables, dominio, agregado, intervalo, métricas, particiones y fecha de creación. La API los verifica y conserva como una copia del informe de evaluación.

Este historial no declara validación física ni convierte `apto_demo` en modelo operacional. Los criterios específicos de anomalías y la referencia independiente siguen pendientes.

## Pruebas reproducibles

`tests/persistencia-ml.cjs` exige una base vacía `scca_test_*`, usuario local `scca_test`, host fijo 127.0.0.1 y puerto explícito. No lee `.env`. Crea un esquema mínimo y datos exclusivamente de prueba, aplica la migración dos veces, arranca .NET en 15053 y un proveedor ML controlado en 18003; ambos procesos se cierran al terminar.

1. Crear una instancia PostgreSQL temporal y una base vacía (no usar la del proyecto).
2. Compilar con `dotnet build backend/Scca.Api/Scca.Api.csproj -o backend/Scca.Api/bin/comprobacion-persistencia`.
3. Configurar `SCCA_TEST_DATABASE` con el nombre temporal y `SCCA_TEST_PORT` con su puerto.
4. Ejecutar `node tests/persistencia-ml.cjs` y detener la instancia temporal al finalizar.

Resultado comprobado: 13 verificaciones de PostgreSQL/.NET correctas, 41 pruebas Python correctas y compilación sin errores/advertencias. Se verificaron lectura sin escritura, reintentos concurrentes, metadatos incompatibles, inmutabilidad, datos tardíos, falta de datos/modelo, paginación, aislamiento por sensor y autenticación. La nube y los servicios habituales no se modificaron; la instancia local temporal fue detenida.
