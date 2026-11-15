import os

from dotenv import load_dotenv
from sqlalchemy.orm import declarative_base, sessionmaker

from app.core.database_url import create_db_engine

load_dotenv()

URL_DATABASE = os.getenv("DATABASE_URL")
if not URL_DATABASE:
    raise RuntimeError("DATABASE_URL is not set.")

engine = create_db_engine(
    URL_DATABASE,
    pool_pre_ping=True,
    pool_recycle=300,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()
