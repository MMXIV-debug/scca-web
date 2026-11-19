using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Npgsql;
using NpgsqlTypes;
using Scca.Api.Services;

namespace Scca.Api.Controllers;

public sealed record NuevaValidacionMl(
    [Range(1,int.MaxValue)] int ModeloId,
    [Range(1,int.MaxValue)] int PoliticaId,
    [Range(1,int.MaxValue)] int Pares,
    [Required, RegularExpression("apto|rechazado|pendiente")] string Estado,
    decimal? MaeOrig, decimal? RmseOrig, decimal? SesgoOrig,
    decimal? MaeMl, decimal? RmseMl, decimal? SesgoMl, decimal? R2, decimal? MejoraRmsePct,
    [RegularExpression("[a-fA-F0-9]{64}")] string? HashConjunto);

public sealed partial class CatalogoMlController
{
    [HttpGet("validaciones"), AccesoMl(AccesoMl.Administrador)]
    public Task<IActionResult> Validaciones(CancellationToken ct, int limite = 50, int despuesDe = 0)
        => Consultar("validacion_ml", null, limite, despuesDe, ct);

    [HttpGet("validaciones/{id:int}"), AccesoMl(AccesoMl.Administrador)]
    public Task<IActionResult> Validacion(int id, CancellationToken ct) => Consultar("validacion_ml", id, 1, 0, ct);

    [HttpPost("validaciones"), AccesoMl(AccesoMl.ServicioML)]
    public Task<IActionResult> RegistrarValidacion(NuevaValidacionMl v, CancellationToken ct)
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
            await using var cmd = new NpgsqlCommand("""
                INSERT INTO validacion_ml AS v(modelo_id,politica_id,pares,estado,mae_orig,rmse_orig,sesgo_orig,
                    mae_ml,rmse_ml,sesgo_ml,r2,mejora_rmse_pct,hash_conjunto)
                VALUES(@modelo,@politica,@pares,@estado,@mae0,@rmse0,@sesgo0,@mae,@rmse,@sesgo,@r2,@mejora,@hash)
                RETURNING to_jsonb(v)::text
                """,con,tx);
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
            int id = row.GetProperty("id").GetInt32();
            await Auditar(con,tx,"validacion_ml",id,"registrar","Evaluación del servicio ML",null,row.GetRawText(),ct);
            return CreatedAtAction(nameof(Validacion),new {id},row);
        },ct);
}
