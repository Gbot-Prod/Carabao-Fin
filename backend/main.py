import asyncio
import logging
import os
import traceback
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes.router import router
from app.core.database import SessionLocal
from app.services.order_reservations import expire_stale_reservations
from app.models import (  # noqa: F401
    cart,
    current_orders,
    merchant,
    merchant_application,
    merchant_payout,
    mobile_credential,
    order,
    order_history,
    payout_batch,
    produce,
    shipment,
    shopPage,
    transaction,
    user,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(_: FastAPI):
    async def release_expired_reservations() -> None:
        # Each API worker runs this sweep. Row locks prevent double releases.
        db = SessionLocal()
        try:
            ttl = int(os.getenv("ORDER_RESERVATION_TTL_MINUTES", "30"))
            released = expire_stale_reservations(db, ttl)
            db.commit()
            if released:
                logger.info("Released %s expired checkout reservation(s)", released)
        except Exception:
            db.rollback()
            logger.exception("Could not release expired checkout reservations")
        finally:
            db.close()

    async def reservation_cleanup_loop() -> None:
        while True:
            await release_expired_reservations()
            await asyncio.sleep(60)

    cleanup_task = asyncio.create_task(reservation_cleanup_loop())
    yield
    cleanup_task.cancel()
    with suppress(asyncio.CancelledError):
        await cleanup_task


app = FastAPI(lifespan=lifespan)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.error(
        "Unhandled exception on %s %s: %s\n%s",
        request.method,
        request.url.path,
        exc,
        traceback.format_exc(),
    )
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000")
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]
_is_dev = os.getenv("APP_ENV", "development").lower() != "production"
if _is_dev:
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

app.include_router(router)
