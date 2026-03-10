from fastapi import APIRouter, Depends
from typing import Annotated
from sqlalchemy.orm import Session
from app.api.dependencies import get_db
from app.schemas.user import UserBase, UserResponse
from app.schemas.merchant import MerchantPageBase, MerchantResponse
from app.services.user_service import create_user
from app.services.merchant_service import create_merchant
from app.services.email import send_email

router = APIRouter()

db_dependency = Annotated[Session, Depends(get_db)]

@router.get("/send-email")
async def send_email_route():
    return send_email()

@router.post("/users/", response_model=UserResponse)
async def create_user_route(user: UserBase, db: db_dependency):
    return create_user(db, user)

@router.post("/merchant/", response_model=MerchantResponse)
async def create_merchant_route(merchant: MerchantPageBase, db: db_dependency):
    return create_merchant(db, merchant)

