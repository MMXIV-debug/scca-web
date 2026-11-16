# Comparación de versiones: 04/11 y 16/11 de 2026

Base local anterior: `459b521`. Versión recibida el 16/11: `53df73b`.

Al consultar GitHub el 16/11, `origin/main` ya coincidía con `53df73b`. Por eso las funcionalidades recibidas no requieren volver a publicarse ni duplicar commits existentes.

## Cambios del equipo ya presentes en GitHub

- Nuevos servicios de usuarios, validación de estados, estrategias de corrección y eventos de lecturas.
- Reorganización de `server.js` para delegar operaciones de usuarios.
- Adaptador Open-Meteo y actualización del proceso de captura Python.
- Incorporación de conexión, entrenamiento e inferencia en `ml_engine`.
- Actualización de la visualización del panel.

La comparación del código, excluyendo dependencias instaladas, configuración privada, cachés y modelos binarios, mostró 13 archivos modificados o añadidos, con 639 inserciones y 371 eliminaciones.

## Mantenimiento posterior a la comparación

Los commits posteriores separan mejoras de configuración del repositorio, exclusión de dependencias y cachés, arranque con npm, declaración de dependencias Python e instrucciones de uso. No recrean ni atribuyen a otro autor las funcionalidades previamente publicadas por el equipo.

Se conserva `.env` por decisión explícita de la propietaria para el repositorio privado. Los archivos instalados y las cachés permanecen en la carpeta local, pero dejan de formar parte de Git.

## Alcance de la revisión

La comparación y la comprobación de sintaxis no demuestran funcionamiento completo de ML, alertas o calidad ambiental. No se ejecutaron capturadores ni migraciones sobre la base de datos.
