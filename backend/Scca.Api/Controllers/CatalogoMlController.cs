using Microsoft.AspNetCore.Mvc;
using Npgsql;
using NpgsqlTypes;
using Scca.Api.Services;
using System.ComponentModel.DataAnnotations;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Scca.Api.Controllers;

public sealed record NuevaPoliticaMl(
    [property: JsonPropertyName("version_anterior")] int VersionAnterior,
    [Required] string Motivo,
    [property: JsonPropertyName("completitud_min_pct")] decimal CompletitudMinPct,
    [property: JsonPropertyName("colocacion_dias")] int ColocacionDias,
    [property: JsonPropertyName("pares_minimos")] int ParesMinimos,
    [property: JsonPropertyName("test_pct")] decimal TestPct,
    [property: JsonPropertyName("mejora_rmse_min_pct")] decimal MejoraRmseMinPct,
    [property: JsonPropertyName("sin_datos_seg")] int SinDatosSeg,
    JsonElement Configuracion,
    [property: JsonPropertyName("referencia_fuente_id")] int? ReferenciaFuenteId = null,
    [property: JsonPropertyName("rangos_variables")] JsonElement? RangosVariables = null);

public sealed record NuevoModeloMl(
    [Range(1,int.MaxValue)] int SensorId,
    [Range(1,short.MaxValue)] short VariableId,
    [Range(1,int.MaxValue)] int PoliticaId,
    [Range(1,int.MaxValue)] int Version,
    [Required, RegularExpression("regresion_lineal|random_forest")] string Algoritmo,
    JsonElement Parametros,
    [StringLength(1024)] string? ArtefactoRuta,
    [RegularExpression("[a-fA-F0-9]{64}")] string? HashArtefacto,
    decimal? DominioMin, decimal? DominioMax);

public sealed record CambioEstadoMl([Required, StringLength(1000, MinimumLength=3)] string Motivo);

public sealed record NuevaValidacionMl(
    [Range(1,int.MaxValue)] int ModeloId,
    [Range(1,int.MaxValue)] int PoliticaId,
    [Range(1,int.MaxValue)] int Pares,
    [Required, RegularExpression("apto|rechazado|pendiente")] string Estado,
    decimal? MaeOrig, decimal? RmseOrig, decimal? SesgoOrig,
    decimal? MaeMl, decimal? RmseMl, decimal? SesgoMl, decimal? R2, decimal? MejoraRmsePct,
    [RegularExpression("[a-fA-F0-9]{64}")] string? HashConjunto);


[ApiController]
[Route("api/ml")]
public sealed class CatalogoMlController(NpgsqlDataSource database, IHttpClientFactory clients) : ControllerBase
{

    [HttpGet("politicas"), AccesoMl(AccesoMl.Administrador)]
    public Task<IActionResult> Politicas(CancellationToken ct, int limite = 50, int despuesDe = 0)
        => Consultar("politica_ml", null, limite, despuesDe, ct);

    [HttpGet("politicas/{id:int}"), AccesoMl(AccesoMl.Administrador)]
    public Task<IActionResult> Politica(int id, CancellationToken ct) => Consultar("politica_ml", id, 1, 0, ct);

    [HttpPost("politicas"), AccesoMl(AccesoMl.Administrador)]
    public Task<IActionResult> CrearPolitica(NuevaPoliticaMl politica, CancellationToken ct)
        => GuardarPolitica(null, politica, ct);

    [HttpPut("politicas/{id:int}"), AccesoMl(AccesoMl.Administrador)]
    public Task<IActionResult> ActualizarPolitica(int id, NuevaPoliticaMl politica, CancellationToken ct)
        => GuardarPolitica(id, politica, ct);

