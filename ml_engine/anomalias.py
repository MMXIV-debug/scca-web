"""Evaluación específica de anomalías: etiquetas humanas, nunca RMSE.

Los criterios son provisionales de demostración, no una validación independiente.
"""
from pathlib import Path
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from datasets import instante_utc
from gobernanza import hash_archivo

CRITERIOS={'version':'anomalias-demo-1','muestras_entrenamiento':200,'dias_minimos':7,
           'normales_prueba':50,'fallos_prueba':20,'precision_minima':.90,
           'recall_minimo':.90,'fpr_maxima':.05}


def metricas_clasificacion(real,predicho):
    real,predicho=np.asarray(real),np.asarray(predicho)
    if real.shape!=predicho.shape or not real.size or not set(real).issubset({0,1}) or not set(predicho).issubset({0,1}):
        raise ValueError('Etiquetas de clasificación inválidas.')
    tp=int(((real==1)&(predicho==1)).sum());fp=int(((real==0)&(predicho==1)).sum())
    tn=int(((real==0)&(predicho==0)).sum());fn=int(((real==1)&(predicho==0)).sum())
    return {'n':len(real),'tp':tp,'fp':fp,'tn':tn,'fn':fn,
        'precision':tp/(tp+fp) if tp+fp else 0.0,'recall':tp/(tp+fn) if tp+fn else 0.0,
        'fpr':fp/(fp+tn) if fp+tn else 1.0}


def evaluar_anomalias(carpeta,meta,politica,informe,registro,estado,terminar):
    criterios={**CRITERIOS,**politica.get('anomalias',{})}
    if politica.get('arranque_demo'):
        return evaluar_arranque(carpeta,meta,criterios,informe,registro,estado,terminar)
    if any(not isinstance(criterios[k],int) or criterios[k]<minimo for k,minimo in [('muestras_entrenamiento',50),('dias_minimos',1),('normales_prueba',10),('fallos_prueba',10)]) or not .5<=criterios['precision_minima']<=1 or not .5<=criterios['recall_minimo']<=1 or not 0<=criterios['fpr_maxima']<=.5:
        raise ValueError('Criterios de anomalías inválidos.')
    informe['criterios_anomalias']=criterios
    informe['entrada_agregado_s']=0
    if not {'originales.csv','anomalias_revisadas.csv'}.issubset(meta['sha256']):
        informe['razones']=['sin_etiquetas_y_politica_especifica_para_anomalias'];return terminar()
    labels=pd.read_csv(Path(carpeta)/'anomalias_revisadas.csv')
    if labels.empty:
        informe['razones']=['sin_etiquetas_humanas_para_anomalias'];return terminar()
    columnas=list(meta['unidades'])
    filas=pd.read_csv(Path(carpeta)/'originales.csv')
    filas=filas[filas.calidad=='valida']
    if filas.duplicated(['id_muestra','codigo']).any():
        raise ValueError('Originales con muestra/variable duplicada.')
    datos=filas.pivot(index=['medido_en','id_muestra'],columns='codigo',values='valor').reindex(columns=columnas).dropna().reset_index()
    datos['medido_en']=[instante_utc(t) for t in datos.medido_en]
    datos=datos.sort_values(['medido_en','id_muestra']).drop_duplicates('medido_en').set_index('medido_en')
    if len(datos)<criterios['muestras_entrenamiento'] or (datos.index[-1]-datos.index[0]).total_seconds()<criterios['dias_minimos']*86400:
        informe['razones']=['historial_insuficiente_para_anomalias'];return terminar()
    corte=datos.index[int(len(datos)*(1-politica['fraccion_prueba']))]
    entrenamiento=datos[datos.index<corte]
    labels['medido_en']=[instante_utc(t) for t in labels.medido_en]
    if not set(labels.es_fallo).issubset({0,1}):raise ValueError('Etiqueta humana inválida.')
    if labels.groupby('medido_en').es_fallo.nunique().max()>1:raise ValueError('Etiquetas incompatibles en el mismo instante.')
    labels=labels.drop_duplicates(['medido_en',*columnas,'es_fallo'])
    prueba=labels[labels.medido_en>=corte].sort_values('medido_en')
    normales=int((prueba.es_fallo==0).sum());fallos=int((prueba.es_fallo==1).sum())
    informe['etiquetas']={'normales_prueba':normales,'fallos_prueba':fallos}
    if len(entrenamiento)<criterios['muestras_entrenamiento'] or normales<criterios['normales_prueba'] or fallos<criterios['fallos_prueba']:
        informe['razones']=['etiquetas_o_entrenamiento_insuficientes_para_anomalias'];return terminar()
    if not np.isfinite(entrenamiento[columnas].to_numpy(dtype=float)).all() or not np.isfinite(prueba[columnas].to_numpy(dtype=float)).all():
        raise ValueError('Variables no finitas en anomalías.')
    inicio,fin=prueba.medido_en.iloc[0].isoformat(),prueba.medido_en.iloc[-1].isoformat()
    if estado['pruebas_consumidas'].get(informe['clave'],'')>=inicio:
        informe['razones']=['prueba_final_consumida_se_requiere_periodo_posterior'];return terminar()
    modelo=IsolationForest(n_estimators=100,contamination='auto',random_state=42,n_jobs=1)
    modelo.fit(entrenamiento[columnas])
    informe.update({'variables_entrada':columnas,'algoritmo':'isolation_forest','parametros':modelo.get_params(),
        'dominio':{c:[float(entrenamiento[c].min()),float(entrenamiento[c].max())] for c in columnas},
        'vigente_comparado':estado['activos'].get(informe['clave']),
        'particiones':{'entrenamiento':{'n':len(entrenamiento),'inicio':entrenamiento.index[0].isoformat(),'fin':entrenamiento.index[-1].isoformat()},
                      'prueba_final':{'n':len(prueba),'inicio':inicio,'fin':fin}}})
    registro.reservar_prueba(estado,informe['clave'],inicio,fin,informe['version'])
    try:
        nueva=metricas_clasificacion(prueba.es_fallo,(modelo.predict(prueba[columnas])==-1).astype(int))
        razones=[];vigente=None
        if nueva['precision']<criterios['precision_minima']:razones.append('precision_de_fallos_insuficiente')
        if nueva['recall']<criterios['recall_minimo']:razones.append('deteccion_de_fallos_insuficiente')
        if nueva['fpr']>criterios['fpr_maxima']:razones.append('exceso_de_falsos_positivos')
        if informe['vigente_comparado']:
            entrada=estado['modelos'][informe['vigente_comparado']]
            anterior=joblib.load(registro.artefacto(entrada))
            if list(anterior.feature_names_in_)!=columnas:raise ValueError('Contrato del detector vigente incompatible.')
            vigente=metricas_clasificacion(prueba.es_fallo,(anterior.predict(prueba[columnas])==-1).astype(int))
            if nueva['precision']<vigente['precision'] or nueva['recall']<vigente['recall'] or nueva['fpr']>vigente['fpr']:
                razones.append('detector_empeora_frente_al_vigente')
        informe.update({'estado':'rechazado' if razones else 'apto_demo','razones':razones,'metricas':{'clasificacion':nueva,'vigente':vigente}})
        artefacto=registro.raiz/'versiones'/informe['version']/'modelo.joblib';joblib.dump(modelo,artefacto)
        informe.update({'artefacto':artefacto.relative_to(registro.raiz).as_posix(),'sha256':hash_archivo(artefacto)})
    except Exception as e:
        informe.update({'estado':'error','razones':[type(e).__name__],'prueba_consumida':True});terminar();raise
    return terminar()


