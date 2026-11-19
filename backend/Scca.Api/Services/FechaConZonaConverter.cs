using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
namespace Scca.Api.Services;
public sealed class FechaConZonaConverter : JsonConverter<DateTimeOffset>
{
    public override DateTimeOffset Read(ref Utf8JsonReader reader,Type type,JsonSerializerOptions options)
    {
        var valor=reader.GetString();
        if(valor is null || !Regex.IsMatch(valor,@"(Z|[+-]\d{2}:\d{2})$")
            || !DateTimeOffset.TryParse(valor,CultureInfo.InvariantCulture,DateTimeStyles.None,out var fecha))
            throw new JsonException("La fecha debe incluir Z o un desplazamiento horario explícito.");
        return fecha;
    }
    public override void Write(Utf8JsonWriter writer,DateTimeOffset value,JsonSerializerOptions options)=>writer.WriteStringValue(value);
}
