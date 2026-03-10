from sqlalchemy.orm import Session
from app.models.models import User
from app.schemas.user import UserBase

def create_user(db: Session, user: UserBase) -> User:
    db_user = User(**user.model_dump())
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user