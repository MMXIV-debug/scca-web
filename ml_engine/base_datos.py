import os
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

load_dotenv(Path(__file__).resolve().parent.parent / '.env')
if not os.getenv('DATABASE_URL'):
    raise RuntimeError('Configura DATABASE_URL en el entorno o .env del proyecto.')
DATABASE_URL = make_url(os.environ['DATABASE_URL'])
if DATABASE_URL.drivername in ('postgres', 'postgresql'):
    DATABASE_URL = DATABASE_URL.set(drivername='postgresql+psycopg2')

engine = create_engine(DATABASE_URL, connect_args={'connect_timeout': 10}, pool_pre_ping=True)
Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def obtener_conexion():
    return engine.connect()
