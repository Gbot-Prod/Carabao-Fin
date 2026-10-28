import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

from app.core.database_url import normalize_database_url

load_dotenv()

URL_DATABASE = os.getenv("DATABASE_URL")
if not URL_DATABASE:
    raise RuntimeError("DATABASE_URL is not set.")

engine = create_engine(
    normalize_database_url(URL_DATABASE),
    pool_pre_ping=True,
    pool_recycle=300,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()
