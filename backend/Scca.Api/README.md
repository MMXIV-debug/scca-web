# API SCCA (.NET 10)

API inicial con Swagger UI y conexion a PostgreSQL mediante Npgsql.
`GET /api/estado` ejecuta `SELECT 1` y confirma que la base responde.
La recepcion IoT y la integracion con FastAPI/ML estan pendientes.
WeatherForecast es el ejemplo de la plantilla, no un modelo ambiental.

## Ejecutar en desarrollo

La API usa DATABASE_URL, igual que el panel y ML. En desarrollo también lee esa variable del archivo .env de la raíz. Desde esta carpeta:

```powershell
dotnet build
$env:ASPNETCORE_ENVIRONMENT = "Development"
dotnet run --no-launch-profile --urls "http://localhost:5051"
```

Abrir http://localhost:5051/swagger y ejecutar GET /api/estado.
La respuesta esperada es HTTP 200 con api=disponible y postgresql=conectado.
La base debe existir previamente; la API no crea ni migra tablas.
Guardar las credenciales en User Secrets, no en archivos versionados.
Detener con Ctrl+C antes de recompilar para evitar bloquear el ejecutable.