    private async Task<IActionResult> GuardarPolitica(int? id, NuevaPoliticaMl politica, CancellationToken ct)
    {
        if (politica.Configuracion.ValueKind != JsonValueKind.Object) return BadRequest();
        // El panel y Swagger comparten el mismo validador y la misma transacción de versionado.
        using var request = new HttpRequestMessage(id.HasValue ? HttpMethod.Put : HttpMethod.Post,
            id.HasValue ? $"api/admin/ml/politicas/{id}" : "api/admin/ml/politicas");
        request.Headers.Authorization = AuthenticationHeaderValue.Parse(Request.Headers.Authorization.ToString());
        request.Content = JsonContent.Create(politica);
        try
        {
            using var client = clients.CreateClient("Panel");
            using var response = await client.SendAsync(request, ct);
            var body = await response.Content.ReadFromJsonAsync<JsonElement>(ct);
            if (!response.IsSuccessStatusCode) return StatusCode((int)response.StatusCode, body);
            // Incluso PUT crea una nueva versión inmutable en lugar de sobrescribir la existente.
            return CreatedAtAction(nameof(Politica), new { id = body.GetProperty("id").GetInt32() }, body);
        }
        catch (Exception e) when (e is HttpRequestException or JsonException or NotSupportedException ||
            e is OperationCanceledException && !ct.IsCancellationRequested)
        { return Problem(statusCode: 503, title: "El panel no pudo confirmar la nueva versión de la política."); }
    }

    [HttpGet("modelos"), AccesoMl(AccesoMl.Administrador)]
    public Task<IActionResult> Modelos(CancellationToken ct, int limite = 50, int despuesDe = 0)
        => Consultar("modelo_ml", null, limite, despuesDe, ct);

    [HttpGet("modelos/{id:int}"), AccesoMl(AccesoMl.Administrador)]
    public Task<IActionResult> Modelo(int id, CancellationToken ct) => Consultar("modelo_ml", id, 1, 0, ct);

    [HttpPost("modelos"), AccesoMl(AccesoMl.ServicioML)]
    public Task<IActionResult> RegistrarModelo(NuevoModeloMl modelo, CancellationToken ct)
        => GuardarModelo(null, modelo, ct);

    [HttpPut("modelos/{id:int}"), AccesoMl(AccesoMl.Administrador)]
    public Task<IActionResult> ActualizarModelo(int id, NuevoModeloMl modelo, CancellationToken ct)
        => GuardarModelo(id, modelo, ct);

