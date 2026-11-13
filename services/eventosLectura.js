const EventEmitter = require('events');

// Instancia global del Publicador de Eventos (Sujeto)
class LecturaEmitter extends EventEmitter {}
const lecturaEventos = new LecturaEmitter();

// Módulos suscritos (OBSERVADORES)

// --- Observador 1: Evaluador de Alertas ---
lecturaEventos.on('NuevaLecturaConfirmada', async (datosLectura) => {
    // console.log(`[Observer - Alertas] Analizando nueva lectura de sensor ${datosLectura.sensor_id}...`);
    
    // Simulación de evaluación de umbral (ejemplo con PM2.5 > 55.4 = Dañino)
    if (datosLectura.variable === 'PM25' && datosLectura.valor > 55.4) {
        console.log(`Umbral ambiental superado. Guardando alerta en BD...`);
        // Aquí puedes hacer el pool.query('INSERT INTO alerta...') en el futuro
    }
});

// --- Observador 2: Actualización de la UI en tiempo real ---
lecturaEventos.on('NuevaLecturaConfirmada', (datosLectura) => {
    // Aquí iría el código de Socket.io en el futuro para avisar a los clientes web
    // console.log(`[Observer - WebSockets] Refrescando tableros de visualizadores...`);
});

module.exports = lecturaEventos;