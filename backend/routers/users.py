from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Annotated

import models
from database import get_db
from schemas.user import UserCreate, UserResponse

router = APIRouter(prefix="/users", tags=["users"])

db_dependency = Annotated[Session, Depends(get_db)]


@router.post("/", response_model=UserResponse)
async def create_user(user: UserCreate, db: db_dependency):
    existing_user = db.query(models.User).filter(models.User.email == user.email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    db_user = models.User(
        first_name=user.firstName,
        last_name=user.lastName,
        email=user.email,
        password_hash=models.hash_password(user.password),
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user