    private Task<IActionResult> GuardarModelo(int? id, NuevoModeloMl modelo, CancellationToken ct)
        => Escribir(async (con,tx) =>
        {
            if (modelo.Parametros.ValueKind != JsonValueKind.Object || modelo.DominioMin > modelo.DominioMax)
                return BadRequest(new { error = "Revisa los parámetros y el rango del modelo." });
            var antes = id.HasValue ? await LeerParaCambio(con, tx, "modelo_ml", id.Value, ct) : null;
            if (id.HasValue && antes is null) return NotFound();
            await using var politica = new NpgsqlCommand(
                "SELECT id FROM politica_ml WHERE id=@id AND eliminada_en IS NULL FOR SHARE", con, tx);
            politica.Parameters.AddWithValue("id", modelo.PoliticaId);
            if (await politica.ExecuteScalarAsync(ct) is null) return BadRequest(new { error = "Política inexistente." });
            if (id.HasValue)
            {
                await using var referencias = new NpgsqlCommand(
                    "SELECT EXISTS(SELECT FROM validacion_ml WHERE modelo_id=@id AND politica_id<>@politica)", con, tx);
                referencias.Parameters.AddWithValue("id", id.Value);
                referencias.Parameters.AddWithValue("politica", modelo.PoliticaId);
                if ((bool)(await referencias.ExecuteScalarAsync(ct))!)
                    return Conflict(new { error = "El modelo ya tiene evaluaciones con otra política." });
            }
            await using var cmd = new NpgsqlCommand(id.HasValue ? """
                UPDATE modelo_ml AS m SET sensor_id=@sensor, variable_id=@variable, politica_id=@politica,
                    version=@version, algoritmo=@algoritmo, parametros=CAST(@parametros AS jsonb),
                    artefacto_ruta=@ruta, hash_artefacto=@hash, dominio_min=@min, dominio_max=@max
                WHERE id=@id RETURNING to_jsonb(m)::text
                """ : """
                INSERT INTO modelo_ml AS m(sensor_id,variable_id,politica_id,version,algoritmo,parametros,
                    artefacto_ruta,hash_artefacto,dominio_min,dominio_max)
                VALUES(@sensor,@variable,@politica,@version,@algoritmo,CAST(@parametros AS jsonb),@ruta,@hash,@min,@max)
                RETURNING to_jsonb(m)::text
                """, con, tx);
            if (id.HasValue) cmd.Parameters.AddWithValue("id", id.Value);
            cmd.Parameters.AddWithValue("sensor",modelo.SensorId);
            cmd.Parameters.AddWithValue("variable",modelo.VariableId);
            cmd.Parameters.AddWithValue("politica",modelo.PoliticaId);
            cmd.Parameters.AddWithValue("version",modelo.Version);
            cmd.Parameters.AddWithValue("algoritmo",modelo.Algoritmo);
            cmd.Parameters.AddWithValue("parametros",modelo.Parametros.GetRawText());
            cmd.Parameters.AddWithValue("ruta",NpgsqlTypes.NpgsqlDbType.Text,(object?)modelo.ArtefactoRuta ?? DBNull.Value);
            cmd.Parameters.AddWithValue("hash",NpgsqlTypes.NpgsqlDbType.Text,(object?)modelo.HashArtefacto ?? DBNull.Value);
            cmd.Parameters.AddWithValue("min",NpgsqlTypes.NpgsqlDbType.Numeric,(object?)modelo.DominioMin ?? DBNull.Value);
            cmd.Parameters.AddWithValue("max",NpgsqlTypes.NpgsqlDbType.Numeric,(object?)modelo.DominioMax ?? DBNull.Value);
            var row = JsonSerializer.Deserialize<JsonElement>((string)(await cmd.ExecuteScalarAsync(ct))!);
            int registroId = row.GetProperty("id").GetInt32();
            await Auditar(con, tx, "modelo_ml", registroId, id.HasValue ? "actualizar" : "registrar",
                id.HasValue ? "Edición del administrador" : "Registro del servicio ML", antes, row.GetRawText(), ct);
            if (id.HasValue) return Ok(row);
            return CreatedAtAction(nameof(Modelo), new { id = registroId }, row);
        },ct);

    [HttpPost("modelos/{id:int}/suspender"), AccesoMl(AccesoMl.Administrador)]
    public Task<IActionResult> Suspender(int id, CambioEstadoMl cambio, CancellationToken ct)
        => CambiarEstado(id,cambio,false,ct);

    [HttpPost("modelos/{id:int}/revertir"), AccesoMl(AccesoMl.Administrador)]
    public Task<IActionResult> Revertir(int id, CambioEstadoMl cambio, CancellationToken ct)
        => CambiarEstado(id,cambio,true,ct);

