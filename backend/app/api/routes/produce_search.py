"""Buyer produce search with filters, sorting and pagination (U2)."""

from __future__ import annotations

import logging
from datetime import date
from typing import Any, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, joinedload

from app.api.dependencies import get_db, is_internal_request
from app.core.sql import ilike_contains
from app.models.merchant import Merchant
from app.models.produce import Produce
from app.models.search_log import SearchLog
from app.schemas.pagination import Page
from app.schemas.produce import ProduceResponse
from app.services import rate_limit, store_pause
from app.services.account_suspension import merchant_is_public
from app.services.produce_freshness import is_listed, ph_today

router = APIRouter(tags=["produce"])
logger = logging.getLogger(__name__)

SortKey = Literal["relevance", "price_asc", "price_desc", "newest", "freshest"]


class ProduceSearchResult(ProduceResponse):
    merchant_name: str
    merchant_province: str | None = None
    merchant_city: str | None = None
    # CF-0072 (B81): the farm's holiday mode, when it is on today.
    merchant_paused_until: date | None = None


@router.get("/produce/search", response_model=Page[ProduceSearchResult])
def search_produce(
    request: Request,
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
    # CF-0037: per client IP; public, and each search writes a search_log row.
    rate_limit.enforce_action(db, "produce_search", rate_limit.client_ip(request))
    today = ph_today()
    query = (
        db.query(Produce)
        .join(Merchant, Merchant.id == Produce.merchant_id)
        .filter(merchant_is_public(), is_listed(today))
    )
    text = (q or "").strip()
    if text:
        query = query.filter(
            or_(
                ilike_contains(Produce.name, text),
                ilike_contains(Produce.category, text),
                ilike_contains(Merchant.merchant_name, text),
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

    order: list[Any]
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
            order.append(ilike_contains(Produce.name, text).desc())
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
            merchant_paused_until=store_pause.paused_until(p.merchant, today),
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


# --- CF-0081 (B64): one listing and other farms selling the same produce ------

OTHER_FARMS_SHOWN = 10


class ListingFarm(BaseModel):
    id: int
    merchant_name: str
    province: str | None = None
    city: str | None = None
    rating: float | None = None
    rating_count: int = 0
    paused_until: date | None = None


class ListingDetail(BaseModel):
    listing: ProduceResponse
    farm: ListingFarm
    # Listings with the same name (case and spaces ignored) from other public
    # farms that buyers can order today, cheapest first.
    other_farms: list[ProduceSearchResult]


def _farm(merchant: Merchant, today: date) -> ListingFarm:
    return ListingFarm(
        id=cast(int, merchant.id),
        merchant_name=cast(str, merchant.merchant_name),
        province=cast(Any, merchant.province),
        city=cast(Any, merchant.city),
        rating=cast(Any, merchant.rating),
        rating_count=int(cast(Any, merchant.rating_count) or 0),
        paused_until=store_pause.paused_until(merchant, today),
    )


# Declared after /produce/search: Starlette would read "search" as an id.
@router.get("/produce/{produce_id}", response_model=ListingDetail)
def get_listing(
    produce_id: int,
    request: Request,
    db: Session = Depends(get_db),
) -> ListingDetail:
    """A listing buyers can order, with its farm and the same produce elsewhere.

    404 for a hidden or expired listing or a farm buyers may not see, the same
    as a missing one.
    """
    # Same per-IP limit as search: both are public reads of the catalogue.
    # CF-0084: not for our web server's own page renders (metadata, JSON-LD):
    # they all come from one IP, and a 429 there would mark the page missing.
    if not is_internal_request(request):
        rate_limit.enforce_action(
            db, "produce_search", rate_limit.client_ip(request)
        )
    today = ph_today()
    listed = (
        db.query(Produce)
        .join(Merchant, Merchant.id == Produce.merchant_id)
        .options(joinedload(Produce.merchant))
        .filter(merchant_is_public(), is_listed(today))  # type: ignore[no-untyped-call]
    )
    produce = listed.filter(Produce.id == produce_id).first()
    if produce is None:
        raise HTTPException(status_code=404, detail="Listing not found")

    name = (cast(str, produce.name) or "").strip().lower()
    others = (
        listed.filter(
            func.lower(func.trim(Produce.name)) == name,
            Produce.merchant_id != produce.merchant_id,
        )
        .order_by(Produce.price.asc(), Produce.id.asc())
        .limit(OTHER_FARMS_SHOWN)
        .all()
    )
    return ListingDetail(
        listing=ProduceResponse.model_validate(produce),
        farm=_farm(produce.merchant, today),
        other_farms=[
            ProduceSearchResult(
                **ProduceResponse.model_validate(p).model_dump(),
                merchant_name=p.merchant.merchant_name,
                merchant_province=p.merchant.province,
                merchant_city=p.merchant.city,
                merchant_paused_until=store_pause.paused_until(p.merchant, today),
            )
            for p in others
        ],
    )
