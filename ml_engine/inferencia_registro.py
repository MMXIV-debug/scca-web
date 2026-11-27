"""Inferencia versionada de demostración; no persiste lecturas ni resultados."""
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import io
import json
import math
from pathlib import Path
from typing import Literal

import joblib
import pandas as pd
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

from datasets import PERFILES


class SeleccionModelo(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    nodo_id: int = Field(gt=0, strict=True)
    sensor_id: int = Field(gt=0, strict=True)
    perfil: Literal['dht11', 'bme680', 'contaminantes_simulados']
    proposito: Literal['calibracion', 'pronostico', 'anomalias']
    variable: str = Field(min_length=1, max_length=20)
    horizonte_h: Literal[0, 1, 3, 6] = 0

    @model_validator(mode='after')
    def comprobar(self):
        if self.variable not in PERFILES[self.perfil].unidades:
            raise ValueError('Variable ajena al perfil.')
        if self.proposito == 'anomalias' and self.variable != ('PM25' if self.perfil == 'contaminantes_simulados' else 'TEMP'):
            raise ValueError('El detector evalúa el perfil completo: seleccionar PM25 para contaminantes o TEMP para perfiles físicos.')
        if (self.proposito == 'pronostico') != (self.horizonte_h > 0):
            raise ValueError('Pronóstico exige horizonte 1/3/6; los otros propósitos exigen 0.')
        return self

    def clave(self):
        clave = f'nodo_{self.nodo_id}/sensor_{self.sensor_id}/{self.perfil}/{self.proposito}/{self.variable}'
        return clave + (f'/{self.horizonte_h}h' if self.proposito == 'pronostico' else '')


class EntradaModelo(SeleccionModelo):
    valores: dict[str, float] = Field(min_length=1, max_length=4)
    periodo_inicio: datetime
    periodo_fin: datetime
    # Precondición contra activación/reversión concurrente entre estado e inferencia.
    modelo_version: str = Field(pattern=r'^[a-f0-9]{32}$')

    @model_validator(mode='after')
    def comprobar_periodo(self):
        if self.periodo_inicio.tzinfo is None or self.periodo_fin.tzinfo is None:
            raise ValueError('Las fechas requieren zona horaria.')
        inicio = self.periodo_inicio.astimezone(timezone.utc)
        fin = self.periodo_fin.astimezone(timezone.utc)
        if inicio.minute or inicio.second or inicio.microsecond or fin - inicio != timedelta(hours=1):
            raise ValueError('Se requiere una hora UTC completa, no una lectura instantánea.')
        if fin > datetime.now(timezone.utc):
            raise ValueError('El período no puede estar abierto ni en el futuro.')
        if not set(self.valores).issubset(PERFILES[self.perfil].unidades):
            raise ValueError('Variables ajenas al perfil.')
        return self


class ServicioRegistro:
    def __init__(self, raiz):
        self.raiz = Path(raiz).resolve()

    def resolver(self, seleccion):
        ruta = self.raiz / 'registro.json'
        if not ruta.exists():
            return None
        try:
            estado = json.loads(ruta.read_text(encoding='utf-8'))
            if estado['version'] != 1 or estado['ambito'] != 'demostracion':
                raise ValueError('Registro incompatible')
            version = estado['activos'].get(seleccion.clave())
            if not version:
                return None
            entrada = estado['modelos'][version]
            if (entrada['version'] != version or entrada['clave'] != seleccion.clave()
                    or entrada['estado'] != 'apto_demo' or entrada['ambito'] != 'demostracion'
                    or entrada['sensor'] != {'nodo_id': seleccion.nodo_id, 'sensor_id': seleccion.sensor_id}
                    or entrada['perfil'] != seleccion.perfil or entrada['proposito'] != seleccion.proposito
                    or entrada['variable'] != seleccion.variable or entrada['horizonte_h'] != seleccion.horizonte_h):
                raise ValueError('Identidad/estado incompatible')
            agregado_esperado=0 if seleccion.proposito=='anomalias' else 3600
            if entrada['entrada_agregado_s'] != agregado_esperado or entrada['intervalo_s'] <= 0 or 3600 % entrada['intervalo_s']:
                raise ValueError('Contrato temporal incompatible')
            cobertura = entrada['politica']['completitud_minima']
            if not math.isfinite(cobertura) or not .75 <= cobertura <= 1:
                raise ValueError('Política de cobertura incompatible')
            columnas = entrada['variables_entrada']
            if not columnas or len(set(columnas)) != len(columnas) or not set(columnas).issubset(PERFILES[seleccion.perfil].unidades):
                raise ValueError('Contrato de variables incompatible')
            for c in columnas:
                minimo, maximo = entrada['dominio'][c]
                if not math.isfinite(minimo) or not math.isfinite(maximo) or minimo > maximo:
                    raise ValueError('Dominio inválido')
            return entrada
        except (OSError, ValueError, KeyError, TypeError) as exc:
            raise HTTPException(503, 'Registro de modelos incompatible o no disponible.') from exc

    def respuesta(self, seleccion, entrada):
        return {'estado': 'disponible_demo' if entrada else 'sin_modelo',
                'ambito': 'demostracion', 'calibracion_fisica_validada': False,
                'nodo_id': seleccion.nodo_id, 'sensor_id': seleccion.sensor_id,
                'perfil': seleccion.perfil, 'proposito': seleccion.proposito,
                'variable': seleccion.variable, 'horizonte_h': seleccion.horizonte_h,
                'modelo_version': entrada['version'] if entrada else None,
                'variables_entrada': entrada['variables_entrada'] if entrada else [],
                'entrada_agregado_s': entrada['entrada_agregado_s'] if entrada else None,
                'intervalo_s': entrada['intervalo_s'] if entrada else None,
                'completitud_minima': entrada['politica']['completitud_minima'] if entrada else None,
                # Copia de evaluación sin rutas locales, secretos ni objeto serializado.
                'modelo_metadatos': {k: entrada[k] for k in (
                    'version', 'perfil', 'proposito', 'variable', 'horizonte_h',
                    'algoritmo', 'sha256', 'dataset_sha256', 'politica',
                    'variables_entrada', 'dominio', 'entrada_agregado_s', 'intervalo_s',
                    'metricas', 'particiones', 'creado_en','tipo_pronostico','modo_evaluacion',
                    'validacion_etiquetada','interpretacion','procedencia_entrenamiento') if k in entrada} if entrada else None,
                'valor': None, 'es_anomalia': None}

    def estado(self, seleccion):
        entrada = self.resolver(seleccion)
        return self.respuesta(seleccion, entrada)

    def inferir(self, solicitud):
        entrada = self.resolver(solicitud)
        respuesta = self.respuesta(solicitud, entrada)
        if not entrada or entrada['version'] != solicitud.modelo_version:
            raise HTTPException(409, 'Cambió el modelo activo; consulta su estado y recalcula la entrada.')
        if solicitud.proposito == 'anomalias':
            raise HTTPException(503, 'La evaluación de anomalías por perfiles aún no está habilitada.')
        columnas = entrada['variables_entrada']
        if set(solicitud.valores) != set(columnas):
            raise HTTPException(422, {'variables_requeridas': columnas})
        fuera=any(not entrada['dominio'][c][0] <= solicitud.valores[c] <= entrada['dominio'][c][1] for c in columnas)
        if fuera and not (solicitud.proposito=='pronostico' and entrada['politica'].get('arranque_demo')):
            respuesta['estado'] = 'fuera_dominio'
            return respuesta
        try:
            ruta = (self.raiz / entrada['artefacto']).resolve()
            if not ruta.is_relative_to(self.raiz):
                raise ValueError('Ruta fuera del registro')
            contenido = ruta.read_bytes()
            if hashlib.sha256(contenido).hexdigest() != entrada['sha256']:
                raise ValueError('Hash incorrecto')
            modelo = joblib.load(io.BytesIO(contenido))
            if list(modelo.feature_names_in_) != columnas:
                raise ValueError('Columnas de artefacto incompatibles')
            salida = modelo.predict(pd.DataFrame([[solicitud.valores[c] for c in columnas]], columns=columnas))
            if len(salida) != 1 or not math.isfinite(float(salida[0])):
                raise ValueError('Salida no finita')
            valor = float(salida[0])
            if solicitud.variable != 'TEMP' and valor < 0:
                raise ValueError('Salida física negativa')
            if solicitud.variable == 'HUM' and not 0 <= valor <= 100:
                raise ValueError('Humedad fuera de rango')
        except Exception as exc:
            raise HTTPException(503, 'No se pudo verificar o ejecutar el artefacto activo.') from exc
        respuesta.update({'estado': 'evaluado_demo', 'valor': valor,
                          'tipo_pronostico':entrada.get('tipo_pronostico'), 'fuera_dominio_entrada':fuera,
                          'unidad': PERFILES[solicitud.perfil].unidades[solicitud.variable],
                          'periodo_inicio': solicitud.periodo_inicio, 'periodo_fin': solicitud.periodo_fin,
                          'objetivo_inicio': solicitud.periodo_inicio + timedelta(hours=solicitud.horizonte_h),
                          'objetivo_fin': solicitud.periodo_fin + timedelta(hours=solicitud.horizonte_h)})
        return respuesta


def crear_router_registro(raiz, obtener_clave, obtener_detector=None, obtener_version=None):
    servicio = ServicioRegistro(raiz)

    def autenticar(x_api_key: str | None = Header(default=None)):
        esperada = obtener_clave()
        if not esperada:
            raise HTTPException(503, 'Falta configurar la credencial del servicio ML.')
        if not x_api_key or not hmac.compare_digest(x_api_key.encode(), esperada.encode()):
            raise HTTPException(401, 'Credencial inválida.')

    router = APIRouter(prefix='/api/v2/modelos', dependencies=[Depends(autenticar)])

    class MuestraBruta(BaseModel):
        model_config=ConfigDict(extra='forbid',allow_inf_nan=False)
        nodo_id:int=Field(gt=0,strict=True)
        sensor_id:int=Field(gt=0,strict=True)
        perfil:Literal['dht11','bme680','contaminantes_simulados']
        valores:dict[str,float]=Field(min_length=1,max_length=4)
        altitud_aproximada_m:float | None=Field(default=None,ge=-1000,le=20000)

    @router.post('/muestra')
    def muestra(solicitud:MuestraBruta):
        identidad={'nodo_id':solicitud.nodo_id,'sensor_id':solicitud.sensor_id}
        if solicitud.altitud_aproximada_m is not None:
            if solicitud.perfil != 'bme680':
                raise HTTPException(422,'La altitud aproximada solo corresponde al BME680.')
            # No alterar las columnas de los detectores existentes ni tratar una
            # derivación de PRES como una quinta medición independiente.
            identidad['altitud_aproximada_m'] = solicitud.altitud_aproximada_m
            identidad['altitud_estado'] = 'derivada_no_evaluada_por_detector'
        if set(solicitud.valores)!=set(PERFILES[solicitud.perfil].unidades):
            raise HTTPException(422,'Se requieren todas las variables del perfil.')
        for c,v in solicitud.valores.items():
            if solicitud.perfil == 'bme680' and (c == 'TEMP' and not -40 <= v <= 85 or c == 'PRES' and not 300 <= v <= 1100):
                raise HTTPException(422,'Entrada fuera del rango físico del BME680.')
            if (c!='TEMP' and v<0) or c=='HUM' and v>100 or c in ('PRES','GAS') and v<=0 or c=='TEMP' and (v< -273.15 or solicitud.perfil=='dht11' and not 0<=v<=50):
                raise HTTPException(422,'Entrada fuera del rango físico.')
        seleccion=SeleccionModelo(nodo_id=solicitud.nodo_id,sensor_id=solicitud.sensor_id,perfil=solicitud.perfil,
            proposito='anomalias',variable='PM25' if solicitud.perfil=='contaminantes_simulados' else 'TEMP')
        entrada=servicio.resolver(seleccion)
        if entrada:
            try:
                ruta=(servicio.raiz/entrada['artefacto']).resolve()
                if not ruta.is_relative_to(servicio.raiz):raise ValueError('Ruta fuera del registro')
                contenido=ruta.read_bytes()
                if hashlib.sha256(contenido).hexdigest()!=entrada['sha256']:raise ValueError('Hash incompatible')
                modelo=joblib.load(io.BytesIO(contenido));columnas=entrada['variables_entrada']
                if list(modelo.feature_names_in_)!=columnas or set(columnas)!=set(solicitud.valores):raise ValueError('Columnas incompatibles')
                resultado=modelo.predict(pd.DataFrame([[solicitud.valores[c] for c in columnas]],columns=columnas))
                if len(resultado)!=1 or resultado[0] not in (-1,1):raise ValueError('Salida incompatible')
                return {**identidad,'estado':'evaluado_demo','es_anomalia':bool(resultado[0]==-1),'modelo_version':entrada['version'],'perfil':solicitud.perfil,'validacion_independiente':False,
                        'modo_evaluacion':entrada.get('modo_evaluacion','etiquetada'),'interpretacion':'lectura inusual; no confirma fallo del sensor'}
            except Exception as e:
                raise HTTPException(503,'No se pudo ejecutar el detector versionado.') from e
        if solicitud.perfil=='contaminantes_simulados' and obtener_detector and obtener_version:
            from integracion_iot import evaluar
            return {**identidad,'estado':'evaluado_legacy','es_anomalia':evaluar(obtener_detector(),solicitud.valores),
                'modelo_version':obtener_version(),'perfil':solicitud.perfil,'validacion_independiente':False}
        return {**identidad,'estado':'sin_modelo','es_anomalia':None,'modelo_version':None,'perfil':solicitud.perfil,'validacion_independiente':False}

    @router.get('/registro')
    def registro():
        try:
            ruta=Path(raiz)/'registro.json'
            datos=json.loads(ruta.read_text(encoding='utf-8')) if ruta.exists() else {'modelos':{},'activos':{}}
            activos=set(datos['activos'].values())
            claves=('version','clave','algoritmo','estado','perfil','sensor','proposito','variable','horizonte_h','politica','razones','metricas','etiquetas','criterios_anomalias','pares','dias_cubiertos','cobertura_periodo','creado_en','anterior','calibracion_fisica_validada','validacion_independiente','tipo_pronostico','modo_evaluacion','validacion_etiquetada','procedencia_entrenamiento')
            items=[{**{k:m.get(k) for k in claves},'activo':m['version'] in activos} for m in datos['modelos'].values()]
            items.sort(key=lambda m:m.get('creado_en') or '',reverse=True)
            ciclos=[]
            for p in sorted((Path(raiz)/'ciclos').glob('*.json'),key=lambda p:p.stat().st_mtime,reverse=True)[:10]:
                ciclos.append(json.loads(p.read_text(encoding='utf-8')))
            recientes=items[:500];versiones={m['version'] for m in recientes}
            return {'items':[m for m in items if m['activo'] and m['version'] not in versiones]+recientes, 'activos':[m for m in items if m['activo']], 'total':len(items), 'ciclos':ciclos, 'ambito':'demostracion'}
        except (OSError,ValueError,KeyError,TypeError) as e:
            raise HTTPException(503,'No se pudo consultar el registro.') from e

    class Reversion(BaseModel):
        model_config=ConfigDict(extra='forbid')
        clave:str=Field(min_length=1,max_length=200)
        motivo:str=Field(min_length=10,max_length=1000)

    @router.post('/revertir')
    def revertir(solicitud:Reversion):
        from gobernanza import Registro
        try:
            anterior=Registro(raiz).revertir(solicitud.clave,solicitud.motivo)
            return {'estado':'revertido','anterior':anterior}
        except ValueError as e:
            raise HTTPException(409,str(e)) from e

    @router.post('/estado')
    def estado(solicitud: SeleccionModelo):
        return servicio.estado(solicitud)

    @router.post('/inferir')
    def inferir(solicitud: EntradaModelo):
        return servicio.inferir(solicitud)

    class EntradaFuente(SeleccionModelo):
        periodo_inicio:datetime
        periodo_fin:datetime
        modelo_version:str=Field(pattern=r'^[a-f0-9]{32}$')

        @model_validator(mode='after')
        def periodo(self):
            a,b=self.periodo_inicio,self.periodo_fin
            if a.tzinfo is None or b.tzinfo is None or a.astimezone(timezone.utc).minute or a.second or a.microsecond or b-a!=timedelta(hours=1) or b>datetime.now(timezone.utc) or a<datetime.now(timezone.utc)-timedelta(days=3):
                raise ValueError('Se requiere una hora cerrada con zona de los últimos tres días.')
            return self

    from functools import lru_cache
    import time

    @lru_cache(maxsize=32)
    def fuente_horaria(lat,lon,inicio,fin,bloque):
        import pandas as pd
        from referencias import descargar_referencia,normalizar_referencia
        a,b=pd.Timestamp(inicio),pd.Timestamp(fin)
        datos,meta=descargar_referencia(lat,lon,a,b,timeout=10)
        tabla=normalizar_referencia(datos,a,b)
        tabla['PM1']=(tabla.PM25*.70).round(2)
        if len(tabla)!=1 or tabla.isna().any().any():raise ValueError('Fuente incompleta.')
        return {c:float(tabla.iloc[0][c]) for c in tabla},meta

    @router.post('/inferir-fuente')
    def inferir_fuente(solicitud:EntradaFuente):
        entrada=servicio.resolver(solicitud)
        if not entrada or entrada['version']!=solicitud.modelo_version:
            raise HTTPException(409,'Cambió el modelo activo.')
        if solicitud.perfil!='contaminantes_simulados' or solicitud.proposito!='pronostico' or not entrada['politica'].get('arranque_demo') or not entrada.get('fuente_coordenadas'):
            raise HTTPException(422,'Este modelo no admite entrada directa del proveedor.')
        try:
            coords=entrada['fuente_coordenadas']
            valores,meta=fuente_horaria(coords['latitud'],coords['longitud'],solicitud.periodo_inicio.isoformat(),solicitud.periodo_fin.isoformat(),int(time.time()/600))
        except Exception as e:
            raise HTTPException(503,'Fuente Open-Meteo no disponible; no se inventó una entrada.') from e
        seleccion=solicitud.model_dump(exclude={'periodo_inicio','periodo_fin','modelo_version'})
        respuesta=servicio.inferir(EntradaModelo(**seleccion,valores=valores,periodo_inicio=solicitud.periodo_inicio,periodo_fin=solicitud.periodo_fin,modelo_version=solicitud.modelo_version))
        respuesta['entrada_fuente']={'tipo':'historial_modelado_Open-Meteo','valores':valores,'cobertura':{c:1.0 for c in valores},'procedencia':meta,'PM1':'estimado: 0.70 × PM25'}
        return respuesta

    return router
