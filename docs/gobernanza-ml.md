# Evaluación y promoción local de modelos — entrega 2

El nuevo entrenador consume datasets del paso anterior. No lee ni escribe PostgreSQL y no reemplaza `modelos_guardados/detector_anomalias.joblib` ni `forecaster.joblib`. La activación aquí es **solo en el registro de demostración**; FastAPI sigue usando sus archivos actuales hasta integrar el registro en una entrega posterior.

## Evaluar

Desde la raíz del proyecto, sustituir la ruta del dataset por una carpeta que contenga `manifiesto.json`:

```powershell
.\.venv\Scripts\python.exe ml_engine/entrenador.py evaluar --dataset "RUTA_DEL_DATASET" --proposito calibracion --variable PM25
.\.venv\Scripts\python.exe ml_engine/entrenador.py evaluar --dataset "RUTA_DEL_DATASET" --proposito pronostico --variable PM25 --horizonte 3
```

El pronóstico admite horizontes 1/3/6 horas por ejecución. Se calcula el objetivo por instante real. Se necesita suficiente historia posterior para construir las etiquetas; no se inventan las últimas horas del conjunto. El entrenamiento de calibración compara regresión lineal y Random Forest; pronóstico utiliza XGBoost. Las variables de entrada quedan registradas.

Ejecutar simplemente `python entrenador.py` ahora muestra ayuda/error de argumentos y **no entrena**. Es un cambio deliberado frente al script antiguo que mezclaba datos y sobrescribía modelos sin evaluar. La tarea de Windows mencionada por el equipo debe adaptarse cuando se implemente el programador: este trabajo no crea ni modifica tareas.

## Reglas y separación temporal

1. Verificar hashes de archivos, columnas, cobertura y fechas. Rechazar archivos alterados.
2. Exigir al menos 540 pares válidos y un período de 30 días con cobertura horaria mínima de 75%. Insuficiencia deja el candidato pendiente sin entrenar.
3. Reservar el último 30% temporal como prueba final. En el 70% inicial, usar el primer 80% para ajuste interno y el último 20% para selección por RMSE, MAE y desempate determinista.
4. Para pronóstico, purgar del ajuste las filas cuyo objetivo futuro alcance la validación y del entrenamiento las que alcancen la prueba final.
5. Reajustar solo el candidato elegido con el bloque de entrenamiento, antes de la prueba final. No se reentrena con el test.
6. Registrar y consumir el período final antes de evaluarlo. Un intento rechazado o fallido no habilita reutilizarlo; cambiar el hash/exportar de nuevo tampoco. La siguiente prueba debe empezar después de la última hora consumida para ese nodo/sensor/perfil/propósito/variable/horizonte.
7. Comparar el candidato contra la lectura original (calibración) o persistencia —valor actual— (pronóstico). Exigir mejora de RMSE ≥20%, MAE no mayor y sesgo absoluto no mayor. Registrar R², indefinido para referencia constante. Si RMSE original es cero, tolerancia RMSE absoluta de 1e-9 en la unidad de la variable, manteniendo MAE/sesgo sin empeorar.
8. Si hay vigente en el registro, predecir con él **sobre las mismas filas de prueba**. El candidato no puede empeorar su RMSE, MAE ni sesgo absoluto.
9. Solo `apto_demo` se activa automáticamente en ese registro; `pendiente`, `rechazado` y `error` mantienen el vigente.

Los criterios numéricos proceden del requisito de calibración. En pronóstico se utilizan de manera **provisional y conservadora para demostración**, no se presentan como una política de forecasting ya aprobada por el equipo. La promoción operacional requiere definir esa política y validación independiente.

No se aplica RMSE a Isolation Forest. `--proposito anomalias` registra pendiente porque falta un conjunto etiquetado y una política de evaluación específica (falsos positivos/negativos y tratamiento de episodios reales). El detector actual de la API permanece intacto.

## Registro y reversión

La salida predeterminada está en `ml_engine/registro_modelos_demo/`, excluida de Git:

- `registro.json`: versiones, estado, referencias activas, períodos consumidos y eventos.
- `versiones/ID/informe.json`: política, identidad, hash de dataset, particiones, métricas y motivos de evaluación.
- `versiones/ID/modelo.joblib`: artefacto versionado y hash, si se llegó a evaluarlo.

Un bloqueo local excluye escritores simultáneos. Los archivos de modelos no se sobrescriben; el cambio de referencia activa usa reemplazo atómico de `registro.json` en el mismo volumen. Si el proceso muere, `.lock` queda para revisión; no se elimina por tiempo automáticamente. Antes de retirarlo manualmente hay que confirmar que no exista proceso activo. Los archivos huérfanos de un fallo no se consideran activos.

```powershell
.\.venv\Scripts\python.exe ml_engine/entrenador.py revertir --clave "nodo_1/sensor_1/contaminantes_simulados/calibracion/PM25" --motivo "Degradación detectada en revisión"
```

La reversión verifica el hash y aptitud previa del modelo anterior; suspende el actual y restaura el anterior. Si no había anterior, deja el perfil sin activo. Si el anterior está corrupto o suspendido, rechaza la reversión. No se puede forzar la promoción de un rechazado por CLI. La vigilancia automática de degradación todavía no está implementada: esta operación requiere un motivo y una ejecución explícita.

Es un registro local de un solo escritor, no un almacén multi-host ni una auditoría resistente a modificaciones manuales. Para producción deben integrarse `modelo_ml`, `validacion_ml`, política versionada, eventos inmutables y selección de modelos de FastAPI. Cargar únicamente artefactos generados por este flujo en un directorio de confianza.

## Alcance científico y evidencia

Las referencias actuales de Open-Meteo son modeladas y pueden compartir origen con el simulador. Todos los resultados se marcan demostración, `validacion_independiente=false` y `calibracion_fisica_validada=false`. Un `apto_demo` comprueba el mecanismo técnico; no certifica precisión ambiental ni autoriza promoción operacional.

Se probaron selección/activación con datos sintéticos aislados en carpetas temporales; esos datos nunca se insertan en PostgreSQL ni se muestran en la web. Con el dataset real del paso 2 se obtuvo `pendiente: sin_pares_de_referencia_validos`. No se entrenó con ese historial insuficiente.

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s ml_engine -p "test_*.py" -v
```

30 pruebas correctas: cobertura y perfiles, métricas, particiones temporales, promoción, no reutilización de prueba, XGBoost, bloqueo de escritores, falla atómica, integridad y reversión. Entrega preparada para publicación en la rama `Machine-Learning`.
