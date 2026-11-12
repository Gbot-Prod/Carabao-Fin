"""Buyer produce search with filters, sorting and pagination (U2)."""

from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, joinedload

from app.api.dependencies import get_db
from app.models.merchant import Merchant
from app.models.produce import Produce
from app.models.search_log import SearchLog
from app.schemas.pagination import Page
from app.schemas.produce import ProduceResponse
from app.services.account_suspension import merchant_is_public
from app.services.produce_freshness import is_listed, ph_today

router = APIRouter(tags=["produce"])
logger = logging.getLogger(__name__)

SortKey = Literal["relevance", "price_asc", "price_desc", "newest", "freshest"]


class ProduceSearchResult(ProduceResponse):
    merchant_name: str
    merchant_province: str | None = None
    merchant_city: str | None = None


def _like(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


@router.get("/produce/search", response_model=Page[ProduceSearchResult])
def search_produce(
    q: str | None = Query(None, max_length=100),
    category: str | None = Query(None, max_length=50),
    province: str | None = Query(None, max_length=100),
    min_price: int | None = Query(None, ge=0),
    max_price: int | None = Query(None, ge=0),
    in_stock: bool = False,
    fresh: bool = False,
    sort: SortKey = "relevance",
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=60),
    db: Session = Depends(get_db),
):
    """Listings buyers can order: public merchants, not hidden, not expired.

    ``fresh`` additionally requires a best-before date (undated listings are left
    out); ``in_stock`` requires stock above zero.
    """
    today = ph_today()
    query = (
        db.query(Produce)
        .join(Merchant, Merchant.id == Produce.merchant_id)
        .filter(merchant_is_public(), is_listed(today))
    )
    text = (q or "").strip()
    if text:
        pattern = _like(text)
        query = query.filter(
            or_(
                Produce.name.ilike(pattern, escape="\\"),
                Produce.category.ilike(pattern, escape="\\"),
                Merchant.merchant_name.ilike(pattern, escape="\\"),
            )
        )
    if category:
        query = query.filter(func.lower(Produce.category) == category.strip().lower())
    if province:
        query = query.filter(func.lower(Merchant.province) == province.strip().lower())
    if min_price is not None:
        query = query.filter(Produce.price >= min_price)
    if max_price is not None:
        query = query.filter(Produce.price <= max_price)
    if in_stock:
        query = query.filter(Produce.stock_quantity > 0)
    if fresh:
        query = query.filter(
            Produce.best_before.isnot(None), Produce.best_before >= today
        )

    if sort == "price_asc":
        order = [Produce.price.asc(), Produce.id.asc()]
    elif sort == "price_desc":
        order = [Produce.price.desc(), Produce.id.asc()]
    elif sort == "freshest":
        order = [Produce.harvest_date.desc().nulls_last(), Produce.id.desc()]
    elif sort == "newest":
        order = [Produce.id.desc()]
    else:  # relevance: name matches first, then in stock, then newest
        order = []
        if text:
            order.append(Produce.name.ilike(_like(text), escape="\\").desc())
        order += [(Produce.stock_quantity > 0).desc(), Produce.id.desc()]

    total = query.count()
    rows = (
        query.options(joinedload(Produce.merchant))
        .order_by(*order)
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    if text and page == 1:
        _log_search(db, text, province, total)

    items = [
        ProduceSearchResult(
            **ProduceResponse.model_validate(p).model_dump(),
            merchant_name=p.merchant.merchant_name,
            merchant_province=p.merchant.province,
            merchant_city=p.merchant.city,
        )
        for p in rows
    ]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def _log_search(db: Session, text: str, province: str | None, total: int) -> None:
    """Best effort: a failed log write never fails the search."""
    try:
        with db.begin_nested():
            db.add(
                SearchLog(
                    query=text.lower()[:100],
                    province=(province or "").strip() or None,
                    result_count=total,
                )
            )
        db.commit()
    except SQLAlchemyError as exc:
        logger.warning("[search] Could not log search: %s", exc)
        db.rollback()
