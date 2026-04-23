from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.database import SessionLocal, engine
from app.core.database import Base
from app.models import cart, current_orders, merchant, merchant_application, merchant_payout, mobile_credential, order, order_history, payout_batch, produce, shopPage, transaction, user  # noqa: F401
from app.api.routes.router import router  # import your router

app = FastAPI()

import os as _os

_raw_origins = _os.getenv("ALLOWED_ORIGINS", "http://localhost:3000")
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Base.metadata.create_all(bind=engine)  # DB init stays here
app.include_router(router)             # register all routes

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