    private Task<IActionResult> CambiarEstado(int id, CambioEstadoMl cambio, bool revertir, CancellationToken ct)
        => Escribir(async (con,tx) =>
        {
            if (id <= 0 || string.IsNullOrWhiteSpace(cambio.Motivo)) return BadRequest();
            // El bloqueo del sensor serializa la selección y el cambio de ambas versiones.
            await using var sensor = new NpgsqlCommand("""
                SELECT s.activo FROM sensor s JOIN modelo_ml m ON m.sensor_id=s.id
                WHERE m.id=@id FOR UPDATE OF s
                """,con,tx);
            sensor.Parameters.AddWithValue("id",id);
            var activo = await sensor.ExecuteScalarAsync(ct);
            if (activo is null) return NotFound();
            if (revertir && activo is false) return Conflict(new { error = "Sensor inactivo." });
            await using var actual = new NpgsqlCommand("""
                SELECT to_jsonb(m)::text FROM modelo_ml m WHERE id=@id FOR UPDATE
                """,con,tx);
            actual.Parameters.AddWithValue("id",id);
            var row = JsonSerializer.Deserialize<JsonElement>((string)(await actual.ExecuteScalarAsync(ct))!);
            if (row.GetProperty("estado").GetString() != "activo")
                return Conflict(new { error = "La acción requiere la versión actualmente activa." });

            JsonElement? anterior = null;
            if (revertir)
            {
                await using var buscar = new NpgsqlCommand("""
                    SELECT to_jsonb(m)::text FROM modelo_ml m WHERE sensor_id=@sensor AND variable_id=@variable
                      AND version < @version AND estado='suspendido' AND activado_en IS NOT NULL
                      AND (SELECT v.estado FROM validacion_ml v WHERE v.modelo_id=m.id AND v.politica_id=m.politica_id
                           ORDER BY v.evaluado_en DESC,v.id DESC LIMIT 1)='apto'
                    ORDER BY activado_en DESC,version DESC LIMIT 1 FOR UPDATE OF m
                    """,con,tx);
                buscar.Parameters.AddWithValue("sensor",row.GetProperty("sensor_id").GetInt32());
                buscar.Parameters.AddWithValue("variable",row.GetProperty("variable_id").GetInt16());
                buscar.Parameters.AddWithValue("version",row.GetProperty("version").GetInt32());
                if (await buscar.ExecuteScalarAsync(ct) is not string json)
                    return Conflict(new { error = "No hay una versión anterior activada con validación apta." });
                anterior = JsonSerializer.Deserialize<JsonElement>(json);
            }
            async Task<JsonElement> Guardar(JsonElement original,string estado)
            {
                int modeloId = original.GetProperty("id").GetInt32();
                await using var update = new NpgsqlCommand("""
                    UPDATE modelo_ml m SET estado=@estado,
                        activado_en=CASE WHEN @estado='activo' THEN now() ELSE activado_en END
                    WHERE id=@id RETURNING to_jsonb(m)::text
                    """,con,tx);
                update.Parameters.AddWithValue("id",modeloId);
                update.Parameters.AddWithValue("estado",estado);
                var nuevo = (string)(await update.ExecuteScalarAsync(ct))!;
                await Auditar(con,tx,"modelo_ml",modeloId,revertir?"revertir":"suspender",cambio.Motivo,
                    original.GetRawText(),nuevo,ct);
                return JsonSerializer.Deserialize<JsonElement>(nuevo);
            }
            var suspendido = await Guardar(row,"suspendido");
            if (anterior.HasValue) return Ok(await Guardar(anterior.Value,"activo"));
            return Ok(suspendido);
        },ct);

    [HttpGet("validaciones"), AccesoMl(AccesoMl.Administrador)]
    public Task<IActionResult> Validaciones(CancellationToken ct, int limite = 50, int despuesDe = 0)
        => Consultar("validacion_ml", null, limite, despuesDe, ct);

    [HttpGet("validaciones/{id:int}"), AccesoMl(AccesoMl.Administrador)]
    public Task<IActionResult> Validacion(int id, CancellationToken ct) => Consultar("validacion_ml", id, 1, 0, ct);

    [HttpPost("validaciones"), AccesoMl(AccesoMl.ServicioML)]
    public Task<IActionResult> RegistrarValidacion(NuevaValidacionMl v, CancellationToken ct)
        => GuardarValidacion(null, v, ct);

    [HttpPut("validaciones/{id:int}"), AccesoMl(AccesoMl.Administrador)]
    public Task<IActionResult> ActualizarValidacion(int id, NuevaValidacionMl v, CancellationToken ct)
        => GuardarValidacion(id, v, ct);

