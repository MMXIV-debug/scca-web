using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Npgsql;
using Scca.Api.Services;

namespace Scca.Api.Controllers;

[ApiController]
[Route("api/ml")]
public sealed partial class CatalogoMlController(NpgsqlDataSource database, IHttpClientFactory clients) : ControllerBase
{
    private async Task<IActionResult> Consultar(string tabla, int? id, int limite, int despuesDe, CancellationToken ct)
    {
        if (id <= 0 || despuesDe < 0 || limite is < 1 or > 100) return BadRequest();
        // La tabla la fija cada acción; los valores de la petición son parámetros.
        await using var cmd = database.CreateCommand($"""
            SELECT to_jsonb(t)::text FROM public.{tabla} t
            WHERE t.id > @cursor AND (@id IS NULL OR t.id = @id)
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
            if (resultado is ObjectResult { StatusCode: >= 200 and < 300 } or OkResult)
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
        string accion, string motivo, string? antes, string despues, CancellationToken ct)
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
        cmd.Parameters.AddWithValue("despues", despues);
        await cmd.ExecuteNonQueryAsync(ct);
    }
}
