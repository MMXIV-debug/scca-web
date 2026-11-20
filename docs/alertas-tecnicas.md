# Alertas técnicas por falta de recepción

Actualización del 19/11/2026: la migración `06_alertas_tecnicas.sql` ya está aplicada en la base compartida, el umbral usa `politica_ml` cuando `ML_POLITICA_VERSIONADA=true` (junto con `factor_sin_datos` e `intervalos_sensor`), la gestión se integró en `dashboard.html#seccion-alertas` (`/alertas.html` redirige allí), el visualizador consulta avisos vía `GET /api/visualizador/alertas` y las alertas ambientales/predictivas se implementaron en `services/alertasAmbientalesService.js`. Ver [CORRECCIONES_2026-11-19.md](CORRECCIONES_2026-11-19.md) y [arquitectura-apis-modelo-ml.md](arquitectura-apis-modelo-ml.md). El cuerpo siguiente conserva las notas históricas de la entrega inicial.

Entrega local. Usa las tablas existentes `alerta` y `auditoria_evento`. No cambia el estado administrativo de nodo ni decide que el hardware está averiado. No implementa todavía umbrales ambientales EPA ni alertas predictivas.

## Preparación local

1. Aplicar `db/06_alertas_tecnicas.sql` en la base local. Añade un índice único parcial para una alerta abierta/atendida por sensor y nodo. Si hay duplicados previos, falla sin eliminarlos.
2. Configurar en el proceso Node `ALERTAS_TECNICAS_HABILITADAS=true` para permitir creación/atención/resolución. Sin esa opción, las escrituras de este módulo están deshabilitadas.
3. Elegir `ALERTAS_SIN_DATOS_S` según la frecuencia real y margen de tolerancia. El valor predeterminado es 300 s conforme al antecedente del proyecto, **pero no es apropiado para el simulador que envía cada 900 s**. En una prueba conjunta puede usarse 1800 s; ese umbral se aplica a todos los sensores y retrasará también las alertas DHT11. La política por perfil/sensor queda pendiente. El rango admitido es 60..604800 s.
4. Opcional: `ALERTAS_TECNICAS_AUTO=true` ejecuta una comprobación cada 60 s mientras Node esté funcionando. Requiere además la habilitación anterior. Primera comprobación tras 60 s; no funciona con el servidor detenido. No sustituye la programación semanal de entrenamiento.
5. Abrir `/alertas.html` desde el enlace «Alertas» exclusivo del dashboard administrador.

No se ha habilitado el módulo en nube ni aplicado allí su migración. No ejecutar el monitor con la conexión compartida hasta autorización explícita.

## Criterio

Se evalúa cada sensor activo de un nodo que no esté inactivo o en mantenimiento. Usa el instante más reciente entre alta del sensor, recepción en lectura_original y recepción de una muestra identificada en lectura_cuarentena. Usa **recibido_en**, no la hora que declara el ESP32. Esto detecta falta de comunicación, no antigüedad de la medición ni calidad de los valores.

Un simulador del mismo nodo no cuenta como recepción del DHT11. Un sensor recién dado de alta tiene el período de gracia correspondiente al umbral. Una muestra en cuarentena prueba recepción, pero no se restaura ni valida automáticamente.

Tras superar el umbral se crea una alerta `tecnica`, con regla `SCCA_SIN_DATOS_SENSOR_ID`, comienzo de la interrupción y explicación. Mientras esté abierta o atendida no se crean duplicados, incluso con comprobaciones concurrentes. Una recuperación resuelve la alerta y registra auditoría. Si el sensor/nodo sale de supervisión, se resuelve con ese motivo específico, sin afirmar que recuperó comunicación. Una nueva interrupción posterior genera una alerta nueva.

La cuenta que recibe datos es la fuente de identidad ya usada por ingesta: mensajes de cuarentena que no tengan un sensorId coincidente no cuentan como comunicación de otro sensor.

## API administrativa Node

- `GET /api/admin/alertas?estado=abierta&despuesDe=0&limite=50`: estados abierta/atendida/resuelta/todas; límite 1..100. Lista las alertas existentes de cualquier tipo; este módulo solo **genera** las técnicas descritas.
- `POST /api/admin/alertas/comprobar`, cuerpo `{}`: aplica la comprobación; devuelve abiertas/resueltas/sensores_comprobados/umbral_s.
- `POST /api/admin/alertas/:id/atender`, cuerpo `{"motivo":"Descripción de la intervención"}`: motivo 10..1000 caracteres, registra administrador y fecha. Repetir la misma atención por la misma persona y motivo es idempotente; una decisión incompatible devuelve 409.

Requieren JWT y Administrador mediante los middleware actuales; las escrituras manuales revalidan permisos en la transacción. El monitor automático registra identidad de servicio `servicio_ml`. No se usa la clave IoT en frontend. Una atención no equivale a resolución; las alertas técnicas se resuelven por recuperación/salida de supervisión. No se implementó resolución manual de alertas ambientales.

## Pantalla y pruebas

La pantalla permite filtrar, paginar, comprobar inactividad manualmente y registrar atención. Presenta texto mediante textContent y textarea. No modifica el visualizador, no envía correos, ni muestra un banner ambiental. Esas integraciones siguen pendientes. No se realizó verificación visual automatizada del navegador en esta entrega.

`tests/alertas-tecnicas.cjs` usa exclusivamente PostgreSQL local vacío `scca_test_*`, `SCCA_TEST_PORT` y usuario de prueba `scca_test`. No carga `.env`. Se verificaron dos sensores del mismo nodo con actividad diferente, gracia inicial, concurrencia, no duplicación, roles, atención repetida, recuperación por cuarentena, nuevo episodio, mantenimiento, umbral inválido y auditoría. La instancia temporal se detuvo al terminar.
