from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

COMMENT_MAX_LENGTH = 2000


def _clean_comment(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


class ReviewCreate(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=COMMENT_MAX_LENGTH)

    _clean = field_validator("comment")(_clean_comment)


class ReviewUpdate(BaseModel):
    rating: int | None = Field(default=None, ge=1, le=5)
    comment: str | None = Field(default=None, max_length=COMMENT_MAX_LENGTH)

    _clean = field_validator("comment")(_clean_comment)


class PublicReviewResponse(BaseModel):
    """A review as anyone browsing the shop sees it: no order linkage."""

    id: int
    merchant_id: int
    rating: int
    comment: str | None = None
    reviewer_name: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ReviewResponse(PublicReviewResponse):
    """A review as its buyer or the reviewed merchant sees it."""

    order_id: int | None = None
    editable_until: datetime | None = None


class MerchantReviewsResponse(BaseModel):
    merchant_id: int
    rating: float | None = None
    rating_count: int = 0
    reviews: list[PublicReviewResponse]
    limit: int
    offset: int


class MyMerchantReviewsResponse(BaseModel):
    """The merchant's own reviews, with the summary the dashboard shows.

    ``rating_breakdown`` and ``with_comment_count`` cover every review;
    ``total`` is the number matching the filters, for pagination.
    """

    merchant_id: int
    rating: float | None = None
    rating_count: int = 0
    rating_breakdown: dict[int, int]
    with_comment_count: int = 0
    total: int = 0
    reviews: list[ReviewResponse]
    limit: int
    offset: int
