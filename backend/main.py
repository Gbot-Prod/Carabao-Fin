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
from app.services.order_reservations import (
    expire_stale_reservations,
    reservation_ttl_minutes,
)
from app.services.order_status import auto_confirm_days, auto_confirm_delivered_orders

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(_: FastAPI):
    def release_expired_reservations() -> None:
        # Each API worker runs this sweep. Row locks prevent double releases.
        db = SessionLocal()
        try:
            released = expire_stale_reservations(db, reservation_ttl_minutes())
            db.commit()
            if released:
                logger.info("Released %s expired checkout reservation(s)", released)
        except Exception:
            db.rollback()
            logger.exception("Could not release expired checkout reservations")
        finally:
            db.close()

    def confirm_unconfirmed_deliveries() -> None:
        db = SessionLocal()
        try:
            confirmed = auto_confirm_delivered_orders(db, auto_confirm_days())
            db.commit()
            if confirmed:
                logger.info("Auto-confirmed %s delivered order(s)", confirmed)
        except Exception:
            db.rollback()
            logger.exception("Could not auto-confirm delivered orders")
        finally:
            db.close()

    async def reservation_cleanup_loop() -> None:
        while True:
            # DB and PayMongo calls block, so keep them off the event loop.
            await asyncio.to_thread(release_expired_reservations)
            await asyncio.to_thread(confirm_unconfirmed_deliveries)
            await asyncio.sleep(60)

    cleanup_task = asyncio.create_task(reservation_cleanup_loop())
    yield
    cleanup_task.cancel()
    with suppress(asyncio.CancelledError):
        await cleanup_task


app = FastAPI(lifespan=lifespan)


# Registered as middleware (before CORSMiddleware, so it sits inside it) rather
# than an Exception handler: Starlette runs those outside CORS, which strips the
# CORS headers and makes every 500 look like a CORS error in the browser.
@app.middleware("http")
async def unhandled_exception_middleware(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception as exc:
        logger.error(
            "Unhandled exception on %s %s: %s\n%s",
            request.method,
            request.url.path,
            exc,
            traceback.format_exc(),
        )
        return JSONResponse(
            status_code=500, content={"detail": "Internal server error"}
        )


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
