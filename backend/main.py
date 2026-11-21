import asyncio
import logging
import os
import traceback
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.api.routes.router import router
from app.core import field_crypto
from app.core.body_limit import BodySizeLimitMiddleware
from app.core.database import SessionLocal
from app.core.errors import (
    REQUEST_ID_HEADER,
    FieldErrors,
    field_errors_handler,
    request_id_from_header,
    reset_request_id,
    set_request_id,
    with_reference,
)
from app.core.security_headers import SecurityHeadersMiddleware
from app.models import (  # noqa: F401
    cart,
    merchant,
    merchant_application,
    merchant_payout,
    order,
    otp,
    payout_batch,
    produce,
    review,
    shipment,
    shopPage,
    transaction,
    user,
    user_address,
    voucher,
)
from app.services import otp as otp_service
from app.services import rate_limit, retention, setup_reminders
from app.services.chat import send_unread_merchant_sms
from app.services.order_reservations import (
    expire_stale_reservations,
    reservation_ttl_minutes,
)
from app.services.order_retention import (
    order_details_retention_days,
    purge_closed_order_details,
)
from app.services.order_status import (
    auto_confirm_days,
    auto_confirm_delivered_orders,
    cancel_unshipped_orders,
    unshipped_cancel_days,
)
from app.services.sms_service import notify_merchant_new_order

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def _check_field_encryption_keys() -> None:
    """CF-0021: stop the app at startup if the field encryption keys are bad."""
    sample: str | None = None
    db = SessionLocal()
    try:
        # Raw SQL, so the ORM does not decrypt (and fail) before we can report it.
        sample = db.execute(
            text(
                "SELECT tin FROM merchant_applications WHERE tin IS NOT NULL "
                "UNION ALL SELECT tin FROM merchants WHERE tin IS NOT NULL LIMIT 1"
            )
        ).scalar()
    except SQLAlchemyError:
        logger.warning(
            "Could not read a stored TIN; only the key format and round trip "
            "were checked",
            exc_info=True,
        )
    finally:
        db.close()
    field_crypto.check_keys(stored_sample=sample, purpose="tin")
    logger.info(
        "Field encryption keys OK%s", " (stored TIN decrypted)" if sample else ""
    )


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Raises FieldCryptoError, so uvicorn does not start with bad keys.
    await asyncio.to_thread(_check_field_encryption_keys)

    def release_expired_reservations() -> None:
        # Each API worker runs this sweep. Row locks prevent double releases.
        db = SessionLocal()
        try:
            paid_orders: list = []
            released = expire_stale_reservations(
                db, reservation_ttl_minutes(), paid_orders
            )
            db.commit()
            for paid_order in paid_orders:
                notify_merchant_new_order(order=paid_order)
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

    def cancel_orders_never_shipped() -> None:
        # CF-0045: paid orders still in processing after the window are cancelled.
        db = SessionLocal()
        try:
            cancelled = cancel_unshipped_orders(db, unshipped_cancel_days())
            db.commit()
            if cancelled:
                logger.info("Cancelled %s unshipped paid order(s)", cancelled)
        except Exception:
            db.rollback()
            logger.exception("Could not cancel unshipped paid orders")
        finally:
            db.close()

    def text_merchants_about_unread_chat() -> None:
        # CH1: a buyer message still unread after 15 minutes texts the farm once.
        db = SessionLocal()
        try:
            sent = send_unread_merchant_sms(db)
            db.commit()
            if sent:
                logger.info("Texted %s merchant(s) about unread chat", sent)
        except Exception:
            db.rollback()
            logger.exception("Could not send unread-chat texts")
        finally:
            db.close()

    def purge_expired_codes_and_limits() -> None:
        # CF-0016: OTPs past expiry and rate-limit hits older than every window.
        db = SessionLocal()
        try:
            codes = otp_service.purge_expired(db)
            hits = rate_limit.purge_expired(db)
            # CF-0056: old searches and old read notifications.
            searches, notes = retention.purge_old_rows(db)
            db.commit()
            if codes or hits or searches or notes:
                logger.info(
                    "Purged %s OTP code(s), %s rate-limit hit(s), %s search row(s), "
                    "%s read notification(s)",
                    codes,
                    hits,
                    searches,
                    notes,
                )
        except Exception:
            db.rollback()
            logger.exception("Could not purge OTP codes and rate-limit hits")
        finally:
            db.close()

    def purge_old_order_details() -> None:
        # CF-0044: chat, address, pin and notes go 14 days after an order closes.
        db = SessionLocal()
        try:
            purged = purge_closed_order_details(db, order_details_retention_days())
            db.commit()
            if purged:
                logger.info("Purged delivery details of %s closed order(s)", purged)
        except Exception:
            db.rollback()
            logger.exception("Could not purge closed order details")
        finally:
            db.close()

    def remind_unfinished_applications() -> None:
        # Submit later: "finish your business information" on days 1, 3, 7, 14.
        db = SessionLocal()
        try:
            sent = setup_reminders.send_due_reminders(db)
            if sent:
                logger.info("Sent %s setup reminder(s)", sent)
        except Exception:
            db.rollback()
            logger.exception("Could not send setup reminders")
        finally:
            db.close()

    async def reservation_cleanup_loop() -> None:
        while True:
            # DB and PayMongo calls block, so keep them off the event loop.
            await asyncio.to_thread(release_expired_reservations)
            await asyncio.to_thread(confirm_unconfirmed_deliveries)
            await asyncio.to_thread(cancel_orders_never_shipped)
            await asyncio.to_thread(text_merchants_about_unread_chat)
            await asyncio.to_thread(purge_expired_codes_and_limits)
            await asyncio.to_thread(purge_old_order_details)
            await asyncio.to_thread(remind_unfinished_applications)
            await asyncio.sleep(60)

    cleanup_task = asyncio.create_task(reservation_cleanup_loop())
    yield
    cleanup_task.cancel()
    with suppress(asyncio.CancelledError):
        await cleanup_task


