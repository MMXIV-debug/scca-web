using Npgsql;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.

builder.Services.AddControllers();
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
var connectionString =
    builder.Configuration.GetConnectionString("Postgres")
    ?? throw new InvalidOperationException(
        "Falta configurar la conexión con PostgreSQL.");

builder.Services.AddSingleton(
    NpgsqlDataSource.Create(connectionString));

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

app.UseAuthorization();

app.MapControllers();

app.Run();
