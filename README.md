# SCCA

Sistema de Monitoreo y Corrección de Calidad del Aire. Versión recibida el 16/11/2026.

## Aplicación web

Requiere Node.js, npm y una base PostgreSQL preparada para el proyecto.

```powershell
npm ci
npm start
```

Abrir http://localhost:3000 (o el puerto configurado). El archivo `.env` contiene `DATABASE_URL`, `JWT_SECRET` y, opcionalmente, `PORT`. Se conserva versionado por decisión del equipo para este repositorio privado. `.env.example` muestra las variables sin credenciales reales.

Los scripts de `db/` son referencias de la base de datos. Revisarlos antes de ejecutarlos: no importarlos automáticamente sobre una base existente.

## Componentes Python

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

- `python/simulador.py` consulta Open-Meteo y escribe lecturas cada 15 minutos. Requiere sensor 1 y los catálogos esperados. Estima PM1 a partir de PM2.5 e incluye CO.
- `ml_engine/entrenador.py` entrena detección de anomalías y forecasting. Ejecutarlo desde `ml_engine` para respetar sus rutas relativas. La calibración con referencia real está pendiente.
- `ml_engine/inferencia.py` expone una API FastAPI. Sus entradas deben reconciliarse con las características usadas al entrenar antes de considerar validada la predicción.
- `ml_engine/base_datos.py` mantiene su configuración de conexión propia. Revisarla antes de ejecutar entrenamiento.

Los archivos `.joblib` recibidos se conservan. Su presencia no acredita precisión ni validación ambiental.

## Organización

- `server.js`: rutas HTTP, autenticación y consultas del panel.
- `services/usuarioService.js`: operaciones de usuarios y auditoría.
- `services/validadorEstados.js`: transiciones permitidas.
- `services/correctorStrategy.js`: selección de estrategias de corrección. La estrategia compleja usa por ahora un factor de ajuste.
- `services/eventosLectura.js`: emisor y observadores. La persistencia de alertas y la notificación por sockets figuran como trabajo futuro.
- `public/`: páginas, estilos y JavaScript del navegador.

La versión incluye componentes de State, Strategy y Observer, con distintos grados de integración. No hay una suite de pruebas automatizada configurada: `npm test` todavía es el marcador inicial del proyecto.
