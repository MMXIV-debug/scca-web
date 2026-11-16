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
    [Range(typeof(decimal), "0", "99999999.9999", ParseLimitsInInvariantCulture = true)]
    public required decimal Valor { get; init; }
}

public sealed class MuestraIot
{
    [Range(1, int.MaxValue)]
    public int SensorId { get; init; }
    [Range(1, long.MaxValue)]
    public long IdMuestra { get; init; }
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
            await using (var command = new NpgsqlCommand("SELECT activo FROM public.sensor WHERE id = @sensor FOR SHARE", connection, transaction))
            {
                command.Parameters.AddWithValue("sensor", muestra.SensorId);
                if (await command.ExecuteScalarAsync(cancellationToken) is not true)
                    return BadRequest(new { error = "El sensor no existe o está inactivo." });
            }
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
            foreach (var lectura in muestra.Lecturas)
            {
                await using var command = new NpgsqlCommand("""
                    SELECT v.id FROM public.variable v
                    JOIN public.sensor_variable sv ON sv.variable_id=v.id
                    WHERE sv.sensor_id=@sensor AND v.codigo=@codigo AND v.unidad_id=@unidad
                    """, connection, transaction);
                command.Parameters.AddWithValue("sensor", muestra.SensorId);
                command.Parameters.AddWithValue("codigo", lectura.VariableCodigo);
                command.Parameters.AddWithValue("unidad", lectura.UnidadId);
                var id = await command.ExecuteScalarAsync(cancellationToken);
                if (id is not short variableId)
                    return BadRequest(new { error = $"Variable o unidad no configurada para el sensor: {lectura.VariableCodigo}." });
                ids.Add(lectura.VariableCodigo, variableId);
            }

            var valores = muestra.Lecturas.ToDictionary(l => l.VariableCodigo, l => l.Valor);
            using var response = await clients.CreateClient("ModeloMl").PostAsJsonAsync(
                "api/predict/muestra", new { valores }, cancellationToken);
            if (response.StatusCode == HttpStatusCode.UnprocessableEntity)
                return UnprocessableEntity(new { error = "La muestra no contiene las variables requeridas por el modelo. Consulta /api/modelo." });
            if (!response.IsSuccessStatusCode)
                return Problem(statusCode: 503, title: "El modelo ML no está disponible. La muestra no se guardó; puedes reintentar.");
            using var result = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
            if (!result.RootElement.TryGetProperty("es_anomalia", out var anomaly)
                || anomaly.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                return Problem(statusCode: 502, title: "El modelo devolvió una respuesta inválida. La muestra no se guardó.");
            var esAnomalia = anomaly.GetBoolean();
            var idsGuardados = new List<long>();
            if (esAnomalia)
            {
                await using var command = new NpgsqlCommand("""
                    INSERT INTO public.lectura_cuarentena(payload, causa)
                    VALUES (@payload, 'Anomalía detectada por el modelo ML') RETURNING id
                    """, connection, transaction);
                command.Parameters.AddWithValue("payload", NpgsqlDbType.Jsonb,
                    JsonSerializer.Serialize(muestra, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
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
            return StatusCode(201, new { muestra.SensorId, muestra.IdMuestra, estado = esAnomalia ? "cuarentena" : "guardada", esAnomalia, ids = idsGuardados });
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
