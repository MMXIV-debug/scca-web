using Npgsql;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

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

var app = builder.Build();

// Configure the HTTP request pipeline.

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}
else
{
    app.UseHttpsRedirection();
}

app.UseAuthorization();

app.MapControllers();

app.Run();