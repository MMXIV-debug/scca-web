// Tabla de transiciones permitidas para Usuarios
const TRANSICIONES_USUARIO = {
    'pendiente': ['aprobado', 'rechazado'], // Desde pendiente solo puedes aprobar o rechazar
    'aprobado':  ['inactivo'], // Si está aprobado, solo se puede inhabilitar
    'inactivo':  ['aprobado'], // Si está inactivo, se puede reactivar
    'rechazado': [] // Estado final: no puede cambiar a nada
};

// Tabla de transiciones permitidas para Modelos ML
const TRANSICIONES_MODELO = {
    'candidato':  ['apto', 'rechazado'],
    'apto':       ['activo', 'retirado'],
    'activo':     ['suspendido', 'retirado'],
    'suspendido': ['activo', 'retirado'],
    'rechazado':  [],
    'retirado':   []
};

class ValidadorEstados {
    /**
     * Valida si un cambio de estado es legal según las reglas de negocio.
     */
    static verificarTransicion(entidad, estadoActual, estadoNuevo) {
        let reglas;
        if (entidad === 'usuario') reglas = TRANSICIONES_USUARIO;
        else if (entidad === 'modelo') reglas = TRANSICIONES_MODELO;
        else throw new Error(`Entidad '${entidad}' no configurada en la máquina de estados.`);

        const permitidos = reglas[estadoActual];
        
        if (!permitidos) {
            throw new Error(`El estado actual '${estadoActual}' es desconocido o inválido.`);
        }

        if (!permitidos.includes(estadoNuevo)) {
            throw new Error(`Transición ilegal de estado: No se puede pasar un ${entidad} de '${estadoActual}' a '${estadoNuevo}'.`);
        }

        return true;
    }
}

module.exports = ValidadorEstados;