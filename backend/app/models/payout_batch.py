# Typed columns (CF-0089): `Mapped[...]` lets mypy see a loaded row's value
# type (str, int) instead of `Column[...]`. Same DDL as the old `Column(...)`.
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.models.statuses import PayoutStatus, status_type


class PayoutBatch(Base):
    __tablename__ = "payout_batches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    merchant_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("merchants.id"), nullable=False, index=True
    )
    period_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    transaction_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    gross_amount: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )  # pesos
    status: Mapped[PayoutStatus] = mapped_column(
        status_type(PayoutStatus, "ck_payout_batches_status"),
        nullable=False,
        default=PayoutStatus.PENDING,
        index=True,
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    released_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # The PayMongo transfer. gross_amount is what the merchant earned; the
    # transfer fee comes out of it, so net_amount is what actually lands.
    transfer_fee: Mapped[int | None] = mapped_column(Integer, nullable=True)  # pesos
    net_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)  # pesos
    attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    # Our reference for the latest attempt; webhooks are matched on it too.
    paymongo_reference: Mapped[str | None] = mapped_column(
        String, nullable=True, unique=True, index=True
    )
    paymongo_transfer_id: Mapped[str | None] = mapped_column(
        String, nullable=True, unique=True, index=True
    )
    provider_reference: Mapped[str | None] = mapped_column(
        String, nullable=True
    )  # trace number on the rail
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Where the money goes, saved when the merchant requests the payout
    # (CF-0004): sending uses these, never the merchant's current payout
    # method, so a later edit can't redirect a requested payout. Only a
    # code-confirmed change of method moves a *failed* batch to the new one.
    destination_type: Mapped[str | None] = mapped_column(String, nullable=True)
    destination_bic: Mapped[str | None] = mapped_column(String, nullable=True)
    destination_institution: Mapped[str | None] = mapped_column(String, nullable=True)
    destination_name: Mapped[str | None] = mapped_column(String, nullable=True)
    destination_number: Mapped[str | None] = mapped_column(String, nullable=True)
    transfer_provider: Mapped[str | None] = mapped_column(
        String, nullable=True
    )  # instapay | pesonet
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    merchant = relationship("Merchant")
    items = relationship("PayoutBatchItem", back_populates="batch")


class PayoutBatchItem(Base):
    __tablename__ = "payout_batch_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    batch_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("payout_batches.id"), nullable=False, index=True
    )
    transaction_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("transactions.id"), nullable=False, unique=True
    )
    amount: Mapped[int] = mapped_column(
        Integer, nullable=False
    )  # merchant_amount from transaction

    batch = relationship("PayoutBatch", back_populates="items")
    transaction = relationship("Transaction", back_populates="payout_items")
