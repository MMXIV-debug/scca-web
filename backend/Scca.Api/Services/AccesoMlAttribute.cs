using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Scca.Api.Services;

public enum AccesoMl { Administrador, ServicioML }

[AttributeUsage(AttributeTargets.Method)]
public sealed class AccesoMlAttribute(AccesoMl acceso) : Attribute, IAsyncAuthorizationFilter
{
    public string Esquema => acceso.ToString();
    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var http = context.HttpContext;
        var services = http.RequestServices;
        if (acceso == AccesoMl.ServicioML)
        {
            var config = services.GetRequiredService<IConfiguration>();
            var key = config["Ml:RegistroApiKey"];
            if (string.IsNullOrWhiteSpace(key) || key == config["Iot:ApiKey"])
                context.Result = new StatusCodeResult(503);
            else if (!http.Request.Headers.TryGetValue("X-ML-Key", out var supplied) ||
                !CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(key)),
                    SHA256.HashData(Encoding.UTF8.GetBytes(supplied.ToString()))))
                context.Result = new UnauthorizedResult();
            return;
        }

        if (!AuthenticationHeaderValue.TryParse(http.Request.Headers.Authorization.ToString(), out var auth)
            || !string.Equals(auth.Scheme, "Bearer", StringComparison.OrdinalIgnoreCase) || string.IsNullOrEmpty(auth.Parameter))
        {
            context.Result = new UnauthorizedResult();
            return;
        }

        try
        {
            using var client = services.GetRequiredService<IHttpClientFactory>().CreateClient("Panel");
            using var request = new HttpRequestMessage(HttpMethod.Get, "api/me");
            request.Headers.Authorization = auth;
            using var response = await client.SendAsync(request, http.RequestAborted);
            if (!response.IsSuccessStatusCode)
            {
                context.Result = new StatusCodeResult(response.StatusCode switch {
                    HttpStatusCode.Unauthorized => 401, HttpStatusCode.Forbidden => 403, _ => 503 });
                return;
            }
            var actor = await response.Content.ReadFromJsonAsync<Sesion>(http.RequestAborted);
            if (actor is not { Rol: "Administrador", Id: > 0 }) context.Result = new StatusCodeResult(403);
            else http.Items["AdministradorMl"] = actor.Id;
        }
        catch (Exception e) when (e is HttpRequestException or JsonException or NotSupportedException ||
            e is OperationCanceledException && !http.RequestAborted.IsCancellationRequested)
        {
            context.Result = new StatusCodeResult(503);
        }
    }
    private sealed record Sesion(int Id, string Rol);
}
