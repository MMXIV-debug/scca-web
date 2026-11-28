 using System.ComponentModel.DataAnnotations;
using System.Globalization;
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
    // Dato derivado del BME680; se conserva en la evidencia JSON existente.
    [Range(typeof(decimal), "-1000", "20000", ParseLimitsInInvariantCulture = true)]
    public decimal? AltitudAproximadaM { get; init; }
    [Range(1, int.MaxValue)]
    public int SensorId { get; init; }
    [Range(1, long.MaxValue)]
    public long IdMuestra { get; init; }
    [System.Text.Json.Serialization.JsonConverter(typeof(Scca.Api.Services.FechaConZonaConverter))]
    public required DateTimeOffset MedidoEn { get; init; }
    [Required, MinLength(1), MaxLength(32)]
    public required List<LecturaIot> Lecturas { get; init; }
}

public sealed class LoteMuestrasIot
{
    [Required, MinLength(1), MaxLength(100)]
    public required List<MuestraIot> Muestras { get; init; }
}

// Estado compartido durante un lote: si ML falla una vez, no se insiste en las demás muestras.
internal sealed class EstadoLote
{
    public bool MlCaido { get; set; }
}

[ApiController]
[Route("api/lecturas")]
public sealed class LecturasController(
    NpgsqlDataSource database, IHttpClientFactory clients,
    IConfiguration configuration, ILogger<LecturasController> logger) : ControllerBase
{
    private (IActionResult? Error, string? ExpectedKey) ValidarApiKey(string? apiKey)
    {
        var expected = configuration["Iot:ApiKey"];
        if (string.IsNullOrWhiteSpace(expected))
            return (Problem(statusCode: 503, title: "Falta configurar Iot:ApiKey."), null);
        if (apiKey is null || !CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(Encoding.UTF8.GetBytes(expected)),
            SHA256.HashData(Encoding.UTF8.GetBytes(apiKey))))
            return (Unauthorized(), null);
        return (null, expected);
    }

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
        var (authError, expected) = ValidarApiKey(apiKey);
        if (authError is not null) return authError;
        var (status, body) = await ProcesarMuestraAsync(muestra, expected!, cancellationToken);
        return StatusCode(status, body);
    }

    [HttpPost("lote")]
    [RequestSizeLimit(262144)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<IActionResult> RecibirLote(
        LoteMuestrasIot lote,
        [FromHeader(Name = "X-Api-Key")] string? apiKey,
        CancellationToken cancellationToken)
    {
        var (authError, expected) = ValidarApiKey(apiKey);
        if (authError is not null) return authError;

        int guardadas = 0, cuarentena = 0, duplicadas = 0, rechazadas = 0;
        var resultados = new List<object>(lote.Muestras.Count);
        var estadoLote = new EstadoLote();

        foreach (var muestra in lote.Muestras)
        {
            var (status, body) = await ProcesarMuestraAsync(muestra, expected!, cancellationToken, estadoLote);
            if (status == 201)
            {
                var json = JsonSerializer.SerializeToElement(body);
                var estado = json.TryGetProperty("estado", out var est) ? est.GetString() : "guardada";
                if (estado == "cuarentena") cuarentena++; else guardadas++;
            }
            else if (status == 409) duplicadas++;
            else rechazadas++;

            resultados.Add(new { muestra.SensorId, muestra.IdMuestra, statusCode = status, detalle = body });
        }

        return Ok(new
        {
            total = lote.Muestras.Count,
            guardadas,
            cuarentena,
            duplicadas,
            rechazadas,
            resultados
        });
    }

    private async Task<(int StatusCode, object Body)> ProcesarMuestraAsync(
        MuestraIot muestra, string expected, CancellationToken cancellationToken, EstadoLote? lote = null)
    {
        // --- 1. Rechazo directo por contrato estructural inválido (no identificable) ---
        if (muestra.MedidoEn == default)
            return (400, new { error = "medidoEn es obligatorio y debe incluir zona horaria." });
        if (muestra.Lecturas.Any(l => l is null || decimal.Round(l.Valor, 4) != l.Valor)
            || muestra.Lecturas.Select(l => l.VariableCodigo).Distinct(StringComparer.Ordinal).Count() != muestra.Lecturas.Count)
            return (400, new { error = "Las variables no deben repetirse y los valores admiten hasta cuatro decimales." });

        try
        {
            await using var connection = await database.OpenConnectionAsync(cancellationToken);
            await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

            // Serializar por sensor para evitar duplicados en reenvíos concurrentes.
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
                    return (400, new { error = "El sensor no existe o está inactivo." });
                modelo = reader.GetString(0).Trim().ToUpperInvariant();
                origen = reader.GetString(1);
                nodoId = reader.GetInt32(2);
            }

            var perfil = origen == "simulado" ? "contaminantes_simulados"
                : modelo == "DHT11" ? "dht11" : modelo == "BME680" ? "bme680" : null;
            if (perfil is null)
                return (422, new { error = "Hardware sin perfil de ingesta definido." });
            if (muestra.AltitudAproximadaM is not null && perfil != "bme680")
                return (422, new { error = "La altitud aproximada solo corresponde al perfil BME680." });

            var unidades = perfil switch
            {
                "dht11" => new Dictionary<string, string> { ["TEMP"] = "°C", ["HUM"] = "%" },
                "bme680" => new Dictionary<string, string> { ["TEMP"] = "°C", ["HUM"] = "%", ["PRES"] = "hPa", ["GAS"] = "ohm" },
                _ => new Dictionary<string, string> { ["CO"] = "µg/m3", ["PM1"] = "µg/m3", ["PM10"] = "µg/m3", ["PM25"] = "µg/m3" }
            };

            // --- 2. Rechazo directo por duplicado (idempotencia en originales y cuarentena) ---
            await using (var command = new NpgsqlCommand("""
                SELECT EXISTS(SELECT 1 FROM public.lectura_original WHERE sensor_id=@sensor AND id_muestra=@muestra)
                    OR EXISTS(SELECT 1 FROM public.lectura_cuarentena
                        WHERE payload->>'sensorId'=@sensorTexto AND payload->>'idMuestra'=@muestraTexto)
                """, connection, transaction))
            {
                command.Parameters.AddWithValue("sensor", muestra.SensorId);
                command.Parameters.AddWithValue("muestra", muestra.IdMuestra);
                command.Parameters.AddWithValue("sensorTexto", muestra.SensorId.ToString(CultureInfo.InvariantCulture));
                command.Parameters.AddWithValue("muestraTexto", muestra.IdMuestra.ToString(CultureInfo.InvariantCulture));
                if (await command.ExecuteScalarAsync(cancellationToken) is true)
                    return (409, new { error = "Esta muestra del sensor ya fue recibida." });
            }

            // --- 3. Rechazo directo por incompatibilidad de catálogo / unidades ---
            var ids = new Dictionary<string, short>(StringComparer.Ordinal);
            await using (var catalogo = new NpgsqlCommand("SELECT count(*) FROM public.sensor_variable WHERE sensor_id=@sensor", connection, transaction))
            {
                catalogo.Parameters.AddWithValue("sensor", muestra.SensorId);
                if ((long)(await catalogo.ExecuteScalarAsync(cancellationToken))! != unidades.Count)
                    return (422, new { error = "El catálogo del sensor no coincide con su perfil." });
            }
            foreach (var lectura in muestra.Lecturas)
            {
                if (!unidades.ContainsKey(lectura.VariableCodigo))
                    return (422, new { error = $"Variable ajena al perfil {perfil}: {lectura.VariableCodigo}.", perfil });

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
                    return (422, new { error = $"Variable o unidad incompatible para el sensor: {lectura.VariableCodigo}." });
                var simbolo = reader.GetString(1).Replace("μ", "µ").Replace("³", "3").Replace("Ω", "ohm").Trim();
                if (simbolo != unidades[lectura.VariableCodigo])
                    return (422, new { error = "El catálogo usa unidades incompatibles con el perfil." });
                ids.Add(lectura.VariableCodigo, reader.GetInt16(0));
            }

            // --- 4. Clasificación de lecturas inválidas que se conservan en CUARENTENA para revisión ---
            var motivosInvalidos = new List<string>();
            if (muestra.MedidoEn > DateTimeOffset.UtcNow.AddMinutes(5))
                motivosInvalidos.Add("fecha medidoEn en el futuro");

            var faltantes = unidades.Keys.Except(muestra.Lecturas.Select(l => l.VariableCodigo), StringComparer.Ordinal).ToArray();
            if (faltantes.Length > 0)
                motivosInvalidos.Add($"muestra incompleta para el perfil {perfil} (faltan: {string.Join(", ", faltantes)})");

            // Rangos configurados en politica_variable de la política vigente (si existen).
            var rangosPolitica = new Dictionary<string, (decimal Min, decimal Max)>(StringComparer.Ordinal);
            await using (var cmdRangos = new NpgsqlCommand("""
                SELECT v.codigo, pv.rango_min, pv.rango_max
                FROM public.politica_variable pv
                JOIN public.variable v ON v.id = pv.variable_id
                WHERE pv.politica_id = (
                    SELECT p.id FROM public.politica_ml p
                    WHERE p.vigente_hasta IS NULL
                    ORDER BY p.version DESC LIMIT 1
                )
                """, connection, transaction))
            {
                await using var reader = await cmdRangos.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                    rangosPolitica[reader.GetString(0)] = (reader.GetDecimal(1), reader.GetDecimal(2));
            }

            foreach (var l in muestra.Lecturas)
            {
                var fueraFisico = l.VariableCodigo switch
                {
                    "TEMP" => perfil == "dht11" ? (l.Valor < 0 || l.Valor > 50) : (l.Valor < -40 || l.Valor > 85),
                    "HUM" => l.Valor < 0 || l.Valor > 100,
                    "PRES" => l.Valor < 300 || l.Valor > 1100,
                    "GAS" => l.Valor <= 0,
                    _ => l.Valor < 0
                };
                if (fueraFisico)
                    motivosInvalidos.Add($"{l.VariableCodigo}={l.Valor.ToString(CultureInfo.InvariantCulture)} fuera de rango físico del perfil {perfil}");
                else if (rangosPolitica.TryGetValue(l.VariableCodigo, out var rango) && (l.Valor < rango.Min || l.Valor > rango.Max))
                    motivosInvalidos.Add($"{l.VariableCodigo}={l.Valor.ToString(CultureInfo.InvariantCulture)} fuera de rango de política [{rango.Min.ToString(CultureInfo.InvariantCulture)}, {rango.Max.ToString(CultureInfo.InvariantCulture)}]");
            }

            bool? esAnomalia = null;
            string estadoMl;
            string? modeloVersion = null;
            bool aCuarentenaPorDatoInvalido = motivosInvalidos.Count > 0;
            string causaCuarentena = aCuarentenaPorDatoInvalido
                ? "Lectura inválida: " + string.Join("; ", motivosInvalidos)
                : "Anomalía detectada por el modelo ML";

            if (aCuarentenaPorDatoInvalido)
            {
                estadoMl = "dato_invalido";
            }
            else
            {
                estadoMl = "sin_modelo";
                // Consultar por perfil; Python solo utiliza el detector legado como
                // respaldo de contaminantes simulados, nunca para hardware distinto.
                if (lote?.MlCaido == true)
                    estadoMl = "ml_no_disponible";
                else try
                {
                    var valores = muestra.Lecturas.ToDictionary(l => l.VariableCodigo, l => l.Valor);
                    using var limiteMl = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                    limiteMl.CancelAfter(TimeSpan.FromSeconds(3));
                    using var requestMl = new HttpRequestMessage(HttpMethod.Post, "api/v2/modelos/muestra")
                    { Content = JsonContent.Create(new { nodo_id = nodoId, sensor_id = muestra.SensorId, perfil, valores,
                        altitud_aproximada_m = muestra.AltitudAproximadaM }) };
                    requestMl.Headers.Add("X-Api-Key", expected);
                    using var response = await clients.CreateClient("ModeloMl").SendAsync(requestMl, limiteMl.Token);
                    estadoMl = response.IsSuccessStatusCode ? "respuesta_invalida" : "ml_no_disponible";
                    if (response.IsSuccessStatusCode)
                    {
                        using var result = JsonDocument.Parse(await response.Content.ReadAsStringAsync(limiteMl.Token));
                        bool identidadCorrecta = result.RootElement.TryGetProperty("sensor_id", out var sensorMl) && sensorMl.TryGetInt32(out var sensorRespuesta) && sensorRespuesta == muestra.SensorId
                            && result.RootElement.TryGetProperty("nodo_id", out var nodoMl) && nodoMl.TryGetInt32(out var nodoRespuesta) && nodoRespuesta == nodoId
                            && result.RootElement.TryGetProperty("perfil", out var perfilResultado) && perfilResultado.GetString() == perfil;
                        if (identidadCorrecta && result.RootElement.TryGetProperty("estado", out var estadoSinModelo) && estadoSinModelo.GetString() == "sin_modelo"
                            && result.RootElement.TryGetProperty("es_anomalia", out var noAnomalia) && noAnomalia.ValueKind == JsonValueKind.Null
                            && result.RootElement.TryGetProperty("modelo_version", out var noVersion) && noVersion.ValueKind == JsonValueKind.Null)
                            estadoMl = "sin_modelo";
                        if (identidadCorrecta && result.RootElement.TryGetProperty("es_anomalia", out var anomaly)
                            && anomaly.ValueKind is JsonValueKind.True or JsonValueKind.False
                            && result.RootElement.TryGetProperty("modelo_version", out var version)
                            && version.ValueKind == JsonValueKind.String
                            && System.Text.RegularExpressions.Regex.IsMatch(version.GetString()!, "^(?:[a-f0-9]{32}|[a-f0-9]{64})$")
                            && result.RootElement.TryGetProperty("estado", out var estadoModelo) && estadoModelo.GetString() is "evaluado_legacy" or "evaluado_demo"
                            && (estadoModelo.GetString() == "evaluado_demo" ? version.GetString()!.Length == 32 : version.GetString()!.Length == 64)
                            && result.RootElement.TryGetProperty("perfil", out var perfilMl) && perfilMl.GetString() == perfil)
                        {
                            esAnomalia = anomaly.GetBoolean();
                            modeloVersion = version.GetString();
                            estadoMl = estadoModelo.GetString()!;
                        }
                    }
                }
                catch (Exception ex) when (ex is HttpRequestException or JsonException or InvalidOperationException
                    || ex is OperationCanceledException && !cancellationToken.IsCancellationRequested)
                {
                    estadoMl = ex is JsonException or InvalidOperationException ? "respuesta_invalida" : "ml_no_disponible";
                }
                if (lote is not null && estadoMl == "ml_no_disponible")
                    lote.MlCaido = true;
            }

            var evaluacionMl = new
            {
                perfil,
                origen,
                nodoId,
                estado = estadoMl,
                esAnomalia,
                modeloVersion,
                validacionIndependiente = false,
                unidades,
                altitudAproximadaM = muestra.AltitudAproximadaM,
                procedenciaAltitud = muestra.AltitudAproximadaM is null ? null : "estimada a partir de presión; no es una medición independiente",
                motivosInvalidos = aCuarentenaPorDatoInvalido ? motivosInvalidos : null,
                interpretacion = aCuarentenaPorDatoInvalido
                    ? "Muestra retenida en cuarentena por validación de datos inválidos; pendiente de revisión administrativa."
                    : "Una anomalía indica una lectura inusual; no confirma un fallo de sensor.",
                procedenciaVariables = perfil == "contaminantes_simulados"
                    ? new Dictionary<string, string> { ["PM25"] = "Open-Meteo/CAMS", ["PM10"] = "Open-Meteo/CAMS", ["CO"] = "Open-Meteo/CAMS", ["PM1"] = "estimado: 0.70 × PM25" }
                    : null
            };

            await using (var command = new NpgsqlCommand("""
                INSERT INTO public.evaluacion_muestra(sensor_id,id_muestra,nodo_id,perfil,origen,medido_en,estado,es_anomalia,modelo_version,evidencia)
                VALUES(@sensor,@muestra,@nodo,@perfil,@origen,@fecha,@estado,@anomalia,@version,@evidencia)
                """, connection, transaction))
            {
                command.Parameters.AddWithValue("sensor", muestra.SensorId);
                command.Parameters.AddWithValue("muestra", muestra.IdMuestra);
                command.Parameters.AddWithValue("nodo", nodoId);
                command.Parameters.AddWithValue("perfil", perfil);
                command.Parameters.AddWithValue("origen", origen);
                command.Parameters.AddWithValue("fecha", muestra.MedidoEn.UtcDateTime);
                command.Parameters.AddWithValue("estado", estadoMl);
                command.Parameters.AddWithValue("anomalia", NpgsqlDbType.Boolean, (object?)esAnomalia ?? DBNull.Value);
                command.Parameters.AddWithValue("version", NpgsqlDbType.Text, (object?)modeloVersion ?? DBNull.Value);
                command.Parameters.AddWithValue("evidencia", NpgsqlDbType.Jsonb, JsonSerializer.Serialize(evaluacionMl));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            var irACuarentena = aCuarentenaPorDatoInvalido || esAnomalia == true;
            var idsGuardados = new List<long>();
            if (irACuarentena)
            {
                await using var command = new NpgsqlCommand("""
                    INSERT INTO public.lectura_cuarentena(payload, causa)
                    VALUES (@payload, @causa) RETURNING id
                    """, connection, transaction);
                command.Parameters.AddWithValue("payload", NpgsqlDbType.Jsonb,
                    JsonSerializer.Serialize(new
                    {
                        muestra.SensorId,
                        idMuestra = muestra.IdMuestra.ToString(CultureInfo.InvariantCulture),
                        muestra.MedidoEn,
                        muestra.AltitudAproximadaM,
                        muestra.Lecturas,
                        evaluacionMl
                    }, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
                command.Parameters.AddWithValue("causa", causaCuarentena);
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

            // Actualizar última recepción del nodo.
            await using (var updNodo = new NpgsqlCommand("UPDATE public.nodo SET ultima_recepcion = now() WHERE id = @nodo", connection, transaction))
            {
                updNodo.Parameters.AddWithValue("nodo", nodoId);
                await updNodo.ExecuteNonQueryAsync(cancellationToken);
            }

            // NOTIFY se entrega únicamente después de confirmar el guardado.
            await using (var aviso = new NpgsqlCommand("SELECT pg_notify('scca_lecturas', @evento)", connection, transaction))
            {
                aviso.Parameters.AddWithValue("evento", JsonSerializer.Serialize(new
                {
                    sensor_id = muestra.SensorId,
                    id_muestra = muestra.IdMuestra.ToString(CultureInfo.InvariantCulture),
                    estado = irACuarentena ? "cuarentena" : "guardada"
                }));
                await aviso.ExecuteNonQueryAsync(cancellationToken);
            }

            await transaction.CommitAsync(cancellationToken);
            return (201, new
            {
                muestra.SensorId,
                muestra.IdMuestra,
                estado = irACuarentena ? "cuarentena" : "guardada",
                causa = irACuarentena ? causaCuarentena : null,
                esAnomalia,
                evaluacionMl,
                ids = idsGuardados
            });
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return (409, new { error = "Esta muestra ya fue recibida." });
        }
        catch (Exception ex) when (ex is HttpRequestException or NpgsqlException or JsonException
            || ex is OperationCanceledException && !cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning("No se pudo procesar la muestra: {Tipo}", ex.GetType().Name);
            return (503, new { error = "No se pudo completar el procesamiento. Reintenta con el mismo idMuestra." });
        }
    }
}
