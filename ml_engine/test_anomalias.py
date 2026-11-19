import asyncio
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
import pandas as pd
from fastapi import FastAPI
from anomalias import metricas_clasificacion
from evaluacion import evaluar_dataset
from gobernanza import Registro,escribir_json,hash_archivo
from inferencia_registro import crear_router_registro
from test_inferencia_registro import solicitar


def dataset_etiquetado(root):
    root.mkdir()
    n=744;idx=pd.date_range('2026-01-01T00:00:00Z',periods=n,freq='h',name='medido_en')
    x=10+np.random.default_rng(42).normal(0,1,n);x[520:580]=10
    valores={'PM25':x,'PM1':x*.7,'PM10':x*1.4,'CO':100+x}
    horas=pd.DataFrame(valores,index=idx);horas.to_csv(root/'horas.csv')
    pd.DataFrame(1.0,index=idx,columns=horas.columns).to_csv(root/'completitud.csv')
    filas=[]
    for j,t in enumerate(idx):
        if 580<=j<610:continue
        for c in horas:filas.append({'id':len(filas)+1,'id_muestra':j+1,'medido_en':t,'codigo':c,'valor':horas.iloc[j][c],'calidad':'valida'})
    pd.DataFrame(filas).to_csv(root/'originales.csv',index=False)
    etiquetas=[]
    for j in range(520,610):
        fallo=int(j>=580)
        row={'medido_en':idx[j],'es_fallo':fallo,'cuarentena_id':j,'decision_id':j}
        row.update({c:(500 if fallo else float(horas.iloc[j][c])) for c in horas})
        etiquetas.append(row)
    pd.DataFrame(etiquetas).to_csv(root/'anomalias_revisadas.csv',index=False)
    meta={'version_formato':1,'sensor':{'sensor_id':1,'nodo_id':1},'perfil':'contaminantes_simulados',
        'unidades':{c:'µg/m3' for c in horas},'completitud_minima':.75,'intervalo_s':3600,
        'sha256':{p.name:hash_archivo(p) for p in root.iterdir()}}
    escribir_json(root/'manifiesto.json',meta)
    return root


class AnomaliasTests(unittest.TestCase):
    def test_metricas_distinguen_fallos_y_episodios_legitimos(self):
        m=metricas_clasificacion([0,0,1,1],[0,1,1,0])
        self.assertEqual((m['fp'],m['fn'],m['precision'],m['recall'],m['fpr']),(1,1,.5,.5,.5))

    def test_entrenar_e_inferir_por_perfil_y_no_reusar_prueba(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);datos=dataset_etiquetado(root/'datos');registro=root/'registro'
            r=evaluar_dataset(datos,registro,'anomalias','PM25',0)
            self.assertEqual(r['estado'],'apto_demo',r)
            self.assertEqual(r['entrada_agregado_s'],0)
            self.assertNotIn('rmse',r['metricas']['clasificacion'])
            app=FastAPI();app.include_router(crear_router_registro(registro,lambda:'clave-solo-prueba'))
            body={'nodo_id':1,'sensor_id':1,'perfil':'contaminantes_simulados','valores':{'PM25':10,'PM1':7,'PM10':14,'CO':110}}
            code,res=asyncio.run(solicitar(app,'/api/v2/modelos/muestra',body))
            self.assertEqual(code,200);self.assertFalse(res['es_anomalia']);self.assertEqual(res['modelo_version'],r['version'])
            code,res=asyncio.run(solicitar(app,'/api/v2/modelos/muestra',{**body,'valores':{c:500 for c in body['valores']}}))
            self.assertTrue(res['es_anomalia'])
            code,res=asyncio.run(solicitar(app,'/api/v2/modelos/muestra',{**body,'perfil':'dht11','sensor_id':2,'valores':{'TEMP':20,'HUM':50}}))
            self.assertIsNone(res['es_anomalia']);self.assertEqual(res['estado'],'sin_modelo')
            repetir=evaluar_dataset(datos,registro,'anomalias','PM25',0)
            self.assertEqual(repetir['estado'],'pendiente');self.assertEqual(Registro(registro).leer()['activos'][r['clave']],r['version'])

    def test_sin_etiquetas_no_entrena_un_detector(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);datos=dataset_etiquetado(root/'datos')
            labels=pd.read_csv(datos/'anomalias_revisadas.csv');labels.iloc[:0].to_csv(datos/'anomalias_revisadas.csv',index=False)
            meta=json.loads((datos/'manifiesto.json').read_text());meta['sha256']['anomalias_revisadas.csv']=hash_archivo(datos/'anomalias_revisadas.csv');escribir_json(datos/'manifiesto.json',meta)
            r=evaluar_dataset(datos,root/'registro','anomalias','PM25',0)
            self.assertEqual(r['estado'],'pendiente');self.assertFalse((root/'registro'/'versiones'/r['version']/'modelo.joblib').exists())

    def test_rechaza_detector_que_confunde_episodios_legitimos_con_fallos(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);datos=dataset_etiquetado(root/'datos')
            labels=pd.read_csv(datos/'anomalias_revisadas.csv')
            for c in ['PM25','PM1','PM10','CO']:labels.loc[labels.es_fallo==0,c]=500
            labels.to_csv(datos/'anomalias_revisadas.csv',index=False)
            meta=json.loads((datos/'manifiesto.json').read_text());meta['sha256']['anomalias_revisadas.csv']=hash_archivo(datos/'anomalias_revisadas.csv');escribir_json(datos/'manifiesto.json',meta)
            r=evaluar_dataset(datos,root/'registro','anomalias','PM25',0)
            self.assertEqual(r['estado'],'rechazado');self.assertIn('exceso_de_falsos_positivos',r['razones']);self.assertEqual(Registro(root/'registro').leer()['activos'],{})
