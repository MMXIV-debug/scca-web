# SCCA — Sistema de Monitoreo y Corrección de Calidad del Aire

SCCA es un proyecto en desarrollo orientado al monitoreo y la corrección de mediciones de calidad del aire. Integra lecturas de sensores y datos de simulación en una plataforma web, con herramientas para consultar mediciones, gestionar usuarios, revisar alertas y evaluar muestras mediante modelos de aprendizaje automático.

**El proyecto continúa en proceso de implementación, pruebas y validación.** Las funcionalidades disponibles forman parte de una versión de trabajo; la integración con dispositivos y los modelos de aprendizaje automático siguen en evaluación y mejora. Los resultados de demostración no constituyen una validación de precisión ambiental.

**Repositorio:** [MMXIV-debug/scca-web](https://github.com/MMXIV-debug/scca-web)

**Versión de la API .NET:** ASP.NET Core 10 sobre .NET 10 (`net10.0`). El iniciador instala .NET SDK 10 si falta para compilar y ejecutar esta API.

## Integrantes

| Nombre | Usuario de GitHub |
| --- | --- |
| Mateo Morales Guzman | [MMXIV-debug](https://github.com/MMXIV-debug) |
| Aneli Vargas Ortiz | [vargasortizlizaneli](https://github.com/vargasortizlizaneli) |
| Deibi Cruz Gomez | [DeibiCruz](https://github.com/DeibiCruz) |

## Inicio rápido

**Para ejecutar el proyecto en Windows, hacer doble clic en `Iniciar SCCA.cmd`.** Este archivo prepara las dependencias necesarias, inicia los componentes del sistema y abre la aplicación en el navegador utilizando la configuración entregada por el equipo.

**La base de datos PostgreSQL está alojada en la nube y ya está preparada para utilizar el proyecto. No es necesario instalar un servidor de base de datos, aplicar migraciones ni cargar datos de prueba para ejecutar la entrega.** Se requiere conexión a Internet y conservar el archivo `.env` con la configuración proporcionada.

## Instrucciones para ejecutar el proyecto

1. Descargar o clonar el [repositorio del proyecto](https://github.com/MMXIV-debug/scca-web). Si se descarga como ZIP, extraer todo su contenido antes de ejecutarlo.
2. Abrir la carpeta del proyecto y conservar el archivo `.env` proporcionado por el equipo, con sus credenciales y opciones actuales.
3. Hacer doble clic en **Iniciar SCCA.cmd**.
4. Esperar a que termine la preparación. La primera ejecución puede tardar varios minutos porque instala las herramientas y dependencias que falten. Si Windows solicita permisos para instalarlas, aceptarlos para completar la instalación.
5. Cuando aparezca **SCCA listo**, utilizar la aplicación que se abre en el navegador. Si no se abre automáticamente, ingresar a [http://localhost:3000](http://localhost:3000).
6. Mantener abierta la ventana del iniciador mientras se utiliza el sistema. Para finalizar, presionar **Ctrl+C** en esa ventana.

El equipo debe contar con Windows 10/11 y conexión a Internet. Si faltan herramientas, el instalador utiliza `winget` para instalarlas; por eso debe estar disponible **App Installer / Instalador de aplicación** de Windows.

También se puede iniciar desde PowerShell, ubicado en la carpeta del proyecto:

```powershell
& '.\Iniciar SCCA.cmd'
```

## Cómo funciona Iniciar SCCA.cmd

`Iniciar SCCA.cmd` se ubica automáticamente en la carpeta del proyecto y ejecuta `instalar.ps1`. Este script:

1. Detecta Node.js, Python y .NET SDK 10; instala las herramientas que falten mediante `winget`.
2. Instala las dependencias de Node.js, prepara el entorno de Python con `requirements.txt` y restaura los paquetes de .NET cuando corresponde.
3. Comprueba el archivo `.env` y reutiliza sus valores configurados. Si falta, crea uno desde la plantilla y solicita la conexión a la base en la nube; para ejecutar la entrega, utilizar el archivo configurado por el equipo.
4. Intenta preparar el registro inicial de modelos ML de demostración si todavía no existe.
5. Ejecuta `iniciar.js`, que comprueba el acceso a la base en la nube, compila la API .NET e inicia el servicio Python/ML, la API, el panel web y el simulador.
6. Abre la aplicación en el navegador cuando la API y el panel están disponibles.

## Accesos y Swagger

Con el iniciador en ejecución y los puertos predeterminados:

| Servicio | Dirección |
| --- | --- |
| Aplicación web | [http://localhost:3000](http://localhost:3000) |
| Swagger de la API .NET | [http://localhost:5051/swagger](http://localhost:5051/swagger) |
| Estado de la API y conexión a la nube | [http://localhost:5051/api/estado](http://localhost:5051/api/estado) |
| Swagger del panel Node.js | [http://localhost:3000/api-docs](http://localhost:3000/api-docs) |

Para comprobar la conexión desde Swagger:

1. Abrir [Swagger de la API .NET](http://localhost:5051/swagger).
2. Seleccionar `GET /api/estado`.
3. Presionar **Try it out → Execute**.
4. Comprobar que devuelva HTTP 200 con `api: "disponible"` y `postgresql: "conectado"`.

Los endpoints protegidos requieren la credencial correspondiente en **Authorize**: clave IoT (`X-Api-Key`), token de administrador o clave de servicio ML (`X-ML-Key`). El token de sesión se obtiene mediante `POST /api/login` del panel con una cuenta autorizada.

## Configuración de la base en la nube

La aplicación utiliza `DATABASE_URL` del archivo `.env` para conectarse a PostgreSQL en la nube. El iniciador comparte esa configuración con el panel, la API .NET y Python.

**Conservar el `.env` entregado y no reemplazarlo por `.env.example`.** Las claves actuales permiten mantener la conexión y la integración entre los componentes. Si no se dispone de ese archivo, solicitar al equipo la configuración de acceso antes de iniciar.

Ejemplo ilustrativo de la cadena de conexión, **sin credenciales reales**:

```dotenv
DATABASE_URL=postgresql://USUARIO:CLAVE@HOST_NUBE:5432/sistema_calidad_aire?sslmode=require
```

Este ejemplo no debe sustituir la conexión configurada. Las credenciales reales no se reproducen en el README.

## Si el proyecto no abre

- **Primera ejecución:** esperar a que finalicen las instalaciones y la compilación; mantener Internet disponible.
- **Puerto ocupado:** cerrar la ejecución anterior de SCCA y volver a abrir `Iniciar SCCA.cmd`.
- **Error de conexión:** comprobar Internet y que se conserve el `.env` proporcionado por el equipo.
- **Falta `winget`:** instalar o actualizar App Installer desde Microsoft Store y ejecutar nuevamente el iniciador.
- **El navegador no se abre:** ingresar a [http://localhost:3000](http://localhost:3000) cuando la consola indique **SCCA listo**.

## Referencia técnica

Esta sección amplía el funcionamiento del sistema. Para ejecutar la entrega, seguir las instrucciones de inicio del principio del README.

### Componentes del proyecto

| Archivo o carpeta | Función |
| --- | --- |
| `Iniciar SCCA.cmd`, `instalar.ps1` e `iniciar.js` | Preparación de dependencias y arranque coordinado de los servicios. |
| `server.js` | Servidor Node.js/Express, autenticación, rutas HTTP y consultas del panel. |
| `backend/Scca.Api/` | API ASP.NET Core, recepción de muestras IoT y operaciones de integración con ML. |
| `services/usuarioService.js` y `services/validadorEstados.js` | Operaciones de usuarios, auditoría y transiciones permitidas. |
| `services/alertasService.js` y `services/alertasAmbientalesService.js` | Cálculo de alertas persistidas que los paneles consultan por HTTP. |
| `services/correctorStrategy.js` | Strategy: selección del algoritmo activo en las evaluaciones ML del panel y del procesamiento automático. |
| `services/eventosLectura.js` | Observer: recibe avisos de lecturas confirmadas, ejecuta las alertas habilitadas y notifica a los paneles. |
| `public/` | Páginas, estilos y JavaScript del navegador. |
| `python/simulador.py` | Obtención y envío de lecturas de origen simulado. |
| `ml_engine/` | Preparación de datasets, entrenamiento evaluado, registro de modelos e inferencia con Python/FastAPI. |
| `db/` | Scripts de referencia del esquema y su evolución; no se necesitan ejecutar para abrir la entrega. |
| `tests/` | Contratos y pruebas automatizadas del proyecto. |

### Simulación y recepción de lecturas

El iniciador ejecuta el simulador con la misma configuración del resto del sistema. Selecciona un sensor activo de origen `simulado` asociado a `CO`, `PM1`, `PM10` y `PM25`, y consulta sus unidades y coordenadas en la base en la nube. Si hay varios candidatos, `SIMULADOR_SENSOR_ID` permite indicar cuál utilizar; no depende de un identificador fijo.

El simulador consulta Open-Meteo y estima PM1 como el 70 % de PM2.5. Envía las cuatro variables a `POST /api/lecturas` con la clave de la instalación. La API evalúa la muestra mediante ML y devuelve `guardada` o `cuarentena`. Se intenta enviar una muestra al arrancar y luego cada 900 segundos; `SIMULADOR_INTERVALO_S` permite modificar ese intervalo. Si el proveedor falla, el simulador informa el problema y reintenta sin detener el panel.

El ESP32 debe estar encendido y configurado con la red, la dirección de la API y los identificadores de la instalación. `IOT_API_KEY` debe coincidir con `API_KEY` del dispositivo. Si cambia `API_PORT`, también debe actualizarse la dirección de destino del ESP32.

Los paneles de administrador y visualizador actualizan las mediciones cada 15 segundos mientras están visibles.

También reciben avisos mediante una suscripción HTTP autenticada cuando la API .NET confirma una muestra. PostgreSQL entrega el aviso después del commit y Node ejecuta los observadores de alertas habilitados y de actualización de los paneles. El refresco periódico se conserva como respaldo ante desconexiones. Consultar [Strategy](docs/patron-strategy.md) y [Observer](docs/patron-observer.md) para ver los flujos, archivos y pruebas de ambos patrones.

### Clima y pronóstico del visualizador

Debajo de los gráficos, el visualizador permite seleccionar un sitio y alternar entre el pronóstico por hora (próximas 24 horas) y por día (7 días, con temperatura mínima/máxima, clima y probabilidad máxima de lluvia). Las condiciones actuales se presentan en un resumen y el detalle tiene desplazamiento propio. La fuente se indica discretamente al pie: [Open-Meteo](https://open-meteo.com/en/docs), consultada con las coordenadas registradas de cada sitio; son resultados de modelos meteorológicos, no mediciones de los sensores físicos ni predicciones del motor ML local. Los valores diarios originales se conservan en `clima_consulta.respuesta.daily` y se exponen como `diario` en la API; los registros anteriores sin ese campo permanecen intactos y el servidor obtiene el formato ampliado en el siguiente ciclo.

Al iniciar `server.js` se preparan automáticamente las tablas de `db/13_pronostico_clima.sql` con la conexión configurada. Cada 15 minutos se guarda una consulta por sitio en `clima_consulta` (proveedor, coordenadas, fecha y respuesta original) y sus condiciones actuales y 24 horas futuras en `clima_dato` (fecha de validez UTC, temperatura °C, código WMO, día/noche y probabilidad de lluvia). Las versiones anteriores se conservan. El servidor debe permanecer encendido para registrar nuevas consultas, aunque no haya navegadores abiertos. Las fallas se reintentan cada minuto; la interfaz conserva el último registro e indica si la consulta supera 30 minutos de antigüedad o si la condición actual del proveedor difiere más de una hora del reloj del servidor. El pronóstico se selecciona a partir de la hora del servidor; el registro de recepción y sus intervalos usan ese mismo reloj para evitar inconsistencias con el reloj de PostgreSQL.

`GET /api/visualizador/clima`, con sesión autenticada, devuelve el último registro persistido por sitio y su vigencia. El panel lo consulta cada 15 segundos y presenta las fechas en hora de Bolivia. La cuenta PostgreSQL necesita permiso de creación de tablas para la preparación inicial; si se administra el esquema por separado, aplicar el SQL antes de iniciar y conceder acceso de lectura, inserción y uso de secuencias a la cuenta de la aplicación. No se generan datos meteorológicos ficticios si la API falla.

### Modelos y entrenamiento

- `ml_engine/base_datos.py` utiliza `DATABASE_URL` para preparar datasets. El entrenamiento consume esos archivos sin consultar directamente la base.
- `ml_engine/entrenador.py` ejecuta el ciclo evaluado cuando se invoca sin argumentos. También admite `evaluar --dataset RUTA --proposito calibracion|pronostico|anomalias` y `revertir --clave CLAVE --motivo MOTIVO`. El registro de demostración conserva versiones anteriores y solo activa candidatos que cumplen los criterios de evaluación.
- `ml_engine/inferencia.py` expone el servicio FastAPI utilizado por la integración ML. Los archivos `.joblib` forman parte de los artefactos de modelos del proyecto.

PM2.5 contempla horizontes de pronóstico de 1, 3 y 6 horas. La disponibilidad de resultados reales depende de contar con datos y modelos aptos, de acuerdo con el estado de desarrollo indicado al inicio.

### Opciones de ejecución para desarrollo

Con las dependencias ya preparadas por el instalador, estos comandos permiten variar el arranque desde PowerShell:

```powershell
# Ejecutar el iniciador sin abrir el navegador.
& '.\Iniciar SCCA.cmd' --sin-navegador

# Ejecutar el iniciador sin simulador.
& '.\Iniciar SCCA.cmd' --sin-simulador

# Arrancar los servicios directamente con Node.js.
npm.cmd start

# Iniciar únicamente el panel web.
npm.cmd run start:web
```

`npm.cmd` permite ejecutar npm desde PowerShell cuando la política de ejecución bloquea `npm.ps1`. Los puertos se configuran en `.env` mediante `PORT=3000`, `API_PORT=5051` y `ML_PORT=8000`; si se cambian, ajustar las direcciones de acceso correspondientes.

`npm.cmd test` ejecuta los contratos Node.js y las pruebas Python. Estas pruebas son herramientas de desarrollo y no forman parte de los pasos necesarios para abrir el proyecto.

Para ampliar los detalles de implementación, consultar [Correcciones e integración del 19/11](docs/CORRECCIONES_2026-11-19.md) y [Arranque ML](docs/ARRANQUE_ML_2026-11-19.md).
