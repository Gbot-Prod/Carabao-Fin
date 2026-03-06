from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Annotated

from app.models import models
from database import SessionLocal, engine
from sqlalchemy.orm import Session

app = FastAPI()
models.Base.metadata.create_all(bind=engine)

class UserBase(BaseModel):
  first_name: str
  last_name: str
  phone_number: str
  email: str
  password_hash: str

def get_db():
  db = SessionLocal()
  try:
    yield db
  finally:
    db.close()

db_dependency = Annotated[Session, Depends(get_db)]

@app.post("/users/")
async def create_user(user: UserBase, db: db_dependency):
  db_user = models.User(
    first_name=user.first_name,
    last_name=user.last_name,
    phone_number=user.phone_number,
    email=user.email,
    password_hash=user.password_hash
  )
  db.add(db_user)
  db.commit()
  db.refresh(db_user)
  return db_user