    private Task<IActionResult> GuardarValidacion(int? id, NuevaValidacionMl v, CancellationToken ct)
        => Escribir(async (con,tx) =>
        {
            decimal?[] metricas = [v.MaeOrig,v.MaeMl,v.RmseOrig,v.RmseMl,v.SesgoOrig,v.SesgoMl,v.R2];
            if (metricas.Any(m => m is >= 1000000 or <= -1000000 ||
                m.HasValue && decimal.Round(m.Value, 6) != m.Value) ||
                v.MaeOrig < 0 || v.MaeMl < 0 || v.RmseOrig < 0 || v.RmseMl < 0 || v.R2 > 1)
                return BadRequest(new { error = "Métricas fuera de rango." });
            await using var modelo = new NpgsqlCommand("""
                SELECT p.mejora_rmse_min_pct,p.pares_minimos FROM modelo_ml m JOIN politica_ml p ON p.id=m.politica_id
                WHERE m.id=@modelo AND p.id=@politica FOR UPDATE OF m
                """,con,tx);
            modelo.Parameters.AddWithValue("modelo",v.ModeloId);
            modelo.Parameters.AddWithValue("politica",v.PoliticaId);
            decimal minimo;
            int paresMinimos;
            await using (var reader = await modelo.ExecuteReaderAsync(ct))
            {
                if (!await reader.ReadAsync(ct))
                    return BadRequest(new { error = "La política debe corresponder al modelo evaluado." });
                minimo = reader.GetDecimal(0);
                paresMinimos = reader.GetInt32(1);
            }
            if (v.Estado == "apto" && (v.Pares < paresMinimos || v.RmseOrig is null or <= 0 || v.RmseMl is null ||
                v.MaeMl is null || v.MaeOrig is null || v.MaeMl > v.MaeOrig ||
                v.SesgoMl is null || v.SesgoOrig is null || Math.Abs(v.SesgoMl.Value)>Math.Abs(v.SesgoOrig.Value) ||
                v.MejoraRmsePct is null || v.MejoraRmsePct < minimo ||
                decimal.Round(100m*(v.RmseOrig.Value-v.RmseMl.Value)/v.RmseOrig.Value,2) != v.MejoraRmsePct))
                return BadRequest(new { error = "Las métricas no justifican una evaluación apta según la política." });
            var antes = id.HasValue ? await LeerParaCambio(con, tx, "validacion_ml", id.Value, ct) : null;
            if (id.HasValue && antes is null) return NotFound();
            await using var cmd = new NpgsqlCommand(id.HasValue ? """
                UPDATE validacion_ml AS v SET modelo_id=@modelo, politica_id=@politica, pares=@pares, estado=@estado,
                    mae_orig=@mae0, rmse_orig=@rmse0, sesgo_orig=@sesgo0, mae_ml=@mae, rmse_ml=@rmse,
                    sesgo_ml=@sesgo, r2=@r2, mejora_rmse_pct=@mejora, hash_conjunto=@hash
                WHERE id=@id RETURNING to_jsonb(v)::text
                """ : """
                INSERT INTO validacion_ml AS v(modelo_id,politica_id,pares,estado,mae_orig,rmse_orig,sesgo_orig,
                    mae_ml,rmse_ml,sesgo_ml,r2,mejora_rmse_pct,hash_conjunto)
                VALUES(@modelo,@politica,@pares,@estado,@mae0,@rmse0,@sesgo0,@mae,@rmse,@sesgo,@r2,@mejora,@hash)
                RETURNING to_jsonb(v)::text
                """,con,tx);
            if (id.HasValue) cmd.Parameters.AddWithValue("id", id.Value);
            cmd.Parameters.AddWithValue("modelo",v.ModeloId);
            cmd.Parameters.AddWithValue("politica",v.PoliticaId);
            cmd.Parameters.AddWithValue("pares",v.Pares);
            cmd.Parameters.AddWithValue("estado",v.Estado);
            void Metrica(string nombre,decimal? valor) =>
                cmd.Parameters.AddWithValue(nombre,NpgsqlDbType.Numeric,(object?)valor ?? DBNull.Value);
            Metrica("mae0",v.MaeOrig);
            Metrica("rmse0",v.RmseOrig);
            Metrica("sesgo0",v.SesgoOrig);
            Metrica("mae",v.MaeMl);
            Metrica("rmse",v.RmseMl);
            Metrica("sesgo",v.SesgoMl);
            Metrica("r2",v.R2);
            Metrica("mejora",v.MejoraRmsePct);
            cmd.Parameters.AddWithValue("hash",NpgsqlDbType.Text,(object?)v.HashConjunto ?? DBNull.Value);
            var row = JsonSerializer.Deserialize<JsonElement>((string)(await cmd.ExecuteScalarAsync(ct))!);
            int registroId = row.GetProperty("id").GetInt32();
            await Auditar(con, tx, "validacion_ml", registroId, id.HasValue ? "actualizar" : "registrar",
                id.HasValue ? "Edición del administrador" : "Registro del servicio ML", antes, row.GetRawText(), ct);
            if (id.HasValue) return Ok(row);
            return CreatedAtAction(nameof(Validacion), new { id = registroId }, row);
        },ct);

