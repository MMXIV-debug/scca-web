# Preparar el proyecto en otra computadora

El archivo `.env` real se conserva localmente y no se distribuye automáticamente con Git. Las dependencias, entornos virtuales y salidas compiladas se regeneran en cada equipo.

1. Descargar o actualizar `main`.
2. Ejecutar `Copy-Item .env.example .env` solo si todavía no existe `.env`.
3. Completar DATABASE_URL, JWT_SECRET e IOT_API_KEY con los datos privados entregados por el equipo. No ejecutar la plantilla con los valores de ejemplo. Si la contraseña contiene caracteres especiales, codificarlos correctamente en la URL PostgreSQL.
4. Instalar Node.js, Python 3.12 y .NET SDK10. Ejecutar `npm.cmd ci`.
5. Crear el entorno: `py -3.12 -m venv .venv`; instalar Python: `.\.venv\Scripts\python.exe -m pip install -r requirements.txt`.
6. Iniciar con `npm.cmd start` o con `Iniciar SCCA.cmd`.

La API .NET recibe su conexión desde el iniciador, que convierte DATABASE_URL a ConnectionStrings__Postgres. No es necesario publicar contraseñas en appsettings.json. Mantener iguales las claves del ESP32 y de la API.

Las migraciones04,05 y06 ya se confirmaron en la base compartida durante esta sesión; no importar un respaldo ni recrear la base para abrir el proyecto. Comprobar el destino antes de aplicar cualquier SQL. Las nuevas opciones de escritura permanecen desactivadas en la plantilla.

Para Mateo: el propietario del entorno debe entregar por un canal privado las tres variables requeridas o una copia privada de `.env`. El código fuente, migraciones y archivos de dependencias están en Git; `.venv`, node_modules y bin no deben copiarse entre computadoras.
