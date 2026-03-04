from sqlalchemy import Column, Integer, String
from passlib.context import CryptContext
from database import Base

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

class User(Base):
  __tablename__ = "users"

  id = Column(Integer, primary_key=True, index=True)
  first_name = Column(String, index=True)
  last_name = Column(String, index=True)
  email = Column(String, unique=True, index=True)
  password_hash = Column(String(255), nullable=False)

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)