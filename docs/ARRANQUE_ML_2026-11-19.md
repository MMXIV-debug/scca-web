# Estado de arranque ML — 19/11/2026

Esta actualización sustituye los requisitos iniciales de espera de 30 días para el modo de demostración autorizado. No declara precisión del 100 % ni calibración física validada.

- Política de nube vigente: versión 4, `configuracion.arranque_demo=true`, mínimo 24 pares y 1 día para evaluación horaria; ventana de preparación de dos días. Se conservan cobertura 75 %, prueba temporal 30 % y criterios de mejora para modelos aprendidos.
- Anomalías de arranque: Isolation Forest por perfil, desde 8 muestras completas distintas, sin exigir etiquetas ni una duración mínima. Se registra `arranque_no_supervisado`, sin inventar precisión/recall. Una lectura inusual no confirma fallo del sensor. El modo con etiquetas y sus pruebas sigue disponible al desactivar el arranque.
- Contaminantes: se utiliza historial horario real del proveedor Open-Meteo/CAMS, guardado en archivos separados con procedencia y SHA-256; no se inserta como lectura original del nodo. PM1 se identifica como estimación de 70 % de PM2.5.
- Pronósticos: comparación temporal de candidatos sencillos y persistencia a 1, 3 y 6 horas. Si no se demuestra mejora, el respaldo de persistencia se identifica explícitamente y no se presenta como mejora aprendida. La prueba final consumida sigue protegida y se conservan versiones anteriores.
- Si la recepción local de contaminantes no completa una hora, el pronóstico de arranque puede consultar la hora cerrada del proveedor para el sitio del modelo. La ruta interna requiere autenticación, modelo vigente, perfil compatible y periodo válido. La procedencia y valores usados quedan en el resultado; no se rellenan huecos de las series originales. Una caída del proveedor devuelve indisponibilidad.
- El simulador usa las coordenadas del sitio del sensor; una configuración distinta se rechaza. La trazabilidad nueva de muestras incluye la procedencia por variable.
- En esta instalación se habilitó `ML_ARRANQUE_DEMO=true`: el trabajador comprueba cada cinco minutos si corresponde recuperar un ciclo de la última hora, con bloqueo y espera entre intentos. La tarea de Windows instalada conserva su invocación.

## Evidencia

El ciclo real terminó sin errores: 11 candidatos, 5 activos de demostración. Se ajustaron detectores para contaminantes (48 observaciones horarias del proveedor) y DHT11 (18 capturas originales). Los tres pronósticos activos son respaldos de persistencia, sin mejora demostrada. Las calibraciones siguen pendientes según sus datos/referencias.

La consulta a la nube encontró dos sensores registrados: simulador y DHT11. No hay BME680 registrado todavía; la recepción y el ajuste para su perfil se probaron con datos temporales locales. Al registrar el equipo y reunir las muestras mínimas, el ciclo lo incluirá. No se inventaron capturas físicas.

La ejecución real generó y persistió los tres pronósticos de la última hora cerrada. Repetir el procesamiento devolvió los mismos IDs: idempotencia verificada. El detector DHT11 respondió usando sus últimas lecturas almacenadas, sin insertarlas de nuevo. Una captura ordinaria de Open-Meteo recorrió ingesta y cuarentena con trazabilidad.

Pruebas: 51 Python y 4 Node correctas; 19 comprobaciones integradas sobre PostgreSQL local correctas; pruebas adicionales de caída de fuente e inferencia de arranque correctas. Compilación .NET: 0 errores y 0 advertencias. Las pruebas sintéticas permanecen fuera de la nube.

Respaldo anterior a la activación: `C:\Users\ykira\scca-web_backup\arranque-20261119`, con dump PostgreSQL, configuración y registro de modelos. Se conserva también el respaldo anterior a las correcciones. No se creó commit ni se publicaron credenciales.

Inicio habitual: `npm.cmd start`. La alerta ambiental PM2.5 a 24 horas conserva su umbral y cobertura; las series originales no usan los datos externos de entrenamiento para ocultar huecos.
