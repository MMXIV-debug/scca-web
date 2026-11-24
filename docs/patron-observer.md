# Observer: reacción a lecturas confirmadas

## Qué hace

Observer permite que varios suscriptores reaccionen a un acontecimiento sin que el productor tenga que llamar directamente a cada uno. `services/eventosLectura.js` es el publicador compartido de Node; sus observadores ejecutan las comprobaciones de alertas habilitadas y notifican a los paneles.

## Qué faltaba y qué se completó

El módulo anterior solo tenía comentarios y mensajes de ejemplo: no recibía lecturas de la API .NET, no guardaba alertas y no avisaba al navegador. Ahora está conectado al flujo de recepción real entre procesos mediante las notificaciones transaccionales de PostgreSQL.

## Flujo activo

1. `backend/Scca.Api/Controllers/LecturasController.cs` guarda la muestra y su evaluación como antes.
2. Dentro de esa misma transacción ejecuta `pg_notify('scca_lecturas', ...)` con la identidad de la muestra y su destino: `guardada` o `cuarentena`.
3. PostgreSQL entrega la notificación solo después del commit. Si se revierte el guardado, no entrega el aviso.
4. Node mantiene una conexión dedicada con `LISTEN` y publica `NuevaLecturaConfirmada` o `MuestraEnCuarentena` en `LecturaEmitter`.
5. Los observadores ejecutan los servicios de alertas habilitados y envían un aviso SSE a los paneles suscritos. Al terminar las comprobaciones de alertas, publican `AlertasActualizadas` para que el visualizador también pueda recuperar sus resultados.
6. El navegador consulta nuevamente los endpoints existentes. Los valores y las alertas siguen procediendo de la base de datos.

## Participantes y archivos

| Participante | Archivo y función |
| --- | --- |
| Productor | `LecturasController.cs`: notificación asociada al commit de la muestra. |
| Publicador | `services/eventosLectura.js`: `LecturaEmitter`, `publicar` e `iniciarObservadores`. |
| Observador de alertas | Invoca `comprobarAmbientales` y las comprobaciones técnicas existentes; no usa el umbral fijo del ejemplo anterior. |
| Observador del panel | `suscribirPanel` escribe avisos SSE para los navegadores conectados. |
| Composición | `server.js` inicia la escucha y registra `GET /api/visualizador/eventos` detrás del middleware de autenticación. |
| Suscripción del navegador | `public/js/eventos-lectura.js` usa `fetch` con cabecera `Authorization`. |
| Clientes | `public/js/visualizador.js` y `public/js/dashboard.js` refrescan sus consultas cuando reciben un aviso. |

## Configuración

La notificación de los paneles está activa al iniciar el servidor. Las escrituras de alertas respetan las opciones ya existentes:

- Ambientales: `ALERTAS_AMBIENTALES_AUTO=true`.
- Técnicas: `ALERTAS_TECNICAS_HABILITADAS=true` y `ALERTAS_TECNICAS_AUTO=true`.

No se activan estas opciones automáticamente. Se reutilizan los servicios de alertas existentes, con sus reglas configuradas, auditoría y bloqueos. Los avisos de cuarentena también permiten actualizar la supervisión técnica de recepción; no convierten esos valores en mediciones originales válidas.

## Desconexiones y autenticación

Los errores de un observador se aíslan de los demás. Si se corta la conexión dedicada a PostgreSQL, se descarta y se intenta suscribir de nuevo a los 5 segundos. Al recuperarla, `RecepcionRestablecida` solicita una actualización y una comprobación de alertas, porque los avisos no constituyen una cola persistente.

Los paneles envían el token por cabecera; no se introduce en la URL. Los avisos contienen solo una señal de actualización, sin valores ni identidades de usuarios o sensores. La conexión HTTP se renueva cada minuto para volver a comprobar el acceso de la cuenta. Al cerrarla se retiran sus listeners y temporizadores. El navegador reintenta la conexión y conserva el refresco periódico cada 15 segundos como respaldo.

Se utiliza una conexión PostgreSQL dedicada para la suscripción. Si la instalación utiliza un intermediario de conexiones, debe admitir `LISTEN` en una sesión estable. No se requiere una migración de tablas para este mecanismo. Deben reiniciarse el panel Node y la API .NET para activar los dos extremos.

## Pruebas

`npm.cmd run test:contratos` incluye aislamiento de errores, recepción y validación de avisos, ejecución de alertas habilitadas, manejo del corte de conexión, retiro de suscriptores SSE y lectura de mensajes fragmentados en el navegador.

La prueba optativa `node tests/observer-postgres.cjs` utiliza la conexión configurada y un canal aislado. Comprueba que no haya evento antes del commit, que un rollback no publique un aviso y que la suscripción se recupere después de un `ECONNRESET` controlado. No inserta lecturas ni modifica tablas.