    [HttpDelete("politicas/{id:int}"), AccesoMl(AccesoMl.Administrador)]
    public Task<IActionResult> EliminarPolitica(int id, CancellationToken ct) => Eliminar("politica_ml", id, ct);

    [HttpDelete("modelos/{id:int}"), AccesoMl(AccesoMl.Administrador)]
    public Task<IActionResult> EliminarModelo(int id, CancellationToken ct) => Eliminar("modelo_ml", id, ct);

    [HttpDelete("validaciones/{id:int}"), AccesoMl(AccesoMl.Administrador)]
    public Task<IActionResult> EliminarValidacion(int id, CancellationToken ct) => Eliminar("validacion_ml", id, ct);

    private static async Task<string?> LeerParaCambio(NpgsqlConnection con, NpgsqlTransaction tx,
        string tabla, int id, CancellationToken ct)
    {
        var filtro = tabla == "politica_ml" ? "AND eliminada_en IS NULL" : "";
        await using var cmd = new NpgsqlCommand(
            $"SELECT to_jsonb(t)::text FROM {tabla} t WHERE id=@id {filtro} FOR UPDATE", con, tx);
        cmd.Parameters.AddWithValue("id", id);
        return await cmd.ExecuteScalarAsync(ct) as string;
    }

    private Task<IActionResult> Eliminar(string tabla, int id, CancellationToken ct)
        => Escribir(async (con, tx) =>
        {
            if (tabla == "politica_ml")
            {
                await using var bloqueo = new NpgsqlCommand("SELECT pg_advisory_xact_lock(192840,1)", con, tx);
                await bloqueo.ExecuteNonQueryAsync(ct);
            }
            var antes = await LeerParaCambio(con, tx, tabla, id, ct);
            if (antes is null) return NotFound();
            var fila = JsonSerializer.Deserialize<JsonElement>(antes);
            if (tabla == "politica_ml")
            {
                await using var modelos = new NpgsqlCommand("SELECT EXISTS(SELECT FROM modelo_ml WHERE politica_id=@id)", con, tx);
                modelos.Parameters.AddWithValue("id", id);
                if ((bool)(await modelos.ExecuteScalarAsync(ct))!)
                    return Conflict(new { error = "Hay modelos asociados a esta política." });
                if (fila.GetProperty("vigente_hasta").ValueKind == JsonValueKind.Null)
                {
                    await using var previa = new NpgsqlCommand("""
                        UPDATE politica_ml SET vigente_hasta=NULL WHERE id=(
                            SELECT id FROM politica_ml WHERE id<>@id AND eliminada_en IS NULL
                            ORDER BY version DESC LIMIT 1)
                        """, con, tx);
                    previa.Parameters.AddWithValue("id", id);
                    if (await previa.ExecuteNonQueryAsync(ct) == 0)
                        return Conflict(new { error = "Debe quedar una política vigente." });
                }
            }
            var sql = tabla == "politica_ml"
                ? "UPDATE politica_ml SET eliminada_en=now(), vigente_hasta=COALESCE(vigente_hasta,now()) WHERE id=@id"
                : $"DELETE FROM {tabla} WHERE id=@id";
            await using var cmd = new NpgsqlCommand(sql, con, tx);
            cmd.Parameters.AddWithValue("id", id);
            try { await cmd.ExecuteNonQueryAsync(ct); }
            catch (PostgresException e) when (e.SqlState == "23503")
            { return Conflict(new { error = "Otros registros todavía dependen de este elemento." }); }
            await Auditar(con, tx, tabla, id, "eliminar", "Baja del administrador", antes, null, ct);
            return NoContent();
        }, ct);

