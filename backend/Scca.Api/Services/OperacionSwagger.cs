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
        var acceso = context.MethodInfo.GetCustomAttributes(typeof(AccesoMlAttribute), true)
            .OfType<AccesoMlAttribute>().SingleOrDefault();
        if (header is null && acceso is null) return;
        if (header is not null) operation.Parameters!.Remove(header);
        operation.Security = [new OpenApiSecurityRequirement
        {
            [new OpenApiSecuritySchemeReference(acceso?.Esquema ?? "IoT", context.Document)] = []
        }];

        var path = context.ApiDescription.RelativePath;
        if (context.ApiDescription.HttpMethod == "DELETE")
        {
            operation.Description = path == "api/ml/politicas/{id}"
                ? "Da de baja la política. Si es la vigente, recupera la anterior. Debe quedar una vigente y sin modelos vinculados a la que se elimina."
                : "Elimina el registro y conserva el cambio en auditoría. Las dependencias impiden la baja.";
        }
        var editar = context.ApiDescription.HttpMethod == "PUT";
        if (operation.RequestBody?.Content?.TryGetValue("application/json", out var json) != true) return;
        if (path == "api/ml/politicas" || (editar && path == "api/ml/politicas/{id}"))
        {
            operation.Description = editar ? "Modifica la política indicada. Usa su número de versión en version_anterior." : "Usa la versión vigente como version_anterior. La operación crea otra versión y cierra la anterior.";
            json!.Example = JsonNode.Parse("""
                {"version_anterior":1,"motivo":"Ajuste del intervalo de recepción","completitud_min_pct":75,"colocacion_dias":30,"pares_minimos":540,"test_pct":30,"mejora_rmse_min_pct":20,"sin_datos_seg":300,"configuracion":{"factor_sin_datos":2,"intervalos_sensor":{},"alertas_ambientales":[],"alertas_predictivas":[]}}
                """);
        }
        if (path == "api/ml/modelos" || (editar && path == "api/ml/modelos/{id}"))
        {
            operation.Description = editar ? "Actualiza el modelo indicado y conserva su estado." : "El servicio ML registra una versión candidata. Usa una pareja sensor-variable y una política existentes.";
            json!.Example = JsonNode.Parse("""
                {"sensorId":1,"variableId":1,"politicaId":1,"version":1,"algoritmo":"random_forest","parametros":{"n_estimators":100}}
                """);
        }
        if (path == "api/ml/validaciones" || (editar && path == "api/ml/validaciones/{id}"))
        {
            operation.Description = editar ? "Actualiza la evaluación y comprueba sus métricas con la política indicada." : "Añade una evaluación al historial del modelo bajo la política con la que fue registrado.";
            json!.Example = JsonNode.Parse("""
                {"modeloId":1,"politicaId":1,"pares":600,"estado":"apto","maeOrig":2,"rmseOrig":2,"sesgoOrig":0,"maeMl":1,"rmseMl":1,"sesgoMl":0,"mejoraRmsePct":50}
                """);
        }
        if (path?.EndsWith("/revertir") == true)
            operation.Description = "Indica el ID del modelo activo. Se recupera una versión anterior de la misma pareja sensor-variable, previamente activada y con última evaluación apta.";
        if (path?.EndsWith("/suspender") == true || path?.EndsWith("/revertir") == true)
            json!.Example = JsonNode.Parse("""{"motivo":"Revisión de las últimas mediciones"}""");
        if (path == "api/lecturas")
        {
            operation.Description = "Ejemplo DHT11. Usa el sensor y las unidades de tu instalación, un idMuestra nuevo y la fecha de medición en UTC.";
            json!.Example = JsonNode.Parse("""{"sensorId":1,"idMuestra":1,"medidoEn":"2026-01-01T12:00:00Z","lecturas":[{"variableCodigo":"TEMP","unidadId":1,"valor":24},{"variableCodigo":"HUM","unidadId":2,"valor":55}]}""");
        }
        if (path == "api/modelo/evaluar")
        {
            operation.Description = "Selecciona un sensor activo, una variable de su perfil y una hora completa ya cerrada con zona horaria. Calibración devuelve valor_original y estado_correccion. Sin modelo, devuelve el promedio original como no_corregido si hay cobertura suficiente; no guarda una corrección ficticia.";
            json!.Example = JsonNode.Parse("""{"sensorId":1,"proposito":"calibracion","variable":"TEMP","horizonteH":0,"horaInicio":"2026-01-01T12:00:00Z","guardarResultado":false}""");
        }
    }
}
