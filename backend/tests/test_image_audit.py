"""CF-0057 (B31): report stored image URLs that are not in our R2 bucket."""

import pytest
from sqlalchemy.orm import Session

from app.models.merchant import Merchant
from app.models.produce import Produce
from app.models.shopPage import ShopPage
from app.models.user import User
from app.services.image_audit import OffsiteImage, find_offsite_images, is_own_url

R2 = "https://pub-abc.r2.dev"


def test_own_url_checks_the_path_boundary() -> None:
    assert is_own_url(f"{R2}/produce/1.webp", R2)
    assert is_own_url(f"{R2}/produce/1.webp", R2 + "/")
    assert not is_own_url("https://pub-abc.r2.dev.evil.example/x.png", R2)
    assert not is_own_url("http://pub-abc.r2.dev/x.png", R2)  # not https
    assert not is_own_url("https://tracker.example/p.gif", R2)
    assert not is_own_url(f"{R2}/x.png", "")


def test_report_lists_only_offsite_urls_and_changes_nothing(
    db: Session, merchant: Merchant
) -> None:
    ok = Produce(merchant_id=merchant.id, name="A", price=1, image_url=f"{R2}/a.webp")
    bad = Produce(
        merchant_id=merchant.id,
        name="B",
        price=1,
        image_url="https://tracker.example/p.gif",
    )
    empty = Produce(merchant_id=merchant.id, name="C", price=1, image_url="")
    db.add_all([ok, bad, empty])
    # The merchant fixture already has a published shop page (main).
    page = db.query(ShopPage).filter(ShopPage.merchant_id == merchant.id).one()
    page.banner_image_url = f"{R2}/banner.webp"  # type: ignore[assignment]
    page.logo_url = "http://old-host.example/logo.png"  # type: ignore[assignment]
    page_id = int(page.id)
    owner = db.get(User, merchant.user_id)
    assert owner is not None
    db.query(User).filter(User.id == owner.id).update(
        {"profile_picture_url": "data:image/png;base64,AAAA"}
    )
    db.commit()

    bad_id, owner_id = int(bad.id), int(owner.id)
    found = find_offsite_images(db, R2)

    assert found == [
        OffsiteImage("produces", bad_id, "image_url", "https://tracker.example/p.gif"),
        OffsiteImage("shop_pages", page_id, "logo_url", "http://old-host.example/logo.png"),
        OffsiteImage(
            "backend_users",
            owner_id,
            "profile_picture_url",
            "data:image/png;base64,AAAA",
        ),
    ]
    db.expire_all()
    assert db.get(Produce, bad.id).image_url == "https://tracker.example/p.gif"  # type: ignore[union-attr]


def test_report_needs_the_bucket_url(db: Session) -> None:
    with pytest.raises(ValueError):
        find_offsite_images(db, "  ")
