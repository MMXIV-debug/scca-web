using System.Text.Json;
using Microsoft.AspNetCore.Mvc;

namespace Scca.Api.Controllers;

[ApiController]
[Route("api/modelo")]
public sealed class ModeloController(IHttpClientFactory clients) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken cancellationToken)
    {
        try
        {
            using var response = await clients.CreateClient("ModeloMl").GetAsync("api/modelo", cancellationToken);
            if (!response.IsSuccessStatusCode)
                return Problem(statusCode: 503, title: "El modelo ML no está disponible.");
            var content = await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken);
            return Ok(content);
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException
            || ex is OperationCanceledException && !cancellationToken.IsCancellationRequested)
        {
            return Problem(statusCode: 503, title: "No se pudo conectar con el modelo ML.");
        }
    }
}
