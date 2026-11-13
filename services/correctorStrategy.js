// Clase base o contrato (simulado para JavaScript)
class EstrategiaCorreccion {
    corregir(valorOriginal, parametros) {
        throw new Error("El método 'corregir' debe ser implementado.");
    }
}

// Estrategia A: Regresión Lineal (Calibración simple)
class RegresionLinealStrategy extends EstrategiaCorreccion {
    corregir(valorOriginal, parametros) {
        // Fórmula y = mx + b (pendiente e intersepto)
        const m = parametros.pendiente || 1;
        const b = parametros.intersepto || 0;
        return (valorOriginal * m) + b;
    }
}

// Estrategia B: Modelos Complejos (XGBoost / Random Forest)
class AlgoritmoComplejoStrategy extends EstrategiaCorreccion {
    corregir(valorOriginal, parametros) {
        // Aquí iría una llamada a un microservicio en Python o un factor de inferencia
        const factor = parametros.factor_ajuste || 1;
        return valorOriginal * factor;
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
            console.warn(`No hay estrategia definida para el algoritmo: ${modelo.algoritmo}`);
            return lecturaValor;
        }

        return estrategia.corregir(lecturaValor, modelo.parametros);
    }
}

module.exports = new SelectorCorreccion();