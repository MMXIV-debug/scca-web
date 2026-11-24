using System.ComponentModel.DataAnnotations;
using System.Data;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Npgsql;
using Scca.Api.Services;
using System.Text.Json.Nodes;

namespace Scca.Api.Controllers;

public sealed class SolicitudEvaluacionMl
{
    [Range(1, int.MaxValue)]
    public int SensorId { get; init; }
    [Required, RegularExpression("^(calibracion|pronostico|anomalias)$")]
    public required string Proposito { get; init; }
    [Required, StringLength(20, MinimumLength = 1)]
    public required string Variable { get; init; }
    public int HorizonteH { get; init; }
    [System.Text.Json.Serialization.JsonConverter(typeof(FechaConZonaConverter))]
    public DateTimeOffset HoraInicio { get; init; }
    public bool GuardarResultado { get; init; }
}

/// <summary>Consulta de demostración, sin persistir ni modificar la ingesta IoT.</summary>
[ApiController]
[Route("api/modelo/evaluar")]
public sealed class EvaluacionMlController(
    NpgsqlDataSource database, IHttpClientFactory clients,
    IConfiguration configuration, ILogger<EvaluacionMlController> logger) : ControllerBase
{
    [HttpGet("/api/modelo/resultados")]
    public async Task<IActionResult> Resultados([FromQuery] int sensorId, [FromQuery] long despuesDe = 0,
        [FromQuery] int limite = 50, [FromHeader(Name = "X-Api-Key")] string? apiKey = null,
        CancellationToken cancellationToken = default)
    {
        var clave = configuration["Iot:ApiKey"];
        if (string.IsNullOrWhiteSpace(clave))
            return Problem(statusCode: 503, title: "Falta configurar Iot:ApiKey.");
        if (apiKey is null || !CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(Encoding.UTF8.GetBytes(clave)), SHA256.HashData(Encoding.UTF8.GetBytes(apiKey))))
            return Unauthorized();
        if (sensorId <= 0 || despuesDe < 0 || limite is < 1 or > 100)
            return BadRequest(new { error = "sensorId positivo, despuesDe no negativo y limite entre 1 y 100." });
        try
        {
            await using var connection = await database.OpenConnectionAsync(cancellationToken);
            await using var command = new NpgsqlCommand("""
                SELECT r.id, r.periodo_inicio, r.periodo_fin, r.entrada_sha256, r.resultado, r.creado_en
                FROM public.ml_demo_resultado r JOIN public.ml_demo_version v ON v.version=r.version
                WHERE v.sensor_id=@sensor AND r.id>@despues ORDER BY r.id LIMIT @limite
                """, connection);
            command.Parameters.AddWithValue("sensor", sensorId);
            command.Parameters.AddWithValue("despues", despuesDe);
            command.Parameters.AddWithValue("limite", limite);
            var items = new List<object>();
            long cursor = despuesDe;
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                cursor = reader.GetInt64(0);
                items.Add(new { id = cursor, periodo_inicio = reader.GetDateTime(1), periodo_fin = reader.GetDateTime(2),
                    entrada_sha256 = reader.GetString(3), resultado = JsonSerializer.Deserialize<JsonElement>(reader.GetString(4)),
                    creado_en = reader.GetDateTime(5) });
            }
            return Ok(new { ambito = "demostracion", items, siguiente_despues_de = cursor });
        }
        catch (Exception ex) when (ex is NpgsqlException or JsonException
            || ex is OperationCanceledException && !cancellationToken.IsCancellationRequested)
        {
            return Problem(statusCode: 503, title: "No se pudo consultar resultados. Comprueba la migración y conexión.");
        }
    }

    [HttpPost]
    [RequestSizeLimit(4096)]
    public async Task<IActionResult> Evaluar(SolicitudEvaluacionMl solicitud,
        [FromHeader(Name = "X-Api-Key")] string? apiKey, CancellationToken cancellationToken)
    {
        var clave = configuration["Iot:ApiKey"];
        if (string.IsNullOrWhiteSpace(clave))
            return Problem(statusCode: 503, title: "Falta configurar Iot:ApiKey.");
        if (apiKey is null || !CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(Encoding.UTF8.GetBytes(clave)), SHA256.HashData(Encoding.UTF8.GetBytes(apiKey))))
            return Unauthorized();
        if (solicitud.GuardarResultado && !configuration.GetValue<bool>("Ml:PersistenciaDemoHabilitada"))
            return Problem(statusCode: 503, title: "La persistencia de demostración no está habilitada. Aplica la migración y configura Ml:PersistenciaDemoHabilitada.");
        if (solicitud.Proposito == "pronostico" ? solicitud.HorizonteH is not (1 or 3 or 6) : solicitud.HorizonteH != 0)
            return BadRequest(new { error = "Pronóstico requiere horizonteH 1, 3 o 6; los otros propósitos requieren 0." });
        var inicio = solicitud.HoraInicio.UtcDateTime;
        if (solicitud.HoraInicio == default || inicio.Ticks % TimeSpan.TicksPerHour != 0
            || inicio > DateTime.UtcNow.AddHours(-1))
            return BadRequest(new { error = "horaInicio debe indicar una hora UTC completa y cerrada." });
        var fin = inicio.AddHours(1);
        try
        {
            await using var connection = await database.OpenConnectionAsync(cancellationToken);
            await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.RepeatableRead, cancellationToken);
            await using (var readonlyCommand = new NpgsqlCommand("SET TRANSACTION READ ONLY", connection, transaction))
                await readonlyCommand.ExecuteNonQueryAsync(cancellationToken);
            int nodoId, intervaloNodo;
            string origen, modelo;
            await using (var command = new NpgsqlCommand("""
                SELECT s.nodo_id, s.modelo, s.origen, n.intervalo_muestreo_s
                FROM public.sensor s JOIN public.nodo n ON n.id=s.nodo_id
                WHERE s.id=@sensor AND s.activo
                """, connection, transaction))
            {
                command.Parameters.AddWithValue("sensor", solicitud.SensorId);
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken))
                    return NotFound(new { error = "Sensor inexistente o inactivo." });
                nodoId = reader.GetInt32(0);
                modelo = reader.GetString(1).Trim().ToUpperInvariant();
                origen = reader.GetString(2);
                intervaloNodo = reader.GetInt32(3);
            }
            var perfil = origen == "simulado" ? "contaminantes_simulados"
                : modelo == "DHT11" ? "dht11" : modelo == "BME680" ? "bme680" : null;
            if (perfil is null)
                return UnprocessableEntity(new { error = "El sensor no tiene un perfil ML compatible." });
            var unidades = perfil switch
            {
                "dht11" => new Dictionary<string, string> { ["TEMP"] = "°C", ["HUM"] = "%" },
                "bme680" => new Dictionary<string, string> { ["TEMP"] = "°C", ["HUM"] = "%", ["PRES"] = "hPa", ["GAS"] = "ohm" },
                _ => new Dictionary<string, string> { ["CO"] = "µg/m3", ["PM1"] = "µg/m3", ["PM10"] = "µg/m3", ["PM25"] = "µg/m3" }
            };
            if (!unidades.ContainsKey(solicitud.Variable))
                return UnprocessableEntity(new { error = "La variable no pertenece al perfil del sensor." });
            if (solicitud.Proposito == "anomalias" && solicitud.Variable != (perfil == "contaminantes_simulados" ? "PM25" : "TEMP"))
                return UnprocessableEntity(new { error = "El detector evalúa el perfil completo: seleccionar PM25 para contaminantes o TEMP para perfiles físicos." });
            var catalogo = new Dictionary<string, string>();
            await using (var command = new NpgsqlCommand("""
                SELECT v.codigo, u.simbolo FROM public.sensor_variable sv
                JOIN public.variable v ON v.id=sv.variable_id JOIN public.unidad u ON u.id=v.unidad_id
                WHERE sv.sensor_id=@sensor
                """, connection, transaction))
            {
                command.Parameters.AddWithValue("sensor", solicitud.SensorId);
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                    catalogo[reader.GetString(0)] = reader.GetString(1).Replace("μ", "µ").Replace("³", "3").Replace("Ω", "ohm").Trim();
            }
            if (catalogo.Count != unidades.Count || unidades.Any(u => !catalogo.TryGetValue(u.Key, out var valor) || valor != u.Value))
                return UnprocessableEntity(new { error = "Catálogo/unidades incompatibles con el perfil ML." });
            var seleccion = new
            {
                nodo_id = nodoId, sensor_id = solicitud.SensorId, perfil, proposito = solicitud.Proposito,
                variable = solicitud.Variable, horizonte_h = solicitud.HorizonteH
            };
            var cliente = clients.CreateClient("ModeloMl");
            using var estadoRequest = new HttpRequestMessage(HttpMethod.Post, "api/v2/modelos/estado")
            { Content = JsonContent.Create(seleccion) };
            estadoRequest.Headers.Add("X-Api-Key", clave);
            using var estadoResponse = await cliente.SendAsync(estadoRequest, cancellationToken);
            if (!estadoResponse.IsSuccessStatusCode)
                return Problem(statusCode: 503, title: "No se pudo consultar el registro ML. Revisa versiones y configuración.");
            var estado = await estadoResponse.Content.ReadFromJsonAsync<JsonElement>(cancellationToken);
            if (estado.GetProperty("sensor_id").GetInt32() != solicitud.SensorId || estado.GetProperty("nodo_id").GetInt32() != nodoId)
                return Problem(statusCode: 502, title: "Identidad de respuesta ML incompatible.");
            if (estado.GetProperty("perfil").GetString() != perfil || estado.GetProperty("proposito").GetString() != solicitud.Proposito
                || estado.GetProperty("variable").GetString() != solicitud.Variable
                || estado.GetProperty("horizonte_h").GetInt32() != solicitud.HorizonteH)
                return Problem(statusCode: 502, title: "Selección de respuesta ML incompatible.");
            var sinModelo = estado.GetProperty("estado").GetString() == "sin_modelo";
            if (solicitud.Proposito == "anomalias") return Ok(estado); // detector instantáneo: no aplicar a una media horaria
            if (!sinModelo && (estado.GetProperty("estado").GetString() != "disponible_demo"
                || estado.GetProperty("entrada_agregado_s").GetInt32() != 3600))
                return Problem(statusCode: 502, title: "Contrato temporal ML incompatible.");
            int? intervaloConfigurado = configuration.GetValue<int?>($"Ml:IntervalosSensor:{solicitud.SensorId}");
            var arranqueDemo = false;
            double coberturaSinModelo = .75;
            if (configuration.GetValue<bool>("Ml:PoliticaVersionadaHabilitada"))
            {
                await using var policyCommand = new NpgsqlCommand("SELECT to_jsonb(p)::text FROM public.politica_ml p WHERE vigente_hasta IS NULL ORDER BY version DESC LIMIT 1", connection, transaction);
                var policyJson = await policyCommand.ExecuteScalarAsync(cancellationToken) as string;
                if (policyJson is null) return Problem(statusCode:503,title:"No hay política vigente.");
                using var policy = JsonDocument.Parse(policyJson);
                var configuracion = policy.RootElement.GetProperty("configuracion");
                if (policy.RootElement.TryGetProperty("completitud_min_pct", out var completitud))
                    coberturaSinModelo = completitud.GetDouble() / 100;
                arranqueDemo = configuracion.TryGetProperty("arranque_demo",out var arranque) && arranque.ValueKind == JsonValueKind.True;
                if (configuracion.TryGetProperty("intervalos_sensor",out var intervalos)
                    && intervalos.TryGetProperty(solicitud.SensorId.ToString(),out var frecuencia))
                    intervaloConfigurado=frecuencia.GetInt32();
            }
            if (origen == "simulado" && intervaloConfigurado is null)
                return UnprocessableEntity(new { error = "Configura Ml:IntervalosSensor para la frecuencia histórica del simulador." });
            var intervalo = intervaloConfigurado ?? intervaloNodo;
            if (intervalo <= 0 || intervalo > 3600 || 3600 % intervalo != 0
                || (!sinModelo && intervalo != estado.GetProperty("intervalo_s").GetInt32()))
                return UnprocessableEntity(new { error = "Frecuencia del sensor incompatible con el modelo. No se infiere desde los huecos." });
            var columnas = sinModelo ? [solicitud.Variable] : estado.GetProperty("variables_entrada").EnumerateArray().Select(x => x.GetString()!).ToArray();
            if (columnas.Length == 0 || columnas.Distinct().Count() != columnas.Length || columnas.Any(c => !unidades.ContainsKey(c)))
                return Problem(statusCode: 502, title: "Contrato de variables ML incompatible.");
            var coberturaMinima = sinModelo ? coberturaSinModelo : estado.GetProperty("completitud_minima").GetDouble();
            if (!double.IsFinite(coberturaMinima) || coberturaMinima < .75 || coberturaMinima > 1)
                return Problem(statusCode: 502, title: "Política de cobertura ML incompatible.");
            var valores = new Dictionary<string, double>();
            var cobertura = columnas.ToDictionary(c => c, _ => 0.0);
            await using (var command = new NpgsqlCommand("""
                WITH slots AS (
                    SELECT v.codigo,
                        date_bin(make_interval(secs => @intervalo), l.medido_en, TIMESTAMPTZ '1970-01-01 00:00:00+00') AS slot,
                        AVG(l.valor) AS valor
                    FROM public.lectura_original l JOIN public.variable v ON v.id=l.variable_id
                    WHERE l.sensor_id=@sensor AND l.medido_en>=@inicio AND l.medido_en<@fin
                        AND l.calidad='valida' AND v.codigo=ANY(@columnas)
                    GROUP BY v.codigo, slot
                ) SELECT codigo, AVG(valor), COUNT(*) FROM slots GROUP BY codigo
                """, connection, transaction))
            {
                command.Parameters.AddWithValue("intervalo", (double)intervalo);
                command.Parameters.AddWithValue("sensor", solicitud.SensorId);
                command.Parameters.AddWithValue("inicio", inicio);
                command.Parameters.AddWithValue("fin", fin);
                command.Parameters.AddWithValue("columnas", columnas);
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                {
                    var codigo = reader.GetString(0);
                    valores[codigo] = (double)reader.GetDecimal(1);
                    cobertura[codigo] = reader.GetInt64(2) / (3600.0 / intervalo);
                }
            }
            await transaction.CommitAsync(cancellationToken); // transacción de solo lectura
            var incompleta = columnas.Any(c => cobertura[c] < coberturaMinima || !valores.ContainsKey(c));
            if (sinModelo)
            {
                double? original = !incompleta ? valores[solicitud.Variable] : null;
                return Ok(new { estado = incompleta ? "datos_incompletos" : "sin_modelo",
                    estado_correccion = "no_corregido", ambito = "demostracion",
                    sensor_id = solicitud.SensorId, nodo_id = nodoId, perfil,
                    proposito = solicitud.Proposito, variable = solicitud.Variable, horizonte_h = solicitud.HorizonteH,
                    valor = original, valor_original = original, unidad = unidades[solicitud.Variable],
                    modelo_version = (string?)null, periodo_inicio = inicio, periodo_fin = fin, cobertura,
                    persistido = false, calibracion_fisica_validada = false });
            }
            var usarFuente = incompleta && arranqueDemo && origen == "simulado" && solicitud.Proposito == "pronostico";
            if (incompleta && !usarFuente)
                return Ok(new { estado = "datos_incompletos", ambito = "demostracion", sensor_id = solicitud.SensorId,
                    nodo_id = nodoId, perfil, proposito = solicitud.Proposito, variable = solicitud.Variable,
                    horizonte_h = solicitud.HorizonteH,
                    modelo_version = estado.GetProperty("modelo_version").GetString(), cobertura,
                    valor = (double?)null, es_anomalia = (bool?)null, calibracion_fisica_validada = false });
            using var request = new HttpRequestMessage(HttpMethod.Post, usarFuente ? "api/v2/modelos/inferir-fuente" : "api/v2/modelos/inferir")
            {
                Content = usarFuente ? JsonContent.Create(new
                {
                    seleccion.nodo_id, seleccion.sensor_id, seleccion.perfil, seleccion.proposito,
                    seleccion.variable, seleccion.horizonte_h,
                    modelo_version = estado.GetProperty("modelo_version").GetString(),
                    periodo_inicio = inicio, periodo_fin = fin
                }) : JsonContent.Create(new
                {
                    seleccion.nodo_id, seleccion.sensor_id, seleccion.perfil, seleccion.proposito,
                    seleccion.variable, seleccion.horizonte_h, valores,
                    modelo_version = estado.GetProperty("modelo_version").GetString(),
                    periodo_inicio = inicio, periodo_fin = fin
                })
            };
            request.Headers.Add("X-Api-Key", clave);
            using var response = await cliente.SendAsync(request, cancellationToken);
            if (response.StatusCode == HttpStatusCode.Conflict)
                return Conflict(new { error = "Cambió el modelo activo. Reintenta para recalcular la entrada." });
            if (response.StatusCode == HttpStatusCode.UnprocessableEntity)
                return UnprocessableEntity(new { error = "La entrada no coincide con el contrato de inferencia." });
            if (!response.IsSuccessStatusCode)
                return Problem(statusCode: 503, title: "No se pudo ejecutar el modelo. No se generó ni guardó un resultado.");
            var resultado = await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken);
            if (resultado.GetProperty("modelo_version").GetString() != estado.GetProperty("modelo_version").GetString()
                || resultado.GetProperty("sensor_id").GetInt32() != solicitud.SensorId
                || resultado.GetProperty("nodo_id").GetInt32() != nodoId
                || resultado.GetProperty("estado").GetString() is not ("evaluado_demo" or "fuera_dominio"))
                return Problem(statusCode: 502, title: "Resultado ML incompatible con la solicitud.");
            if (solicitud.Proposito == "calibracion")
            {
                var detalle = JsonNode.Parse(resultado.GetRawText())!.AsObject();
                detalle["valor_original"] = valores[solicitud.Variable];
                detalle["estado_correccion"] = resultado.GetProperty("estado").GetString() == "evaluado_demo"
                    ? "corregido" : "fuera_dominio";
                resultado = JsonSerializer.SerializeToElement(detalle);
            }
            if (solicitud.GuardarResultado)
            {
                var resultadoId = await ResultadosMlStore.Guardar(database, solicitud.SensorId, nodoId,
                    perfil, solicitud.Proposito, solicitud.Variable, solicitud.HorizonteH, inicio, fin,
                    usarFuente ? JsonSerializer.Serialize(new { origen = "historial_modelado_Open-Meteo", valores = resultado.GetProperty("entrada_fuente").GetProperty("valores"), cobertura_original = cobertura, intervalo_s = intervalo, completitud_minima = coberturaMinima })
                        : ResultadosMlStore.EntradaCanonica(valores, cobertura, intervalo, coberturaMinima), resultado, cancellationToken);
                var salida = JsonNode.Parse(resultado.GetRawText())!.AsObject();
                salida["persistido"] = true;
                salida["resultado_id"] = resultadoId;
                return Ok(salida);
            }
            return Ok(resultado);
        }
        catch (Exception ex) when (ex is HttpRequestException or NpgsqlException or JsonException
            or InvalidOperationException or KeyNotFoundException or FormatException
            || ex is OperationCanceledException && !cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning("No se pudo evaluar ML: {Tipo}", ex.GetType().Name);
            return Problem(statusCode: 503, title: "No se pudo completar la consulta ML. No se modificaron lecturas.");
        }
    }
}
