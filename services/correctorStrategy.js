// Contrato común para corrección escalar e inferencia versionada.
class EstrategiaCorreccion {
    corregir(valorOriginal, parametros, contexto) {
        if (typeof contexto?.ejecutar === 'function') return this.evaluar(valorOriginal, contexto.ejecutar);
        throw new Error("El método 'corregir' debe ser implementado.");
    }

    async evaluar(solicitud, ejecutar) {
        return ejecutar(solicitud);
    }
}

// Estrategia A: Regresión Lineal (Calibración simple)
class RegresionLinealStrategy extends EstrategiaCorreccion {
    corregir(valorOriginal, parametros, contexto) {
        if (contexto) return super.corregir(valorOriginal, parametros, contexto);
        if (!Number.isFinite(valorOriginal) || !parametros || typeof parametros !== 'object') {
            throw new TypeError('La corrección lineal requiere un valor y parámetros numéricos.');
        }
        // Fórmula y = mx + b (pendiente e intersepto)
        const m = parametros.pendiente ?? 1;
        const b = parametros.intersepto ?? 0;
        const resultado = (valorOriginal * m) + b;
        if (!Number.isFinite(m) || !Number.isFinite(b) || !Number.isFinite(resultado)) {
            throw new TypeError('Parámetros lineales inválidos o resultado fuera de rango.');
        }
        return resultado;
    }
}

// Estrategia B: Modelos Complejos (XGBoost / Random Forest)
class AlgoritmoComplejoStrategy extends EstrategiaCorreccion {
    corregir(valorOriginal, parametros, contexto) {
        if (typeof contexto?.ejecutar !== 'function') {
            throw new Error('Random Forest y XGBoost requieren la solicitud completa y el servicio de inferencia real.');
        }
        return super.corregir(valorOriginal, parametros, contexto);
    }
}

class PersistenciaStrategy extends EstrategiaCorreccion {
    async evaluar(solicitud, ejecutar) {
        if (solicitud.proposito !== 'pronostico') {
            throw Object.assign(new Error('Persistencia solo admite pronósticos.'), { status: 422 });
        }
        return ejecutar(solicitud);
    }
}

class AnomaliasStrategy extends EstrategiaCorreccion {
    async evaluar(solicitud, ejecutar) {
        if (solicitud.proposito !== 'anomalias' || (solicitud.horizonteH || 0) !== 0) {
            throw Object.assign(new Error('Isolation Forest requiere anomalías sin horizonte.'), { status: 422 });
        }
        return ejecutar(solicitud);
    }
}

// Contexto: Selecciona la estrategia dinámicamente según el nombre del algoritmo
class SelectorCorreccion {
    constructor() {
        this.estrategias = {
            'regresion_lineal': new RegresionLinealStrategy(),
            'random_forest': new AlgoritmoComplejoStrategy(),
            'xgboost': new AlgoritmoComplejoStrategy(),
            'persistencia': new PersistenciaStrategy(),
            'isolation_forest': new AnomaliasStrategy()
        };
    }

    aplicar(lecturaValor, modelo, contexto) {
        if (!modelo || !modelo.algoritmo) return lecturaValor;
        
        const estrategia = this.estrategias[modelo.algoritmo];
        if (!estrategia) {
            throw new Error('Algoritmo sin estrategia de inferencia: ' + modelo.algoritmo);
        }

        return estrategia.corregir(lecturaValor, modelo.parametros, contexto);
    }

    async evaluar(solicitud, modelo, ejecutar) {
        if (typeof ejecutar !== 'function') throw new TypeError('Se requiere el servicio de inferencia.');
        if (!modelo) return ejecutar(solicitud); // El backend informa sin_modelo o valida la solicitud.
        const estrategia = this.estrategias[modelo.algoritmo];
        if (!estrategia) throw Object.assign(new Error('Algoritmo sin estrategia de inferencia: ' + modelo.algoritmo), { status: 422 });
        // Las evaluaciones versionadas, incluso las lineales multivariables, utilizan
        // el artefacto real en Python y las validaciones/persistencia de la API .NET.
        return this.aplicar(solicitud, modelo, { ejecutar });
    }
}

module.exports = new SelectorCorreccion();