def evaluar_arranque(carpeta,meta,criterios,informe,registro,estado,terminar):
    columnas=list(meta['unidades'])
    if meta.get('historial_fuente'):
        datos=pd.read_csv(Path(carpeta)/'historial_fuente.csv',index_col='medido_en')[columnas].dropna()
        procedencia='historial modelado Open-Meteo/CAMS; PM1 estimado'
    else:
        filas=pd.read_csv(Path(carpeta)/'originales.csv')
        filas=filas[filas.calidad=='valida']
        if filas.duplicated(['id_muestra','codigo']).any():raise ValueError('Muestra duplicada.')
        datos=filas.pivot(index=['medido_en','id_muestra'],columns='codigo',values='valor').reindex(columns=columnas).dropna().reset_index().drop_duplicates('medido_en').set_index('medido_en')[columnas]
        procedencia='originales completos del sensor'
    datos.index=pd.DatetimeIndex([instante_utc(t) for t in datos.index])
    datos=datos.sort_index()
    informe.update({'entrada_agregado_s':0,'criterios_anomalias':criterios,'modo_evaluacion':'arranque_no_supervisado',
                    'validacion_etiquetada':False,'interpretacion':'lectura inusual; no confirma fallo del sensor',
                    'procedencia_entrenamiento':procedencia,'pares':len(datos)})
    minimo=max(8,int(criterios['muestras_entrenamiento']))
    if len(datos)<minimo:
        informe['razones']=['muestras_insuficientes_arranque'];return terminar()
    if not np.isfinite(datos.to_numpy(dtype=float)).all():raise ValueError('Datos no finitos.')
    informe['entrenamiento_sha256']=hash_archivo(Path(carpeta)/('historial_fuente.csv' if meta.get('historial_fuente') else 'originales.csv'))
    previo=estado['modelos'].get(estado['activos'].get(informe['clave']),{})
    if previo.get('entrenamiento_sha256')==informe['entrenamiento_sha256']:
        informe['razones']=['sin_datos_nuevos'];return terminar()
    modelo=IsolationForest(n_estimators=100,contamination='auto',random_state=42,n_jobs=1).fit(datos)
    pred=modelo.predict(datos)
    informe.update({'estado':'apto_demo','razones':['arranque_sin_validacion_etiquetada'],
        'variables_entrada':columnas,'algoritmo':'isolation_forest','parametros':modelo.get_params(),
        'dominio':{c:[float(datos[c].min()),float(datos[c].max())] for c in columnas},
        'vigente_comparado':estado['activos'].get(informe['clave']),
        'metricas':{'ajuste':{'n':len(datos),'inusuales':int((pred==-1).sum())},'precision':None,'recall':None},
        'particiones':{'ajuste_no_supervisado':{'n':len(datos),'inicio':datos.index[0].isoformat(),'fin':datos.index[-1].isoformat()}}})
    artefacto=registro.raiz/'versiones'/informe['version']/'modelo.joblib';joblib.dump(modelo,artefacto)
    informe.update({'artefacto':artefacto.relative_to(registro.raiz).as_posix(),'sha256':hash_archivo(artefacto)})
    return terminar()
