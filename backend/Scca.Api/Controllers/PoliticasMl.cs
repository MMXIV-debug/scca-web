using System.ComponentModel.DataAnnotations;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using Scca.Api.Services;

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
    JsonElement Configuracion);

public sealed partial class CatalogoMlController
{
    [HttpGet("politicas"), AccesoMl(AccesoMl.Administrador)]
    public Task<IActionResult> Politicas(CancellationToken ct, int limite = 50, int despuesDe = 0)
        => Consultar("politica_ml", null, limite, despuesDe, ct);

    [HttpGet("politicas/{id:int}"), AccesoMl(AccesoMl.Administrador)]
    public Task<IActionResult> Politica(int id, CancellationToken ct) => Consultar("politica_ml", id, 1, 0, ct);

    [HttpPost("politicas"), AccesoMl(AccesoMl.Administrador)]
    public async Task<IActionResult> CrearPolitica(NuevaPoliticaMl politica, CancellationToken ct)
    {
        if (politica.Configuracion.ValueKind != JsonValueKind.Object) return BadRequest();
        // El panel y Swagger comparten el mismo validador y la misma transacción de versionado.
        using var request = new HttpRequestMessage(HttpMethod.Post, "api/admin/ml/politicas");
        request.Headers.Authorization = AuthenticationHeaderValue.Parse(Request.Headers.Authorization.ToString());
        request.Content = JsonContent.Create(politica);
        try
        {
            using var client = clients.CreateClient("Panel");
            using var response = await client.SendAsync(request, ct);
            var body = await response.Content.ReadFromJsonAsync<JsonElement>(ct);
            if (!response.IsSuccessStatusCode) return StatusCode((int)response.StatusCode, body);
            return CreatedAtAction(nameof(Politica), new { id = body.GetProperty("id").GetInt32() }, body);
        }
        catch (Exception e) when (e is HttpRequestException or JsonException or NotSupportedException ||
            e is OperationCanceledException && !ct.IsCancellationRequested)
        { return Problem(statusCode: 503, title: "El panel no pudo confirmar la nueva versión de la política."); }
    }
}
