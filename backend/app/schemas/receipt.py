"""A buyer's receipt for one paid order (CF-0049, B09)."""

from datetime import date, datetime

from pydantic import BaseModel


class ReceiptLine(BaseModel):
    name: str
    unit: str | None = None
    quantity: int
    unit_price: int  # pesos
    line_total: int  # pesos


class ReceiptResponse(BaseModel):
    receipt_number: str  # the order reference, e.g. CB-2026-0042
    # Shown as the receipt's heading note. Set for a farm that declared itself
    # a small agricultural producer (BIR RR No. 12-2023), which issues no
    # invoices: "Acknowledgement receipt — not a BIR invoice".
    document_label: str | None = None
    order_id: int
    order_status: str
    ordered_at: datetime | None = None
    paid_at: datetime | None = None
    # "paid", "refund_pending" or "refunded": the receipt stays available
    # after a refund, and says so.
    payment_status: str
    payment_reference: str | None = None

    buyer_name: str | None = None
    farm_name: str | None = None
    farm_town: str | None = None  # city, province: no street (CF-0048)
    farm_contact_number: str | None = None

    delivery_address: str | None = None
    requested_delivery_date: date | None = None
    delivery_window: str | None = None

    lines: list[ReceiptLine]
    subtotal: int
    delivery_fee: int
    # CF-0058: farm voucher, 0 / None when none was used.
    discount: int = 0
    voucher_code: str | None = None
    total: int
