import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.models.transaction import Transaction
from app.services.order_reservations import settle_checkout_payment
from app.services.paymongo import (
    get_webhook_secret,
    is_test_mode,
    verify_webhook_signature,
)
from app.services.payout_service import handle_transfer_event
from app.services.sms_service import notify_merchant_new_order

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


@router.post("/paymongo")
async def paymongo_webhook(request: Request, db: Session = Depends(get_db)):
    raw_body = await request.body()
    signature = request.headers.get("Paymongo-Signature", "")

    if not get_webhook_secret():
        raise HTTPException(status_code=500, detail="Webhook secret is not configured")
    if not signature:
        raise HTTPException(status_code=400, detail="Missing webhook signature")
    if not verify_webhook_signature(raw_body, signature):
        # Say why without logging secrets: which mode we check and which
        # signature parts PayMongo actually filled in.
        filled = sorted(
            key.strip()
            for key, _, value in (p.partition("=") for p in signature.split(","))
            if value.strip()
        )
        logger.warning(
            "PayMongo webhook rejected: bad signature"
            " (checking %s mode, header has %s). Is PAYMONGO_WEBHOOK_SECRET"
            " the secret of the webhook registered with this mode's keys?",
            "test (te)" if is_test_mode() else "live (li)",
            filled,
        )
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    try:
        payload = await request.json()
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid JSON payload") from e

    event_type = payload.get("data", {}).get("attributes", {}).get("type", "")

    logger.info("PayMongo webhook received: %s", event_type)

    if event_type == "checkout_session.payment.paid":
        # Async only to read the raw body; database work must stay off the loop.
        await run_in_threadpool(_handle_checkout_paid, payload, db)
    elif event_type in ("transfer.outward.successful", "transfer.outward.failed"):
        await run_in_threadpool(_handle_transfer, event_type, payload, db)
    else:
        logger.debug("Unhandled PayMongo event: %s", event_type)

    return {"received": True}


def _handle_transfer(event_type: str, payload: dict, db: Session) -> None:
    """A payout transfer settled. The transfer is the event's ``data``."""
    attributes = (payload.get("data") or {}).get("attributes") or {}
    resource = attributes.get("data")
    if not isinstance(resource, dict):
        logger.error("Malformed %s payload: no transfer data", event_type)
        return
    handle_transfer_event(db, event_type, resource)


def _handle_checkout_paid(payload: dict, db: Session) -> None:
    """
    PayMongo event payload shape:
    {
      "data": {
        "attributes": {
          "type": "checkout_session.payment.paid",
          "data": {
            "id": "cs_xxx",
            "attributes": {
              "payments": [{"id": "pay_xxx", ...}],
              "status": "paid"
            }
          }
        }
      }
    }
    """
    try:
        session_obj = payload["data"]["attributes"]["data"]
        session_id = session_obj["id"]
        payments = session_obj["attributes"].get("payments", [])
        payment_id = payments[0]["id"] if payments else None
    except (KeyError, IndexError, TypeError) as e:
        logger.error("Malformed checkout_session.payment.paid payload: %s", e)
        return

    txn = (
        db.query(Transaction)
        .filter(Transaction.paymongo_session_id == session_id)
        .first()
    )

    if not txn:
        logger.warning("No transaction found for session %s", session_id)
        return

    outcome = settle_checkout_payment(txn, payment_id, db)
    if outcome == "duplicate":
        return
    db.commit()

    if outcome == "refund":
        logger.warning(
            "Payment %s for closed transaction %s / order %s flagged for refund",
            payment_id,
            txn.id,
            txn.order_id,
        )
    else:
        logger.info(
            "Transaction %s marked paid, order %s -> processing", txn.id, txn.order_id
        )
        if txn.order is not None:
            notify_merchant_new_order(order=txn.order)
