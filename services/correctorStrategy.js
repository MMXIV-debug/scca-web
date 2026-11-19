// Clase base o contrato (simulado para JavaScript)
class EstrategiaCorreccion {
    corregir(valorOriginal, parametros) {
        throw new Error("El método 'corregir' debe ser implementado.");
    }
}

// Estrategia A: Regresión Lineal (Calibración simple)
class RegresionLinealStrategy extends EstrategiaCorreccion {
    corregir(valorOriginal, parametros) {
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
    corregir(valorOriginal, parametros) {
        throw new Error('Random Forest y XGBoost requieren inferencia real mediante /api/modelo/evaluar. No se aplica un factor de ejemplo.');
    }
}

// Contexto: Selecciona la estrategia dinámicamente según el nombre del algoritmo
class SelectorCorreccion {
    constructor() {
        this.estrategias = {
            'regresion_lineal': new RegresionLinealStrategy(),
            'random_forest': new AlgoritmoComplejoStrategy(),
            'xgboost': new AlgoritmoComplejoStrategy()
        };
    }

    aplicar(lecturaValor, modelo) {
        if (!modelo || !modelo.algoritmo) return lecturaValor;
        
        const estrategia = this.estrategias[modelo.algoritmo];
        if (!estrategia) {
            throw new Error('Algoritmo sin estrategia de inferencia: ' + modelo.algoritmo);
        }

        return estrategia.corregir(lecturaValor, modelo.parametros);
    }
}

module.exports = new SelectorCorreccion();
