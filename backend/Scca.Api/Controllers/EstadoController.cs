using Microsoft.AspNetCore.Mvc;
using Npgsql;

namespace Scca.Api.Controllers;

[ApiController]
[Route("api/estado")]
public class EstadoController : ControllerBase
{
    private readonly NpgsqlDataSource _database;

    // Recibir la conexión configurada en Program.cs.
    public EstadoController(NpgsqlDataSource database)
    {
        _database = database;
    }

    // Comprobar que PostgreSQL responde.
    [HttpGet]
    public async Task<IActionResult> Get(
        CancellationToken cancellationToken)
    {
        await using var command =
            _database.CreateCommand("SELECT 1");

        await command.ExecuteScalarAsync(cancellationToken);

        return Ok(new
        {
            api = "disponible",
            postgresql = "conectado"
        });
    }
}