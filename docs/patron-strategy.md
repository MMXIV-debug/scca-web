# Strategy: selección de la corrección e inferencia ML

## Qué hace

Strategy encapsula alternativas de procesamiento detrás de un contrato común. El contexto `SelectorCorreccion` elige una estrategia por el campo `algoritmo` del modelo activo y ejecuta su método `corregir`.

## Qué faltaba y qué se completó

`services/correctorStrategy.js` tenía una fórmula lineal escalar y estrategias complejas que siempre lanzaban una excepción. Ninguna ruta activa de evaluación utilizaba el selector.

Ahora el panel y el procesamiento automático pasan por ese mismo módulo. La selección usa los modelos activos del registro real. Las estrategias reciben la solicitud completa y la función que ejecuta la inferencia en la API .NET, que a su vez utiliza el artefacto versionado de Python. Random Forest y XGBoost ya tienen un camino operativo mediante `corregir`; no se reemplazan por factores inventados.

## Participantes y archivos

| Participante | Implementación |
| --- | --- |
| Contexto | `SelectorCorreccion` en `services/correctorStrategy.js`. |
| Contrato | `EstrategiaCorreccion.corregir(entrada, parametros, contexto)` y `evaluar(solicitud, ejecutar)`. |
| Regresión lineal | `RegresionLinealStrategy`: conserva la fórmula escalar `m × x + b`; para modelos versionados delega la solicitud completa. |
| Random Forest / XGBoost | `AlgoritmoComplejoStrategy`: requiere el servicio real y le entrega la solicitud completa. |
| Persistencia | `PersistenciaStrategy`: acepta exclusivamente el propósito `pronostico`, según el modelo de respaldo existente en Python. |
| Anomalías | `AnomaliasStrategy`: exige propósito `anomalias` y horizonte cero antes de delegar a la API. |
| Cliente del panel | `evaluar` en `services/panelMlService.js`, utilizado por `POST /api/admin/ml/evaluar`. |
| Cliente automático | `procesar` en `services/procesamientoMlService.js`, utilizado por el programador y `POST /api/admin/ml/procesar`. |

Las estrategias de persistencia y anomalías representan algoritmos que ya existían en el registro; no incorporan modelos nuevos ni entrenamiento adicional.

## Flujo activo

1. La evaluación manual consulta el registro ML y busca el modelo por sensor, propósito, variable y horizonte. El procesamiento automático ya dispone del modelo y lo pasa directamente para evitar repetir la consulta al registro.
2. `SelectorCorreccion.evaluar` selecciona el algoritmo y llama a `aplicar`, que ejecuta `corregir` en la estrategia concreta.
3. La estrategia valida las restricciones que le corresponden y llama al servicio de inferencia con la solicitud original, incluyendo la opción de persistencia.
4. .NET comprueba el estado actual y los datos horarios y solicita a Python la inferencia del artefacto real. Las decisiones sobre cobertura, versión, dominio y persistencia permanecen en sus servicios actuales.
5. El resultado o el error vuelve al llamador. No se devuelve un valor simulado si el modelo o el servicio falla.

```js
const selector = require('../services/correctorStrategy');
const resultado = await selector.evaluar(solicitud, modeloActivo, ejecutarEvaluacion);
```

`ejecutarEvaluacion` es la función de integración HTTP de `panelMlService.js`; no debe sustituirse en producción por un cálculo ficticio. Las evaluaciones lineales versionadas también usan Python porque pueden tener varias variables y deben conservar el artefacto y sus validaciones.

## Compatibilidad y límites

`aplicar(12, { algoritmo: 'regresion_lineal', parametros: { pendiente: 0, intersepto: 3 } })` sigue devolviendo `3`. Una llamada escalar a Random Forest sin solicitud completa ni servicio de inferencia se rechaza: no existe información suficiente para ejecutar el modelo.

Si no hay modelo activo, se consulta el backend para conservar su respuesta de ausencia de modelo o validación. Un algoritmo desconocido se rechaza explícitamente. La detección de anomalías durante la recepción IoT sigue su camino actual .NET → Python; esta integración no cambia ni evita esa evaluación. Que exista una estrategia no habilita funcionalidades que el backend aún rechace.

## Pruebas

`npm.cmd run test:contratos` incluye `tests/strategy-observer.test.cjs`: selección de los algoritmos admitidos, entrega de la solicitud completa, restricciones de persistencia y anomalías, rechazo de algoritmos desconocidos y recorrido del panel por la estrategia de Random Forest hasta la llamada HTTP a .NET. Los servicios externos se sustituyen por respuestas controladas en estas pruebas. Los contratos anteriores mantienen la comprobación de pendiente cero y el rechazo de correcciones complejas ficticias.
