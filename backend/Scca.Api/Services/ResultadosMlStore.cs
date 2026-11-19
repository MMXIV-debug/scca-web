using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace Scca.Api.Services;

public static class ResultadosMlStore
{
    // Entrada canónica: orden de claves estable; no depende del orden de un diccionario.
    public static string EntradaCanonica(Dictionary<string, double> valores, Dictionary<string, double> cobertura,
        int intervalo, double coberturaMinima) => JsonSerializer.Serialize(new
        {
            valores = new SortedDictionary<string, double>(valores, StringComparer.Ordinal),
            cobertura = new SortedDictionary<string, double>(cobertura, StringComparer.Ordinal),
            intervalo_s = intervalo, completitud_minima = coberturaMinima
        });

    public static async Task<long> Guardar(NpgsqlDataSource database, int sensorId, int nodoId,
        string perfil, string proposito, string variable, int horizonte, DateTime inicio, DateTime fin,
        string entrada, JsonElement resultado, CancellationToken ct)
    {
        var version = resultado.GetProperty("modelo_version").GetString()!;
        var metadatos = resultado.GetProperty("modelo_metadatos");
        if (metadatos.GetProperty("version").GetString() != version
            || metadatos.GetProperty("perfil").GetString() != perfil
            || metadatos.GetProperty("proposito").GetString() != proposito
            || metadatos.GetProperty("variable").GetString() != variable
            || metadatos.GetProperty("horizonte_h").GetInt32() != horizonte
            || resultado.GetProperty("ambito").GetString() != "demostracion"
            || resultado.GetProperty("calibracion_fisica_validada").GetBoolean())
            throw new InvalidOperationException("Metadatos incompatibles con la evaluación.");
        if (resultado.GetProperty("perfil").GetString() != perfil
            || resultado.GetProperty("proposito").GetString() != proposito
            || resultado.GetProperty("variable").GetString() != variable
            || resultado.GetProperty("horizonte_h").GetInt32() != horizonte)
            throw new InvalidOperationException("Resultado incompatible con el propósito.");
        if (resultado.GetProperty("estado").GetString() == "evaluado_demo"
            && (resultado.GetProperty("periodo_inicio").GetDateTimeOffset().UtcDateTime != inicio
                || resultado.GetProperty("periodo_fin").GetDateTimeOffset().UtcDateTime != fin
                || !double.IsFinite(resultado.GetProperty("valor").GetDouble())))
            throw new InvalidOperationException("Período o valor del resultado inválido.");
        var hash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(entrada)));
        await using var connection = await database.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);
        // Serializar primera inserción y reintentos de una misma versión.
        await using (var cmd = new NpgsqlCommand("SELECT pg_advisory_xact_lock(hashtextextended(@version, 0))", connection, transaction))
        {
            cmd.Parameters.AddWithValue("version", version);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        short variableId;
        await using (var cmd = new NpgsqlCommand("""
            SELECT v.id FROM public.variable v
            JOIN public.sensor_variable sv ON sv.variable_id=v.id
            JOIN public.sensor s ON s.id=sv.sensor_id
            WHERE s.id=@sensor AND s.nodo_id=@nodo AND s.activo AND v.codigo=@variable FOR SHARE OF s
            """, connection, transaction))
        {
            cmd.Parameters.AddWithValue("sensor", sensorId);
            cmd.Parameters.AddWithValue("nodo", nodoId);
            cmd.Parameters.AddWithValue("variable", variable);
            if (await cmd.ExecuteScalarAsync(ct) is not short id)
                throw new InvalidOperationException("Cambió el sensor o catálogo durante la evaluación.");
            variableId = id;
        }
        await using (var cmd = new NpgsqlCommand("""
            INSERT INTO public.ml_demo_version(version,sensor_id,nodo_id,perfil,proposito,variable_id,horizonte_h,metadatos)
            VALUES(@version,@sensor,@nodo,@perfil,@proposito,@variable,@horizonte,@metadatos)
            ON CONFLICT(version) DO NOTHING
            """, connection, transaction))
        {
            cmd.Parameters.AddWithValue("version", version);
            cmd.Parameters.AddWithValue("sensor", sensorId);
            cmd.Parameters.AddWithValue("nodo", nodoId);
            cmd.Parameters.AddWithValue("perfil", perfil);
            cmd.Parameters.AddWithValue("proposito", proposito);
            cmd.Parameters.AddWithValue("variable", variableId);
            cmd.Parameters.AddWithValue("horizonte", horizonte);
            cmd.Parameters.AddWithValue("metadatos", NpgsqlDbType.Jsonb, metadatos.GetRawText());
            await cmd.ExecuteNonQueryAsync(ct);
        }
        await using (var cmd = new NpgsqlCommand("""
            SELECT sensor_id=@sensor AND nodo_id=@nodo AND perfil=@perfil AND proposito=@proposito
                AND variable_id=@variable AND horizonte_h=@horizonte AND metadatos=@metadatos
            FROM public.ml_demo_version WHERE version=@version
            """, connection, transaction))
        {
            cmd.Parameters.AddWithValue("version", version);
            cmd.Parameters.AddWithValue("sensor", sensorId);
            cmd.Parameters.AddWithValue("nodo", nodoId);
            cmd.Parameters.AddWithValue("perfil", perfil);
            cmd.Parameters.AddWithValue("proposito", proposito);
            cmd.Parameters.AddWithValue("variable", variableId);
            cmd.Parameters.AddWithValue("horizonte", horizonte);
            cmd.Parameters.AddWithValue("metadatos", NpgsqlDbType.Jsonb, metadatos.GetRawText());
            if (await cmd.ExecuteScalarAsync(ct) is not true)
                throw new InvalidOperationException("La versión registrada tiene metadatos diferentes.");
        }
        await using (var cmd = new NpgsqlCommand("""
            INSERT INTO public.ml_demo_resultado(version,periodo_inicio,periodo_fin,entrada,entrada_sha256,resultado)
            VALUES(@version,@inicio,@fin,@entrada,@hash,@resultado)
            ON CONFLICT(version,periodo_inicio,entrada_sha256) DO NOTHING
            """, connection, transaction))
        {
            cmd.Parameters.AddWithValue("version", version);
            cmd.Parameters.AddWithValue("inicio", inicio);
            cmd.Parameters.AddWithValue("fin", fin);
            cmd.Parameters.AddWithValue("entrada", NpgsqlDbType.Jsonb, entrada);
            cmd.Parameters.AddWithValue("hash", hash);
            cmd.Parameters.AddWithValue("resultado", NpgsqlDbType.Jsonb, resultado.GetRawText());
            await cmd.ExecuteNonQueryAsync(ct);
        }
        long resultadoId;
        await using (var cmd = new NpgsqlCommand("""
            SELECT id, entrada=@entrada AND resultado=@resultado AND periodo_fin=@fin
            FROM public.ml_demo_resultado WHERE version=@version AND periodo_inicio=@inicio AND entrada_sha256=@hash
            """, connection, transaction))
        {
            cmd.Parameters.AddWithValue("version", version);
            cmd.Parameters.AddWithValue("inicio", inicio);
            cmd.Parameters.AddWithValue("fin", fin);
            cmd.Parameters.AddWithValue("hash", hash);
            cmd.Parameters.AddWithValue("entrada", NpgsqlDbType.Jsonb, entrada);
            cmd.Parameters.AddWithValue("resultado", NpgsqlDbType.Jsonb, resultado.GetRawText());
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct) || !reader.GetBoolean(1))
                throw new InvalidOperationException("El reintento produjo un resultado diferente; se conserva el primero.");
            resultadoId = reader.GetInt64(0);
        }
        await transaction.CommitAsync(ct);
        return resultadoId;
    }
}
