import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.linear_model import LinearRegression
import xgboost as xgb
import joblib
from base_datos import obtener_conexion

def entrenar_modelos():
    print("Iniciando ciclo de entrenamiento del modelo...")
    conexion = obtener_conexion()

    # Extraemos el historial de la base de datos (CORREGIDO: v.codigo)
    query = """
        SELECT l.valor, l.medido_en, v.codigo as variable
        FROM lectura_original l
        JOIN variable v ON l.variable_id = v.id
        ORDER BY l.medido_en ASC
    """

    df_crudo = pd.read_sql(query, conexion)
    df_crudo['valor'] = pd.to_numeric(df_crudo['valor'])

    # Pivotar los datos: Convertir filas en columnas
    df = df_crudo.pivot_table(
        index = 'medido_en',
        columns = 'variable',
        values = 'valor'
    ).dropna() # Con esto se descartan filas incompletas

    print(f"Datos extraídos y pivotados. Total de registros completos: {len(df)}")
    print(df.head()) # Solo una vista de la tabla en consola

    # VALIDACIÓN: Evitar que el script falle si la base de datos es muy nueva
    if len(df) < 5:
        print("Aún no hay suficientes datos en la base de datos para entrenar los modelos (Mínimo 5 requeridos).")
        print("Deja el simulador recolectando datos unas horas más y vuelve a intentarlo.")
        return

    # MODELO 1: Detección de anomalías con Isolation Forest
    print("Entrenando modelo de detección de anomalías multivariante...")
    # CORREGIDO: 'contamination' en lugar de 'contaminacion'
    modelo_anomalias = IsolationForest(contamination=0.01, random_state=42)
    modelo_anomalias.fit(df)
    joblib.dump(modelo_anomalias, 'modelos_guardados/detector_anomalias.joblib')


    # MODELO 2: Calibración / Corrección de Deriva (Regresión)
    print("Entrenando calibrador de sensores...")
    
    # En un escenario real, aquí extraerías los datos de tu tabla 'referencia_lectura'
    # y harías un merge (cruce) con tu 'df' actual usando la hora exacta ('medido_en').
    """
    # 1. Limpiar filas donde no tengamos el dato de referencia para comparar
    df_calibracion = df.dropna(subset=['PM25_Referencia_Real'])
    
    # 2. X = Lo que lee tu sensor (ej. PM2.5, Temperatura y Humedad afectan la lectura)
    X_calibracion = df_calibracion[['PM25', 'TEMP', 'HUM']]
    
    # 3. Y = La verdad absoluta (El dato de la estación profesional)
    y_calibracion = df_calibracion['PM25_Referencia_Real']
    
    # 4. Entrenar el modelo de corrección
    from sklearn.linear_model import LinearRegression
    modelo_calibracion = LinearRegression()
    modelo_calibracion.fit(X_calibracion, y_calibracion)
    
    # 5. Guardar el "cerebro" calibrador
    joblib.dump(modelo_calibracion, 'modelos_guardados/calibrador.joblib')
    print("Calibrador entrenado.")
    """
    print("Estructura del Modelo 2 lista para cuando existan datos de referencia.")

    # MODELO 3: Predicción de Calidad del Aire (XGBoost)
    print("Entrenando modelo de forecasting con contexto climático...")
    
    # IMPORTANTE: Asegúrate de que 'PM25' es exactamente el código que tienes en tu tabla 'variable'
    # Creamos la columna objetivo: el PM2.5 desplazado 1 hora (ej. 4 lecturas de 15 min = shift(-4))
    df['PM25_Futuro'] = df['PM25'].shift(-4) 
    df = df.dropna()
    
    # X (Características): Variables actuales
    X_forecast = df.drop(columns=['PM25_Futuro'])
    # Y (Objetivo): El PM2.5 de la próxima hora
    y_forecast = df['PM25_Futuro']
    
    modelo_forecast = xgb.XGBRegressor(objective='reg:squarederror', n_estimators=100)
    modelo_forecast.fit(X_forecast, y_forecast)
    joblib.dump(modelo_forecast, 'modelos_guardados/forecaster.joblib')

    print("Entrenamiento finalizado exitosamente.")

# CORREGIDO: Ahora el nombre de ejecución coincide con la función (entrenar_modelos)
if __name__ == "__main__":
    entrenar_modelos()