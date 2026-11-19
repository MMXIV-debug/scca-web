"""Prueba real del ciclo sobre PostgreSQL local; nunca consulta referencias remotas."""
import os
from pathlib import Path
import sys
import tempfile
from unittest.mock import patch

database=os.environ.get('SCCA_TEST_DATABASE','')
port=int(os.environ.get('SCCA_TEST_PORT','0'))
if not database.startswith('scca_test_') or port<1024:
    raise SystemExit('Base temporal local requerida.')
os.environ['DATABASE_URL']=f'postgresql://scca_test@127.0.0.1:{port}/{database}'
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ml_engine'))
from ciclo_automatico import ejecutar
with tempfile.TemporaryDirectory() as root, patch('preparar_datasets.descargar_referencia',side_effect=OSError('referencia no disponible en prueba')):
    resultado=ejecutar(root)
    assert resultado['estado']=='completado',resultado
    assert len(resultado['resultados'])==16,resultado
    assert all(r['estado']=='pendiente' for r in resultado['resultados'])
    assert not any(r['perfil']=='bme680' and r['proposito']=='pronostico' for r in resultado['resultados'])
    import json
    assert json.loads((Path(root)/'registro.json').read_text())['activos']=={}
    etiquetas=sum(json.loads(p.read_text())['etiquetas_humanas_compatibles'] for p in (Path(root)/'datasets').rglob('manifiesto.json'))
    assert etiquetas==1,etiquetas
print('OK: ciclo por perfiles, referencia caída, PM2.5 1/3/6, datos insuficientes y conservación del vigente.')
