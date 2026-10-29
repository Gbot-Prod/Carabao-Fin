import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.models.transaction import Transaction
from app.services.order_reservations import settle_checkout_payment
from app.services.paymongo import get_webhook_secret, verify_webhook_signature

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
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    try:
        payload = await request.json()
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid JSON payload") from e

    event_type = payload.get("data", {}).get("attributes", {}).get("type", "")

    logger.info("PayMongo webhook received: %s", event_type)

    if event_type == "checkout_session.payment.paid":
        _handle_checkout_paid(payload, db)
    else:
        logger.debug("Unhandled PayMongo event: %s", event_type)

    return {"received": True}


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
