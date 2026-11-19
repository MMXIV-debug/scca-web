# Revisión administrativa de cuarentena

Entrega local: listado, decisiones definitivas y pantalla administrativa. No altera el detector ni genera alertas. Una anomalía estadística puede ser contaminación real; el administrador debe revisar evidencia antes de descartar.

## Preparación local

1. Aplicar `db/05_revision_cuarentena.sql` en la base local. Añade un índice único parcial en `auditoria_evento`; no crea tablas ni elimina datos. Si ya hay decisiones duplicadas, la migración falla para que se revise el historial sin borrarlo.
2. Configurar `CUARENTENA_REVISION_HABILITADA=true` en el entorno local del proceso Node. Por defecto las decisiones están deshabilitadas; el listado sigue disponible con los permisos habituales.
3. Iniciar sesión como Administrador y entrar en «Revisión de cuarentena» desde el dashboard, o abrir `/cuarentena.html`.

La migración NO se ha aplicado en nube. No habilitar la escritura en el entorno compartido hasta autorización expresa.

## API de Node/Express

Todas las rutas requieren Bearer JWT y rol Administrador verificado contra la base mediante los middleware existentes. No se usa la clave IoT en el navegador. Además, el servicio vuelve a comprobar dentro de la transacción que el administrador sigue activo y aprobado.

- `GET /api/admin/cuarentena?estado=pendiente&despuesDe=0&limite=50`. Estados: pendiente/restaurada/descartada/todas; máximo 100. IDs se devuelven como texto para evitar pérdida de precisión bigint.
- `POST /api/admin/cuarentena/decisiones`:

```json
{
  "ids": ["12", "13"],
  "accion": "restaurar",
  "motivo": "Contraste con referencia y revisión del episodio ambiental."
}
```

Admite restaurar o descartar; 1–50 IDs distintos como texto; motivo de 10–1000 caracteres. Todo el lote se confirma o revierte. Devuelve resultados por ID y si la decisión ya existía. Repetir exactamente acción y motivo es idempotente; cambiar una decisión definitiva devuelve 409.

Restaurar valida nuevamente sensor activo, catálogo completo, unidades, fecha con zona, precisión y límites del contrato actual de ingesta. Inserta valores originales sin corregirlos, preservando idMuestra y medidoEn, con calidad válida por revisión humana. Registra los IDs insertados y motivo en auditoria_evento. Si ya existe cualquier lectura original de esa muestra, devuelve 409 sin sobrescribir ni completar parcialmente. Mensajes malformados o fuera de rango no se restauran.

Descartar registra decisión y motivo, **sin borrar el payload de cuarentena**. El listado obtiene el estado desde auditoría. La política de revisión es definitiva en esta entrega: no hay botón para deshacer una decisión ni borrar auditoría.

Las decisiones se serializan por muestra y sensor, con el mismo bloqueo de sensor utilizado por .NET para la ingesta. El índice único protege una sola decisión terminal. Se conserva la tabla original de cuarentena; no se inventa una lectura si falta una variable.

## Pantalla

Solo el dashboard administrador tiene el enlace. Se pueden filtrar estados, avanzar páginas, abrir el JSON de cada muestra, seleccionar varias, escribir un motivo y confirmar la decisión. Los datos se renderizan con textContent, no HTML procedente de las muestras. La protección efectiva de permisos está en el servidor, no solo en esconder controles.

La pantalla usa la sesión JWT existente. Su HTML público no contiene datos privados: los datos se solicitan exclusivamente a rutas autenticadas. No se modificó la pantalla de visualizador. No se realizó inspección visual automatizada de navegador en esta entrega; la comprobación funcional cubre rutas y lógica de servicio.

## Pruebas

`tests/cuarentena.cjs` requiere una base local vacía `scca_test_*` y `SCCA_TEST_PORT`. No carga `.env`; el host está fijado a 127.0.0.1. Arranca un servidor Express temporal en 15054 con identidad de prueba, usa el servicio real y verifica roles nuevamente en PostgreSQL. No equivale a una prueba del login JWT: esos middleware ya existentes no se sustituyeron en la aplicación.

Resultado: 17 solicitudes verificadas, incluyendo 401/403, revisión deshabilitada, administrador inactivo, concurrencia, reintentos, conflicto entre decisiones, reversión del lote con un dato inválido, descartes sin borrado, duplicados de muestras, paginación y motivos obligatorios. La instancia local de PostgreSQL fue detenida al terminar. No se insertaron datos en nube.
