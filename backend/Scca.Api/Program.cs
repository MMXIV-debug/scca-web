using Npgsql;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.

builder.Services.AddControllers();
var panelPort = builder.Configuration["PORT"] ?? "3000";
builder.Services.AddCors(options => options.AddPolicy("SwaggerPanel", policy => policy
    .WithOrigins($"http://localhost:{panelPort}", $"http://127.0.0.1:{panelPort}")
    .AllowAnyHeader().AllowAnyMethod()));
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new() { Title = "SCCA · Calidad del aire", Version = "v1" });
    options.AddSecurityDefinition("IoT", new Microsoft.OpenApi.OpenApiSecurityScheme
    {
        Type = Microsoft.OpenApi.SecuritySchemeType.ApiKey,
        In = Microsoft.OpenApi.ParameterLocation.Header,
        Name = "X-Api-Key",
        Description = "Clave de la instalación configurada en Iot:ApiKey."
    });
    options.AddSecurityDefinition("Administrador", new Microsoft.OpenApi.OpenApiSecurityScheme
    {
        Type = Microsoft.OpenApi.SecuritySchemeType.Http, Scheme = "bearer",
        Description = "Token de la sesión del administrador, obtenido en POST /api/login del panel."
    });
    options.AddSecurityDefinition("ServicioML", new Microsoft.OpenApi.OpenApiSecurityScheme
    {
        Type = Microsoft.OpenApi.SecuritySchemeType.ApiKey, In = Microsoft.OpenApi.ParameterLocation.Header,
        Name = "X-ML-Key", Description = "Credencial exclusiva del servicio configurada en Ml:RegistroApiKey."
    });
    options.OperationFilter<Scca.Api.Services.OperacionSwagger>();
});

// Configurar la conexión con PostgreSQL.
var databaseUrl = Environment.GetEnvironmentVariable("DATABASE_URL");
if (databaseUrl is null && builder.Environment.IsDevelopment())
{
    var archivo = Path.Combine(builder.Environment.ContentRootPath, "..", "..", ".env");
    if (File.Exists(archivo))
    {
        const string clave = "DATABASE_URL=";
        databaseUrl = File.ReadLines(archivo).Select(linea => linea.Trim())
            .FirstOrDefault(linea => linea.StartsWith(clave, StringComparison.Ordinal))?[clave.Length..]
            .Trim().Trim('"', (char)39);
    }
}

if (!Uri.TryCreate(databaseUrl, UriKind.Absolute, out var db) ||
    db.Scheme is not ("postgres" or "postgresql") || db.AbsolutePath.Length < 2)
    throw new InvalidOperationException("Configura DATABASE_URL con la dirección PostgreSQL del proyecto.");

var usuario = db.UserInfo.Split(':', 2);
var conexion = new NpgsqlConnectionStringBuilder
{
    Host = db.IdnHost,
    Port = db.IsDefaultPort ? 5432 : db.Port,
    Database = Uri.UnescapeDataString(db.AbsolutePath[1..]),
    Username = Uri.UnescapeDataString(usuario[0]),
    Password = usuario.Length == 2 ? Uri.UnescapeDataString(usuario[1]) : null,
    ApplicationName = "Scca.Api"
};
foreach (var parametro in Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(db.Query))
{
    if (!parametro.Key.Equals("sslmode", StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException($"Opción de DATABASE_URL no admitida: {parametro.Key}");
    conexion.SslMode = parametro.Value.ToString().ToLowerInvariant() switch
    {
        "disable" => SslMode.Disable, "allow" => SslMode.Allow, "prefer" => SslMode.Prefer,
        "require" => SslMode.Require, "verify-ca" => SslMode.VerifyCA, "verify-full" => SslMode.VerifyFull,
        _ => throw new InvalidOperationException("sslmode inválido en DATABASE_URL.")
    };
}
builder.Services.AddSingleton(_ => NpgsqlDataSource.Create(conexion.ConnectionString));

// Conectar la API .NET con el servicio interno del modelo ML.
builder.Services.AddHttpClient("ModeloMl", client =>
{
    var url = builder.Configuration["Ml:BaseUrl"] ?? "http://127.0.0.1:8000/";
    client.BaseAddress = new Uri(url.TrimEnd('/') + "/");
    client.Timeout = TimeSpan.FromSeconds(15);
});

builder.Services.AddHttpClient("Panel", client =>
{
    var port = builder.Configuration["PORT"] ?? "3000";
    client.BaseAddress = new Uri(builder.Configuration["Panel:BaseUrl"] ?? $"http://127.0.0.1:{port}/");
    client.Timeout = TimeSpan.FromSeconds(8);
}).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });

var app = builder.Build();

// Configure the HTTP request pipeline.

if (!app.Environment.IsDevelopment())
    app.UseHttpsRedirection();

if (app.Configuration.GetValue("Swagger:Habilitado", app.Environment.IsDevelopment()))
{
    app.UseSwagger();
    app.UseSwaggerUI(options =>
    {
        options.DocumentTitle = "SCCA | Swagger";
        options.SwaggerEndpoint("./v1/swagger.json", "API SCCA v1");
    });
}

app.UseCors("SwaggerPanel");
app.UseAuthorization();

app.MapControllers();

app.Run();
