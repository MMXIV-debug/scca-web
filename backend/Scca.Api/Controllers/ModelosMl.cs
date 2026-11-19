using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Npgsql;
using Scca.Api.Services;

namespace Scca.Api.Controllers;

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

public sealed partial class CatalogoMlController
{
    [HttpGet("modelos"), AccesoMl(AccesoMl.Administrador)]
    public Task<IActionResult> Modelos(CancellationToken ct, int limite = 50, int despuesDe = 0)
        => Consultar("modelo_ml", null, limite, despuesDe, ct);

    [HttpGet("modelos/{id:int}"), AccesoMl(AccesoMl.Administrador)]
    public Task<IActionResult> Modelo(int id, CancellationToken ct) => Consultar("modelo_ml", id, 1, 0, ct);

    [HttpPost("modelos"), AccesoMl(AccesoMl.ServicioML)]
    public Task<IActionResult> RegistrarModelo(NuevoModeloMl modelo, CancellationToken ct)
        => Escribir(async (con,tx) =>
        {
            if (modelo.Parametros.ValueKind != JsonValueKind.Object || modelo.DominioMin > modelo.DominioMax)
                return BadRequest(new { error = "Revisa los parámetros y el rango del modelo." });
            await using var cmd = new NpgsqlCommand("""
                INSERT INTO modelo_ml AS m(sensor_id,variable_id,politica_id,version,algoritmo,parametros,
                    artefacto_ruta,hash_artefacto,dominio_min,dominio_max)
                VALUES(@sensor,@variable,@politica,@version,@algoritmo,CAST(@parametros AS jsonb),@ruta,@hash,@min,@max)
                RETURNING to_jsonb(m)::text
                """, con, tx);
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
            int id = row.GetProperty("id").GetInt32();
            await Auditar(con,tx,"modelo_ml",id,"registrar","Registro del servicio ML",null,row.GetRawText(),ct);
            return CreatedAtAction(nameof(Modelo),new {id},row);
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
}
