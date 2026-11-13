import requests

class ProveedorAireAdapter:
    """Interfaz base para cualquier proveedor de clima."""
    def obtener_lecturas(self, latitud, longitud):
        raise NotImplementedError("Debe implementarse en la subclase")

class OpenMeteoAdapter(ProveedorAireAdapter):
    """Adaptador específico para la API de Open-Meteo."""
    def obtener_lecturas(self, latitud, longitud):
        url = f"https://air-quality-api.open-meteo.com/v1/air-quality?latitude={latitud}&longitude={longitud}&current=pm10,pm2_5,carbon_monoxide"
        
        try:
            respuesta = requests.get(url, timeout=10)
            respuesta.raise_for_status()
            datos = respuesta.json()
            
            pm2_5 = datos['current']['pm2_5']
            pm10 = datos['current']['pm10']
            co = datos['current']['carbon_monoxide']
            pm1 = round(pm2_5 * 0.70, 2)
            
            return {
                'PM1': pm1, 
                'PM2.5': pm2_5, 
                'PM10': pm10, 
                'CO': co
            }
        except requests.exceptions.RequestException as e:
            print(f"Error en Open-Meteo: {e}")
            return None