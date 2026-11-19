"""Arranque con 48 horas y capturas físicas breves; solo datos temporales de prueba."""
import asyncio
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime,timezone,timedelta

import pandas as pd
from fastapi import FastAPI
from anomalias import CRITERIOS
from evaluacion import evaluar_dataset
from gobernanza import POLITICA,Registro,escribir_json,hash_archivo
from inferencia_registro import crear_router_registro
from test_gobernanza import dataset_prueba
from test_inferencia_registro import solicitar

POL={**POLITICA,'version':'arranque-prueba','arranque_demo':True,'pares_minimos':24,'dias_minimos':1,
     'anomalias':{**CRITERIOS,'muestras_entrenamiento':8,'dias_minimos':1}}


class ArranqueTests(unittest.TestCase):
    def test_pronosticos_48h_y_fuente_directa_sin_insertar_originales(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);d=dataset_prueba(root/'datos',n=48)
            meta=json.loads((d/'manifiesto.json').read_text())
            tabla=pd.read_csv(d/'horas.csv',index_col='medido_en')
            for c,m in [('PM1',.7),('PM10',1.4),('CO',10)]:tabla[c]=tabla.PM25*m
            tabla.to_csv(d/'historial_fuente.csv')
            tabla.to_csv(d/'horas.csv');(tabla*0+1).to_csv(d/'completitud.csv')
            meta['unidades']={c:'µg/m3' for c in tabla};meta['historial_fuente']=True
            meta['sensor'].update({'latitud':0,'longitud':0})
            meta['sha256']={p.name:hash_archivo(p) for p in d.iterdir() if p.name!='manifiesto.json'}
            escribir_json(d/'manifiesto.json',meta)
            reg=root/'registro';modelos=[]
            for h in (1,3,6):
                r=evaluar_dataset(d,reg,'pronostico','PM25',h,POL)
                self.assertEqual(r['estado'],'apto_demo',r)
                self.assertIn(r['tipo_pronostico'],('respaldo_persistencia','modelo_aprendido'));modelos.append(r)
            app=FastAPI();app.include_router(crear_router_registro(reg,lambda:'clave-solo-prueba'))
            fin=datetime.now(timezone.utc).replace(minute=0,second=0,microsecond=0);ini=fin-timedelta(hours=1)
            fake={'hourly':{'time':[int(ini.timestamp())],'pm2_5':[10],'pm10':[14],'carbon_monoxide':[100]},'hourly_units':{'pm2_5':'µg/m³','pm10':'µg/m³','carbon_monoxide':'µg/m³'}}
            body={'nodo_id':1,'sensor_id':1,'perfil':'contaminantes_simulados','proposito':'pronostico','variable':'PM25','horizonte_h':1,
                  'modelo_version':modelos[0]['version'],'periodo_inicio':ini.isoformat(),'periodo_fin':fin.isoformat()}
            with patch('referencias.descargar_referencia',return_value=(fake,{'fuente':'fuente-solo-prueba'})):
                code,res=asyncio.run(solicitar(app,'/api/v2/modelos/inferir-fuente',body))
            self.assertEqual(code,200,res);self.assertIsNotNone(res['valor']);self.assertEqual(res['entrada_fuente']['valores']['PM1'],7)
            self.assertFalse(res['calibracion_fisica_validada'])
            otra={**body,'periodo_inicio':(ini-timedelta(hours=1)).isoformat(),'periodo_fin':ini.isoformat()}
            with patch('referencias.descargar_referencia',side_effect=OSError('fuente de prueba caída')):
                self.assertEqual(asyncio.run(solicitar(app,'/api/v2/modelos/inferir-fuente',otra))[0],503)
            self.assertEqual(len(Registro(reg).leer()['activos']),3)
            self.assertEqual(asyncio.run(solicitar(app,'/api/v2/modelos/inferir-fuente',body,None))[0],401)
            code,_=asyncio.run(solicitar(app,'/api/v2/modelos/inferir-fuente',{**body,'periodo_inicio':ini.replace(tzinfo=None).isoformat()}))
            self.assertEqual(code,422)

    def test_detectores_fisicos_sin_etiquetas_no_inventan_precision(self):
        for perfil,columnas in [('dht11',{'TEMP':'°C','HUM':'%'}),('bme680',{'TEMP':'°C','HUM':'%','PRES':'hPa','GAS':'ohm'})]:
            with self.subTest(perfil=perfil),tempfile.TemporaryDirectory() as t:
                root=Path(t);d=root/'datos';d.mkdir()
                idx=pd.date_range('2026-01-01T00:00Z',periods=18,freq='min',name='medido_en')
                filas=[]
                for j,fecha in enumerate(idx):
                    for c in columnas:filas.append({'id_muestra':j,'codigo':c,'medido_en':fecha,'calidad':'valida','valor':{'TEMP':20,'HUM':50,'PRES':1010,'GAS':10000}[c]+j*.01})
                pd.DataFrame(filas).to_csv(d/'originales.csv',index=False)
                pd.DataFrame({c:[float('nan')] for c in columnas},index=pd.date_range(idx[0],periods=1,name='medido_en')).to_csv(d/'horas.csv')
                pd.DataFrame({c:[.3] for c in columnas},index=pd.date_range(idx[0],periods=1,name='medido_en')).to_csv(d/'completitud.csv')
                meta={'version_formato':1,'sensor':{'sensor_id':1,'nodo_id':1},'perfil':perfil,'unidades':columnas,'intervalo_s':60,'completitud_minima':.75,'sha256':{p.name:hash_archivo(p) for p in d.iterdir()}}
                escribir_json(d/'manifiesto.json',meta)
                r=evaluar_dataset(d,root/'registro','anomalias','TEMP',0,POL)
                self.assertEqual(r['estado'],'apto_demo',r);self.assertFalse(r['validacion_etiquetada']);self.assertIsNone(r['metricas']['precision'])
                app=FastAPI();app.include_router(crear_router_registro(root/'registro',lambda:'clave-solo-prueba'))
                body={'nodo_id':1,'sensor_id':1,'perfil':perfil,'valores':{c:{'TEMP':20.1,'HUM':50.1,'PRES':1010.1,'GAS':10000.1}[c] for c in columnas}}
                code,res=asyncio.run(solicitar(app,'/api/v2/modelos/muestra',body))
                self.assertEqual(code,200,res);self.assertIsInstance(res['es_anomalia'],bool)