    private async Task<IActionResult> Consultar(string tabla, int? id, int limite, int despuesDe, CancellationToken ct)
    {
        if (id <= 0 || despuesDe < 0 || limite is < 1 or > 100) return BadRequest();
        // La tabla la fija cada acción; los valores de la petición son parámetros.
        await using var cmd = database.CreateCommand($"""
            SELECT to_jsonb(t)::text FROM public.{tabla} t
            WHERE {(tabla == "politica_ml" ? "t.eliminada_en IS NULL AND" : "")} t.id > @cursor AND (@id IS NULL OR t.id = @id)
            ORDER BY t.id LIMIT @limite
            """);
        cmd.Parameters.AddWithValue("cursor", despuesDe);
        cmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Integer, (object?)id ?? DBNull.Value);
        cmd.Parameters.AddWithValue("limite", limite);
        try
        {
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            var filas = new List<JsonElement>();
            while (await reader.ReadAsync(ct)) filas.Add(JsonSerializer.Deserialize<JsonElement>(reader.GetString(0)));
            if (id.HasValue) return filas.Count == 0 ? NotFound() : Ok(filas[0]);
            return Ok(filas);
        }
        catch (NpgsqlException) { return Problem(statusCode: 503, title: "No se pudo consultar el catálogo ML."); }
    }

    private async Task<IActionResult> Escribir(Func<NpgsqlConnection,NpgsqlTransaction,Task<IActionResult>> operacion, CancellationToken ct)
    {
        try
        {
            await using var conexion = await database.OpenConnectionAsync(ct);
            await using var tx = await conexion.BeginTransactionAsync(ct);
            if (HttpContext.Items["AdministradorMl"] is int actor)
            {
                await using var check = new NpgsqlCommand("""
                    SELECT u.id FROM usuario u JOIN rol r ON r.id=u.rol_id
                    WHERE u.id=@id AND u.activo AND u.estado='aprobado' AND r.nombre='Administrador'
                    FOR SHARE OF u
                    """, conexion, tx);
                check.Parameters.AddWithValue("id", actor);
                if (await check.ExecuteScalarAsync(ct) is null) return StatusCode(403);
            }
            var resultado = await operacion(conexion, tx);
            if (resultado is ObjectResult { StatusCode: >= 200 and < 300 } or OkResult or NoContentResult)
                await tx.CommitAsync(ct);
            return resultado;
        }
        catch (PostgresException e) when (e.SqlState is "23505" or "40001" or "40P01")
        { return Conflict(new { error = "El registro cambió o la versión ya existe." }); }
        catch (PostgresException e) when (e.SqlState is "23503" or "23514" or "22003" or "22001")
        { return BadRequest(new { error = "Datos o referencias incompatibles con el catálogo." }); }
        catch (NpgsqlException) { return Problem(statusCode: 503, title: "No se pudo guardar la operación ML."); }
    }

    private async Task Auditar(NpgsqlConnection con, NpgsqlTransaction tx, string entidad, int id,
        string accion, string motivo, string? antes, string? despues, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand("""
            INSERT INTO auditoria_evento(usuario_id,servicio,entidad,entidad_id,accion,motivo,datos_antes,datos_despues)
            VALUES (@usuario,@servicio,@entidad,@id,@accion,@motivo,CAST(@antes AS jsonb),CAST(@despues AS jsonb))
            """, con, tx);
        var actor = HttpContext.Items["AdministradorMl"] as int?;
        cmd.Parameters.AddWithValue("usuario", NpgsqlTypes.NpgsqlDbType.Integer, (object?)actor ?? DBNull.Value);
        cmd.Parameters.AddWithValue("servicio", NpgsqlTypes.NpgsqlDbType.Text, actor.HasValue ? DBNull.Value : "servicio_ml");
        cmd.Parameters.AddWithValue("entidad", entidad);
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("accion", accion);
        cmd.Parameters.AddWithValue("motivo", motivo);
        cmd.Parameters.AddWithValue("antes", NpgsqlTypes.NpgsqlDbType.Text, (object?)antes ?? DBNull.Value);
        cmd.Parameters.AddWithValue("despues", NpgsqlDbType.Text, (object?)despues ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync(ct);
    }
}
