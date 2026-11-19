"""Entrenamiento evaluado desde datasets; no sobrescribe modelos de la API."""
import argparse
import sys
from pathlib import Path
import os
import subprocess

# La tarea antigua puede resolver un Python global. Reusar el entorno del
# proyecto antes de importar pandas/sklearn; no requiere cambiar esa tarea.
if __name__ == '__main__':
    entorno = Path(__file__).resolve().parent.parent / '.venv'
    ejecutable = entorno / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    if Path(sys.prefix).resolve() != entorno.resolve() and ejecutable.exists():
        raise SystemExit(subprocess.call([str(ejecutable),str(Path(__file__).resolve()),*sys.argv[1:]],cwd=entorno.parent))
from evaluacion import evaluar_dataset
from gobernanza import Registro


def main():
    # Compatibilidad con la tarea de Windows instalada: entrenador.py sin
    # argumentos ejecuta el ciclo evaluado completo, nunca el entrenador legado.
    if len(sys.argv) == 1:
        from ciclo_automatico import ejecutar
        try:
            r = ejecutar()
            print(f'Ciclo: {r["estado"]}; candidatos evaluados: {len(r["resultados"])}. Se conserva todo modelo vigente no superado.')
            return 1 if r['errores'] else 0
        except Exception as e:
            print(f'Ciclo no completado ({type(e).__name__}). Revisa política, conexión y bloqueo local.',file=sys.stderr)
            return 1
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--registro', default=str(Path(__file__).resolve().parent / 'registro_modelos_demo'))
    comandos = parser.add_subparsers(dest='comando', required=True)
    evaluar = comandos.add_parser('evaluar')
    evaluar.add_argument('--dataset', required=True)
    evaluar.add_argument('--proposito', choices=['calibracion', 'pronostico', 'anomalias'], required=True)
    evaluar.add_argument('--variable', default='PM25')
    evaluar.add_argument('--horizonte', type=int, choices=[1, 3, 6], default=1)
    revertir = comandos.add_parser('revertir')
    revertir.add_argument('--clave', required=True)
    revertir.add_argument('--motivo', required=True)
    args = parser.parse_args()
    try:
        if args.comando == 'evaluar':
            resultado = evaluar_dataset(args.dataset, args.registro, args.proposito, args.variable, args.horizonte)
            print(f'Versión: {resultado["version"]}\nEstado: {resultado["estado"]}')
            print('Motivos: ' + ', '.join(resultado['razones']))
            print('Ámbito: demostración. Los modelos de la API no se modificaron.')
        else:
            anterior = Registro(args.registro).revertir(args.clave, args.motivo)
            print(f'Registro demo revertido a: {anterior or "sin modelo activo"}')
    except ValueError as error:
        parser.exit(2, f'Operación rechazada: {error}\n')
    except Exception as error:
        parser.exit(1, f'Operación fallida ({type(error).__name__}); revisar registro local.\n')


if __name__ == '__main__':
    raise SystemExit(main() or 0)