# CF-0023: fail closed. Only an explicit dev value enables dev behavior; a
# missing, misspelled or unknown APP_ENV gives production behavior.
_DEV_ENVS = {"development", "local"}
_app_env = os.getenv("APP_ENV", "").strip().lower()
if not _app_env:
    logger.warning(
        "APP_ENV is not set: using production behavior (no API docs, no dev "
        "CORS origins). Set APP_ENV=development for local work."
    )
_is_dev = _app_env in _DEV_ENVS

# CF-0015: no interactive docs or schema in production (APP_ENV=production).
app = FastAPI(
    lifespan=lifespan,
    docs_url="/docs" if _is_dev else None,
    redoc_url="/redoc" if _is_dev else None,
    openapi_url="/openapi.json" if _is_dev else None,
)


# Registered as middleware (before CORSMiddleware, so it sits inside it) rather
# than an Exception handler: Starlette runs those outside CORS, which strips the
# CORS headers and makes every 500 look like a CORS error in the browser.
# CF-0013: every response carries X-Request-ID; server logs use the same ID.
@app.middleware("http")
async def request_id_and_errors_middleware(request: Request, call_next):
    request_id = request_id_from_header(request.headers.get(REQUEST_ID_HEADER))
    token = set_request_id(request_id)
    try:
        try:
            response = await call_next(request)
        except Exception as exc:
            logger.error(
                "[request_id=%s] Unhandled exception on %s %s: %s\n%s",
                request_id,
                request.method,
                request.url.path,
                exc,
                traceback.format_exc(),
            )
            response = JSONResponse(
                status_code=500,
                content={
                    "detail": with_reference("Internal server error", request_id),
                    "request_id": request_id,
                },
            )
        response.headers[REQUEST_ID_HEADER] = request_id
        return response
    finally:
        reset_request_id(token)


# CF-0022: added after the request-ID middleware and before CORS, so it sits
# outside the app but inside CORS (a 413 keeps its CORS headers).
app.add_middleware(BodySizeLimitMiddleware)

# CF-0068: security headers on every response, also the 413s and 500s above
# (it sits outside them and inside CORS).
app.add_middleware(SecurityHeadersMiddleware)


# Every web origin that calls the API with credentials: the buyer site, the
# merchant site and the admin site (documentation/manuals/SUBDOMAINS.md).
# No wildcards: with allow_credentials a "*" would let any site call as the user.
_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000")
_allowed_origins = []
for _o in (o.strip().rstrip("/") for o in _raw_origins.split(",")):
    if not _o:
        continue
    if "*" in _o:
        logger.error("ALLOWED_ORIGINS: ignored wildcard %r", _o)
        continue
    _allowed_origins.append(_o)
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
    # Lets the browser read the CSV export filename and the request ID (CF-0013).
    # Retry-After: the OTP pages resume their resend countdown from it.
    expose_headers=["Content-Disposition", "Retry-After", REQUEST_ID_HEADER],
)

# Per-field form errors (FieldErrors). HTTPException handlers run inside CORS.
app.add_exception_handler(FieldErrors, field_errors_handler)

app.include_router(router)
