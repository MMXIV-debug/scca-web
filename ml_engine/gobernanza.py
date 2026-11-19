"""Registro local transaccional de modelos de demostración, separado de inferencia."""
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import uuid

import numpy as np


POLITICA = {
    'version': 'demo-1', 'pares_minimos': 540, 'dias_minimos': 30,
    'fraccion_prueba': 0.30, 'completitud_minima': 0.75,
    'mejora_rmse_minima': 0.20, 'tolerancia_error_cero': 1e-9,
    'descripcion': 'Criterios de calibración originales; uso conservador provisional en pronóstico demo.',
}


def ahora():
    return datetime.now(timezone.utc).isoformat()


def hash_archivo(ruta):
    return hashlib.sha256(Path(ruta).read_bytes()).hexdigest()


def escribir_json(ruta, datos):
    Path(ruta).write_text(json.dumps(datos, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')


def metricas(real, predicho):
    real, predicho = np.asarray(real, dtype=float), np.asarray(predicho, dtype=float)
    if real.ndim != 1 or real.shape != predicho.shape or not real.size:
        raise ValueError('Predicciones y objetivos deben ser vectores del mismo tamaño no vacío.')
    if not np.isfinite(real).all() or not np.isfinite(predicho).all():
        raise ValueError('No se admiten métricas con NaN o infinito.')
    with np.errstate(over='raise', invalid='raise'):
        try:
            error = predicho - real
            denominador = float(np.sum((real - real.mean()) ** 2))
            rmse = float(np.sqrt(np.mean(error ** 2)))
        except FloatingPointError as exc:
            raise ValueError('Los valores desbordan el cálculo de métricas.') from exc
    return {'n': int(real.size), 'rmse': rmse,
            'mae': float(np.mean(np.abs(error))), 'sesgo': float(np.mean(error)),
            'r2': None if denominador == 0 else float(1 - np.sum(error ** 2) / denominador)}


def decidir(base, candidato, vigente=None):
    """El vigente se evalúa en las MISMAS filas finales que el candidato."""
    razones = []
    tolerancia = POLITICA['tolerancia_error_cero']
    if base['rmse'] == 0:
        if candidato['rmse'] > tolerancia:
            razones.append('error_original_cero_supera_tolerancia')
        mejora = None
    else:
        mejora = 1 - candidato['rmse'] / base['rmse']
        if candidato['rmse'] > base['rmse'] * (1 - POLITICA['mejora_rmse_minima']):
            razones.append('mejora_rmse_insuficiente')
    if candidato['mae'] > base['mae']:
        razones.append('mae_empeora')
    if abs(candidato['sesgo']) > abs(base['sesgo']):
        razones.append('sesgo_absoluto_empeora')
    if vigente:
        if candidato['rmse'] > vigente['rmse']:
            razones.append('rmse_empeora_frente_al_vigente')
        if candidato['mae'] > vigente['mae']:
            razones.append('mae_empeora_frente_al_vigente')
        if abs(candidato['sesgo']) > abs(vigente['sesgo']):
            razones.append('sesgo_empeora_frente_al_vigente')
    return {'estado': 'rechazado' if razones else 'apto_demo', 'razones': razones,
            'mejora_rmse_fraccion': mejora}


class Registro:
    """Un único escritor local. Reemplazo atómico del registro; artefactos inmutables.

    No es un servicio multi-host ni sustituye modelo_ml/auditoria_evento en PostgreSQL.
    Si un proceso muere, el bloqueo permanece: se debe revisar antes de retirarlo.
    """
    def __init__(self, raiz):
        self.raiz = Path(raiz).resolve()
        self.raiz.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def bloquear(self):
        bloqueo = self.raiz / '.lock'
        try:
            bloqueo.mkdir()
        except FileExistsError as exc:
            raise ValueError('Registro ocupado; si hubo un fallo revisa el proceso antes de retirar .lock.') from exc
        try:
            escribir_json(bloqueo / 'propietario.json', {'pid': os.getpid(), 'creado_en': ahora()})
            yield
        finally:
            (bloqueo / 'propietario.json').unlink(missing_ok=True)
            bloqueo.rmdir()

    def leer(self):
        ruta = self.raiz / 'registro.json'
        return json.loads(ruta.read_text(encoding='utf-8')) if ruta.exists() else {
            'version': 1, 'ambito': 'demostracion', 'modelos': {}, 'activos': {},
            'pruebas_consumidas': {}, 'eventos': []}

    def guardar(self, estado):
        temporal = self.raiz / f'.registro-{uuid.uuid4().hex}.tmp'
        try:
            with temporal.open('x', encoding='utf-8') as salida:
                json.dump(estado, salida, ensure_ascii=False, indent=2, allow_nan=False)
                salida.flush()
                os.fsync(salida.fileno())
            os.replace(temporal, self.raiz / 'registro.json')
        finally:
            temporal.unlink(missing_ok=True)

    def artefacto(self, entrada):
        ruta = (self.raiz / entrada['artefacto']).resolve()
        if not ruta.is_relative_to(self.raiz) or not ruta.is_file():
            raise ValueError('Artefacto inexistente o fuera del registro.')
        if hash_archivo(ruta) != entrada['sha256']:
            raise ValueError('Integridad del artefacto incorrecta.')
        return ruta

    def reservar_prueba(self, estado, clave, inicio, fin, version):
        # No reutilizar el período aunque se exporten las mismas filas con otro hash.
        limite = estado['pruebas_consumidas'].get(clave)
        if limite and inicio <= limite:
            raise ValueError('La prueba final se solapa con una ya consumida. Se requiere un período posterior.')
        estado['pruebas_consumidas'][clave] = fin
        estado['eventos'].append({'fecha': ahora(), 'accion': 'reservar_prueba',
                                  'version': version, 'clave': clave, 'inicio': inicio, 'fin': fin})
        self.guardar(estado)  # persiste ANTES de abrir la prueba final; también ante fallo posterior

    def promover(self, estado, version):
        entrada = estado['modelos'][version]
        if entrada['estado'] != 'apto_demo' or entrada['ambito'] != 'demostracion':
            raise ValueError('Solo un candidato apto de demostración puede activarse aquí.')
        self.artefacto(entrada)
        anterior = estado['activos'].get(entrada['clave'])
        if anterior != entrada['vigente_comparado']:
            raise ValueError('Cambió el vigente desde la evaluación; no se puede promover.')
        estado['activos'][entrada['clave']] = version
        entrada['anterior'] = anterior
        estado['eventos'].append({'fecha': ahora(), 'accion': 'activar_demo',
                                  'version': version, 'anterior': anterior})
        self.guardar(estado)

    def revertir(self, clave, motivo):
        if not motivo.strip():
            raise ValueError('Se requiere motivo de reversión.')
        with self.bloquear():
            estado = self.leer()
            actual = estado['activos'].get(clave)
            if not actual:
                raise ValueError('No hay un modelo activo de demostración para esta clave.')
            entrada = estado['modelos'][actual]
            anterior = entrada.get('anterior')
            if anterior:
                previo = estado['modelos'][anterior]
                if previo['estado'] != 'apto_demo' or previo['clave'] != clave:
                    raise ValueError('La versión anterior no conserva aptitud.')
                self.artefacto(previo)
            entrada['estado'] = 'suspendido'
            if anterior:
                estado['activos'][clave] = anterior
            else:
                estado['activos'].pop(clave)
            estado['eventos'].append({'fecha': ahora(), 'accion': 'revertir_demo',
                                      'version': actual, 'anterior': anterior, 'motivo': motivo})
            self.guardar(estado)
            return anterior
