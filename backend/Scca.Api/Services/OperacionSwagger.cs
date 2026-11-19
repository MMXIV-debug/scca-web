using Microsoft.OpenApi;
using Swashbuckle.AspNetCore.SwaggerGen;
using System.Text.Json.Nodes;

namespace Scca.Api.Services;

public sealed class OperacionSwagger : IOperationFilter
{
    public void Apply(OpenApiOperation operation, OperationFilterContext context)
    {
        var header = operation.Parameters?.FirstOrDefault(p =>
            p.In == ParameterLocation.Header && p.Name == "X-Api-Key");
        if (header is null) return;
        operation.Parameters!.Remove(header);
        operation.Security = [new OpenApiSecurityRequirement
        {
            [new OpenApiSecuritySchemeReference("IoT", context.Document)] = []
        }];

        var path = context.ApiDescription.RelativePath;
        if (operation.RequestBody?.Content?.TryGetValue("application/json", out var json) != true) return;
        if (path == "api/lecturas")
        {
            operation.Description = "Ejemplo DHT11. Usa el sensor y las unidades de tu instalación, un idMuestra nuevo y la fecha de medición en UTC.";
            json!.Example = JsonNode.Parse("""{"sensorId":1,"idMuestra":1,"medidoEn":"2026-01-01T12:00:00Z","lecturas":[{"variableCodigo":"TEMP","unidadId":1,"valor":24},{"variableCodigo":"HUM","unidadId":2,"valor":55}]}""");
        }
        if (path == "api/modelo/evaluar")
        {
            operation.Description = "Selecciona un sensor activo, una variable de su perfil y una hora completa ya cerrada con zona horaria.";
            json!.Example = JsonNode.Parse("""{"sensorId":1,"proposito":"calibracion","variable":"TEMP","horizonteH":0,"horaInicio":"2026-01-01T12:00:00Z","guardarResultado":false}""");
        }
    }
}
