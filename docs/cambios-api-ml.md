# Bitácora de integración API ↔ ML

Se actualiza por cada entrega. Distingue cambios aplicados de propuestas; no sustituye la revisión del responsable de API.

## Entrega 1 — 18/11/2026: datasets y referencia

**Balance:** 0 endpoints modificados, 0 DTO modificados, 0 migraciones ejecutadas, 1 cambio de configuración interna aplicado y 3 asuntos de contrato pendientes. Publicación preparada en rama `Machine-Learning`, separada de main.

### Aplicado: ML-001 — conexión de Python a la misma base configurada

- Archivo: `ml_engine/base_datos.py`.
- Antes: conexión fija a PostgreSQL local, independiente del `.env` usado por el sistema.
- Ahora: lee `DATABASE_URL` del entorno o del `.env` raíz; el entorno tiene prioridad. Adapta esquema PostgreSQL a SQLAlchemy/psycopg2 y usa tiempo límite de conexión.
- API .NET y Node: no necesitan cambiar rutas ni cuerpos de solicitudes. Revisar que los procesos compartan el destino previsto; no copiar credenciales en los mensajes del equipo.
- También afecta al entrenador existente porque importa este módulo. Ese entrenador sigue siendo legado y no incorpora validación/promoción ni consume automáticamente los nuevos datasets. No ejecutarlo para activar modelos durante esta etapa.

### Aplicado: ML-002 — preparación sin cambios HTTP

- Nuevo comando `ml_engine/preparar_datasets.py` y módulos `datasets.py`, `referencias.py`.
- Lee sensor/nodo/sitio/catálogos/lecturas con parámetros SQL y transacción de solo lectura. No llama a POST /api/lecturas.
- Produce archivos separados por nodo, sensor y perfil; exporta cobertura, objetivos temporales y referencia modelada con procedencia y hashes.
- No escribe `referencia_lectura`, no necesita migraciones y no cambia los `.joblib` cargados por FastAPI. La referencia queda local en esta etapa.
- La API actual sigue recibiendo el mismo payload. El frontend y firmware no requieren cambios para esta entrega.

### Pendiente API-001 — perfil BME680 y catálogo

El preparador reserva el perfil BME680 con TEMP (°C), HUM (%), PRES (hPa), GAS (ohm). **PRES/GAS son convenciones locales propuestas**, no un contrato HTTP ya implantado ni un catálogo creado en nube. Confirmarlas con el responsable de API antes de registrar hardware/firmware. GAS representa resistencia, no concentración de VOC.

El endpoint ML actual sigue exigiendo las cuatro variables de contaminantes. Este trabajo NO habilita todavía la inferencia BME680 ni cambia el bypass del DHT11. El futuro selector de modelos necesitará perfil y una identidad confiable de sensor/nodo obtenida desde la base por la API.

### Pendiente API-002 — frecuencia histórica por sensor

Actualmente existe `nodo.intervalo_muestreo_s`; el simulador puede usar 900 s mientras el nodo declara 60 s. Para esta entrega se exige `--intervalo-s` explícito en perfiles simulados, sin tocar la base. A futuro se necesita frecuencia efectiva versionada por sensor para calcular cobertura histórica correctamente. No adoptar un intervalo nuevo sobre todo el historial sin conocer sus cambios.

### Pendiente API-003 — procedencia persistida

El catálogo distingue real/simulado, pero las lecturas no documentan fuente externa, hora del proveedor, consulta ni coordenada de grilla. El simulador actual usa Open-Meteo; una comparación contra la misma fuente no es independiente. Antes de persistir referencias en nube, acordar la migración para esa procedencia, naturaleza modelada, unidades y vínculo a sitio. Hasta entonces los archivos locales preservan esa información y marcan `validacion_independiente=false`.

## Pruebas de entrega

- 10 pruebas unitarias correctas: cobertura, huecos, reenvíos, calidad, ausencia de humedad, unidades de referencia, fechas con zona, separación de perfiles y horizontes reales.
- Consulta real de sensores 1 y 2 del nodo 1, rango UTC [17/11/2026,18/11/2026): 4 filas de contaminantes y 36 de DHT11, en carpetas separadas. Cero horas con cobertura suficiente en ese rango; no se rellenaron.
- Descarga Open-Meteo/CAMS exitosa con respuesta original y metadatos locales; no se fabricó PM1 de referencia.
- No se ejecutó entrenamiento, activación, migración ni escritura de lecturas para estas pruebas.

## Mensaje para el responsable de API

«Añadimos preparación ML por nodo/sensor/perfil y referencias Open-Meteo solo para demostración. No cambiamos endpoints, DTO ni tablas. Python ahora usa DATABASE_URL del entorno/.env en lugar de una conexión local fija. Tenemos pendientes de coordinar los códigos PRES/GAS del BME680, la frecuencia histórica por sensor y la procedencia de referencias. La inferencia por perfiles y la promoción de modelos todavía no están implementadas; el contrato de ingesta actual sigue igual.»

## Protección de secretos para publicación

Por instrucción del usuario, se excluyen todos los archivos de entorno (incluidos ejemplos), claves y respaldos. Se retiran del árbol versionado `.env`, `.env.example` y el respaldo `db/sistema_calidad_aire.sql`. Se conservan localmente. No se ha reescrito el historial remoto ni se han cambiado credenciales; archivos presentes en commits anteriores siguen existiendo allí. Los integrantes deben mantener su configuración local y compartir secretos por un canal privado. Las migraciones de esquema se conservan.
