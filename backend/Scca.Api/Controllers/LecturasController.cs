using System.ComponentModel.DataAnnotations;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Npgsql;
using NpgsqlTypes;

namespace Scca.Api.Controllers;

public sealed class LecturaIot
{
    [Required, StringLength(20, MinimumLength = 1)]
    public required string VariableCodigo { get; init; }
    [Range(1, short.MaxValue)]
    public required short UnidadId { get; init; }
    [Range(typeof(decimal), "-273.15", "99999999.9999", ParseLimitsInInvariantCulture = true)]
    public required decimal Valor { get; init; }
}

public sealed class MuestraIot
{
    [Range(1, int.MaxValue)]
    public int SensorId { get; init; }
    [Range(1, long.MaxValue)]
    public long IdMuestra { get; init; }
    [System.Text.Json.Serialization.JsonConverter(typeof(Scca.Api.Services.FechaConZonaConverter))]
    public required DateTimeOffset MedidoEn { get; init; }
    [Required, MinLength(1), MaxLength(32)]
    public required List<LecturaIot> Lecturas { get; init; }
}

[ApiController]
[Route("api/lecturas")]
public sealed class LecturasController(
    NpgsqlDataSource database, IHttpClientFactory clients,
    IConfiguration configuration, ILogger<LecturasController> logger) : ControllerBase
{
    [HttpPost]
    [RequestSizeLimit(16384)]
    [ProducesResponseType(StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<IActionResult> Recibir(
        MuestraIot muestra,
        [FromHeader(Name = "X-Api-Key")] string? apiKey,
        CancellationToken cancellationToken)
    {
        var expected = configuration["Iot:ApiKey"];
        if (string.IsNullOrWhiteSpace(expected))
            return Problem(statusCode: 503, title: "Falta configurar Iot:ApiKey.");
        if (apiKey is null || !CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(Encoding.UTF8.GetBytes(expected)),
            SHA256.HashData(Encoding.UTF8.GetBytes(apiKey))))
            return Unauthorized();

        if (muestra.MedidoEn == default || muestra.MedidoEn > DateTimeOffset.UtcNow.AddMinutes(5))
            return BadRequest(new { error = "medidoEn es obligatorio y no puede estar en el futuro." });
        if (muestra.Lecturas.Any(l => l is null || decimal.Round(l.Valor, 4) != l.Valor)
            || muestra.Lecturas.Select(l => l.VariableCodigo).Distinct(StringComparer.Ordinal).Count() != muestra.Lecturas.Count)
            return BadRequest(new { error = "Las variables no deben repetirse y los valores admiten hasta cuatro decimales." });

        try
        {
            await using var connection = await database.OpenConnectionAsync(cancellationToken);
            await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
            // Evitar duplicados si el sensor reenvía una muestra.
            await using (var command = new NpgsqlCommand("SELECT pg_advisory_xact_lock(192837, @sensor)", connection, transaction))
            {
                command.Parameters.AddWithValue("sensor", muestra.SensorId);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }
            string modelo, origen;
            int nodoId;
            await using (var command = new NpgsqlCommand("SELECT modelo,origen,nodo_id FROM public.sensor WHERE id = @sensor AND activo FOR SHARE", connection, transaction))
            {
                command.Parameters.AddWithValue("sensor", muestra.SensorId);
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken))
                    return BadRequest(new { error = "El sensor no existe o está inactivo." });
                modelo = reader.GetString(0).Trim().ToUpperInvariant();
                origen = reader.GetString(1);
                nodoId = reader.GetInt32(2);
            }
            var perfil = origen == "simulado" ? "contaminantes_simulados"
                : modelo == "DHT11" ? "dht11" : modelo == "BME680" ? "bme680" : null;
            if (perfil is null) return UnprocessableEntity(new { error = "Hardware sin perfil de ingesta definido." });
            var unidades = perfil switch
            {
                "dht11" => new Dictionary<string,string> { ["TEMP"]="°C", ["HUM"]="%" },
                "bme680" => new Dictionary<string,string> { ["TEMP"]="°C", ["HUM"]="%", ["PRES"]="hPa", ["GAS"]="ohm" },
                _ => new Dictionary<string,string> { ["CO"]="µg/m3", ["PM1"]="µg/m3", ["PM10"]="µg/m3", ["PM25"]="µg/m3" }
            };
            if (!muestra.Lecturas.Select(l=>l.VariableCodigo).ToHashSet().SetEquals(unidades.Keys))
                return UnprocessableEntity(new { error = "La muestra debe contener todas y solo las variables del perfil.", perfil, variables = unidades.Keys });
            if (muestra.Lecturas.Any(l => l.VariableCodigo switch
                {
                    "TEMP" => perfil == "dht11" && (l.Valor < 0 || l.Valor > 50),
                    "HUM" => l.Valor < 0 || l.Valor > 100,
                    "PRES" or "GAS" => l.Valor <= 0,
                    _ => l.Valor < 0
                })) return UnprocessableEntity(new { error = "Valor fuera del rango físico admitido por el perfil.", perfil });
            await using (var command = new NpgsqlCommand("""
                SELECT EXISTS(SELECT 1 FROM public.lectura_original WHERE sensor_id=@sensor AND id_muestra=@muestra)
                    OR EXISTS(SELECT 1 FROM public.lectura_cuarentena
                        WHERE payload->>'sensorId'=@sensorTexto AND payload->>'idMuestra'=@muestraTexto)
                """, connection, transaction))
            {
                command.Parameters.AddWithValue("sensor", muestra.SensorId);
                command.Parameters.AddWithValue("muestra", muestra.IdMuestra);
                command.Parameters.AddWithValue("sensorTexto", muestra.SensorId.ToString(System.Globalization.CultureInfo.InvariantCulture));
                command.Parameters.AddWithValue("muestraTexto", muestra.IdMuestra.ToString(System.Globalization.CultureInfo.InvariantCulture));
                if (await command.ExecuteScalarAsync(cancellationToken) is true)
                    return Conflict(new { error = "Esta muestra del sensor ya fue recibida." });
            }
            var ids = new Dictionary<string, short>(StringComparer.Ordinal);
            await using (var catalogo = new NpgsqlCommand("SELECT count(*) FROM public.sensor_variable WHERE sensor_id=@sensor",connection,transaction)) {
                catalogo.Parameters.AddWithValue("sensor",muestra.SensorId);
                if((long)(await catalogo.ExecuteScalarAsync(cancellationToken))! != unidades.Count)
                    return UnprocessableEntity(new {error="El catálogo del sensor no coincide con su perfil."});
            }
            foreach (var lectura in muestra.Lecturas)
            {
                await using var command = new NpgsqlCommand("""
                    SELECT v.id,u.simbolo FROM public.variable v
                    JOIN public.sensor_variable sv ON sv.variable_id=v.id
                    JOIN public.unidad u ON u.id=v.unidad_id
                    WHERE sv.sensor_id=@sensor AND v.codigo=@codigo AND v.unidad_id=@unidad
                    """, connection, transaction);
                command.Parameters.AddWithValue("sensor", muestra.SensorId);
                command.Parameters.AddWithValue("codigo", lectura.VariableCodigo);
                command.Parameters.AddWithValue("unidad", lectura.UnidadId);
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken))
                    return BadRequest(new { error = $"Variable o unidad no configurada para el sensor: {lectura.VariableCodigo}." });
                var simbolo = reader.GetString(1).Replace("μ","µ").Replace("³","3").Replace("Ω","ohm").Trim();
                if (simbolo != unidades[lectura.VariableCodigo])
                    return UnprocessableEntity(new { error = "El catálogo usa unidades incompatibles con el perfil." });
                ids.Add(lectura.VariableCodigo, reader.GetInt16(0));
            }

            bool? esAnomalia = null;
            string estadoMl = "sin_modelo";
            string? modeloVersion = null;
            // Consultar por perfil; Python solo utiliza el detector legado como
            // respaldo de contaminantes simulados, nunca para hardware distinto.
            {
              try {
                var valores = muestra.Lecturas.ToDictionary(l => l.VariableCodigo, l => l.Valor);
                using var limiteMl = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                limiteMl.CancelAfter(TimeSpan.FromSeconds(3));
                using var requestMl = new HttpRequestMessage(HttpMethod.Post,"api/v2/modelos/muestra")
                    { Content=JsonContent.Create(new {nodo_id=nodoId,sensor_id=muestra.SensorId,perfil,valores}) };
                requestMl.Headers.Add("X-Api-Key",expected);
                using var response = await clients.CreateClient("ModeloMl").SendAsync(requestMl,limiteMl.Token);
                estadoMl = response.IsSuccessStatusCode ? "respuesta_invalida" : "ml_no_disponible";
                if (response.IsSuccessStatusCode) {
                    using var result = JsonDocument.Parse(await response.Content.ReadAsStringAsync(limiteMl.Token));
                    bool identidadCorrecta=result.RootElement.TryGetProperty("sensor_id",out var sensorMl) && sensorMl.TryGetInt32(out var sensorRespuesta) && sensorRespuesta==muestra.SensorId
                        && result.RootElement.TryGetProperty("nodo_id",out var nodoMl) && nodoMl.TryGetInt32(out var nodoRespuesta) && nodoRespuesta==nodoId
                        && result.RootElement.TryGetProperty("perfil",out var perfilResultado) && perfilResultado.GetString()==perfil;
                    if(identidadCorrecta && result.RootElement.TryGetProperty("estado",out var estadoSinModelo) && estadoSinModelo.GetString()=="sin_modelo"
                        && result.RootElement.TryGetProperty("es_anomalia",out var noAnomalia) && noAnomalia.ValueKind==JsonValueKind.Null
                        && result.RootElement.TryGetProperty("modelo_version",out var noVersion) && noVersion.ValueKind==JsonValueKind.Null) estadoMl="sin_modelo";
                    if (identidadCorrecta && result.RootElement.TryGetProperty("es_anomalia", out var anomaly)
                        && anomaly.ValueKind is JsonValueKind.True or JsonValueKind.False
                        && result.RootElement.TryGetProperty("modelo_version", out var version)
                        && version.ValueKind == JsonValueKind.String
                        && System.Text.RegularExpressions.Regex.IsMatch(version.GetString()!, "^(?:[a-f0-9]{32}|[a-f0-9]{64})$")
                        && result.RootElement.TryGetProperty("estado",out var estadoModelo) && estadoModelo.GetString() is "evaluado_legacy" or "evaluado_demo"
                        && (estadoModelo.GetString()=="evaluado_demo"?version.GetString()!.Length==32:version.GetString()!.Length==64)
                        && result.RootElement.TryGetProperty("perfil", out var perfilMl) && perfilMl.GetString() == perfil) {
                        esAnomalia = anomaly.GetBoolean(); modeloVersion = version.GetString(); estadoMl = estadoModelo.GetString()!;
                    }
                }
              } catch (Exception ex) when (ex is HttpRequestException or JsonException or InvalidOperationException
                  || ex is OperationCanceledException && !cancellationToken.IsCancellationRequested) {
                  estadoMl = ex is JsonException or InvalidOperationException ? "respuesta_invalida" : "ml_no_disponible";
              }
            }
            var evaluacionMl = new { perfil, origen, nodoId, estado = estadoMl, esAnomalia, modeloVersion,
                validacionIndependiente = false, unidades,
                interpretacion = "Una anomalía indica una lectura inusual; no confirma un fallo de sensor.",
                procedenciaVariables = perfil == "contaminantes_simulados" ? new Dictionary<string,string> { ["PM25"]="Open-Meteo/CAMS", ["PM10"]="Open-Meteo/CAMS", ["CO"]="Open-Meteo/CAMS", ["PM1"]="estimado: 0.70 × PM25" } : null };
            await using (var command = new NpgsqlCommand("""
                INSERT INTO public.evaluacion_muestra(sensor_id,id_muestra,nodo_id,perfil,origen,medido_en,estado,es_anomalia,modelo_version,evidencia)
                VALUES(@sensor,@muestra,@nodo,@perfil,@origen,@fecha,@estado,@anomalia,@version,@evidencia)
                """, connection, transaction)) {
                command.Parameters.AddWithValue("sensor",muestra.SensorId);
                command.Parameters.AddWithValue("muestra",muestra.IdMuestra);
                command.Parameters.AddWithValue("nodo",nodoId);
                command.Parameters.AddWithValue("perfil",perfil);
                command.Parameters.AddWithValue("origen",origen);
                command.Parameters.AddWithValue("fecha",muestra.MedidoEn.UtcDateTime);
                command.Parameters.AddWithValue("estado",estadoMl);
                command.Parameters.AddWithValue("anomalia",NpgsqlDbType.Boolean,(object?)esAnomalia ?? DBNull.Value);
                command.Parameters.AddWithValue("version",NpgsqlDbType.Text,(object?)modeloVersion ?? DBNull.Value);
                command.Parameters.AddWithValue("evidencia",NpgsqlDbType.Jsonb,JsonSerializer.Serialize(evaluacionMl));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }
            var idsGuardados = new List<long>();
            if (esAnomalia == true)
            {
                await using var command = new NpgsqlCommand("""
                    INSERT INTO public.lectura_cuarentena(payload, causa)
                    VALUES (@payload, 'Anomalía detectada por el modelo ML') RETURNING id
                    """, connection, transaction);
                command.Parameters.AddWithValue("payload", NpgsqlDbType.Jsonb,
                    JsonSerializer.Serialize(new { muestra.SensorId,idMuestra=muestra.IdMuestra.ToString(System.Globalization.CultureInfo.InvariantCulture),muestra.MedidoEn,muestra.Lecturas,evaluacionMl }, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
                idsGuardados.Add((long)(await command.ExecuteScalarAsync(cancellationToken))!);
            }
            else
            {
                foreach (var lectura in muestra.Lecturas)
                {
                    await using var command = new NpgsqlCommand("""
                        INSERT INTO public.lectura_original(sensor_id, variable_id, unidad_id, id_muestra, valor, medido_en, calidad)
                        VALUES (@sensor, @variable, @unidad, @muestra, @valor, @fecha, 'valida') RETURNING id
                        """, connection, transaction);
                    command.Parameters.AddWithValue("sensor", muestra.SensorId);
                    command.Parameters.AddWithValue("variable", ids[lectura.VariableCodigo]);
                    command.Parameters.AddWithValue("unidad", lectura.UnidadId);
                    command.Parameters.AddWithValue("muestra", muestra.IdMuestra);
                    command.Parameters.AddWithValue("valor", lectura.Valor);
                    command.Parameters.AddWithValue("fecha", muestra.MedidoEn.UtcDateTime);
                    idsGuardados.Add((long)(await command.ExecuteScalarAsync(cancellationToken))!);
                }
            }
            await transaction.CommitAsync(cancellationToken);
            return StatusCode(201, new { muestra.SensorId, muestra.IdMuestra, estado = esAnomalia == true ? "cuarentena" : "guardada", esAnomalia, evaluacionMl, ids = idsGuardados });
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return Conflict(new { error = "Esta muestra ya fue recibida." });
        }
        catch (Exception ex) when (ex is HttpRequestException or NpgsqlException or JsonException
            || ex is OperationCanceledException && !cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning("No se pudo procesar la muestra: {Tipo}", ex.GetType().Name);
            return Problem(statusCode: 503, title: "No se pudo completar el procesamiento. Reintenta con el mismo idMuestra.");
        }
    }
}
