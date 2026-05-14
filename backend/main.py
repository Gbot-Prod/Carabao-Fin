import logging
import os
import traceback

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.core.database import engine
from app.core.database import Base
from app.core.migrations import run_migrations
from app.models import cart, current_orders, merchant, merchant_application, merchant_payout, mobile_credential, order, order_history, payout_batch, produce, shopPage, shipment, transaction, user  # noqa: F401
from app.api.routes.router import router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled exception on %s %s: %s\n%s", request.method, request.url.path, exc, traceback.format_exc())
    return JSONResponse(status_code=500, content={"detail": str(exc)})

_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000")
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]
for dev_origin in (
    "http://localhost:8081",
    "http://localhost:19006",
    "exp://localhost:8081",
    "exp://127.0.0.1:8081",
):
    if dev_origin not in _allowed_origins:
        _allowed_origins.append(dev_origin)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

run_migrations(engine)
Base.metadata.create_all(bind=engine)
app.include_router(router)
