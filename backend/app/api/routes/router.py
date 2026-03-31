from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session
from backend.app.api.dependencies import get_db
from app.schemas.merchant import MerchantPageBase, MerchantResponse
from app.services.merchant_service import create_merchant
from app.services.email import send_email
from app.api.webhooks.clerk.upsert import handle_clerk_webhook

router = APIRouter()

@router.get("/send-email")
async def send_email_route():
    return send_email()

@router.post("/merchant/", response_model=MerchantResponse)
async def create_merchant_route(merchant: MerchantPageBase, db: Session = Depends(get_db)):
    return create_merchant(db, merchant)


@router.post("/webhooks/clerk")
async def clerk_webhook_route(request: Request, db: Session = Depends(get_db)):
    payload = await request.body()
    return handle_clerk_webhook(payload, dict(request.headers), db)


@router.post("/api/webhooks")
async def clerk_webhook_compat_route(request: Request, db: Session = Depends(get_db)):
    payload = await request.body()
    return handle_clerk_webhook(payload, dict(request.headers), db)

