import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

DATABASE_URL="postgresql+psycopg2://app_api:PRUEBA1@localhost:5432/sistema_calidad_aire"

engine = create_engine(DATABASE_URL)
Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def obtener_conexion():
    return engine.connect()