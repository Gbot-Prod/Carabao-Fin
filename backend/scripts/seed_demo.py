"""Seed realistic demo data for the Carabao system demo.

What it creates (every seeded account uses an @demo.carabao.ph email):
  * 5 Luzon farms (Benguet, Nueva Ecija, Batangas, Laguna, Bulacan), each
    with a shop page and 4-5 listings, so the buyer side has something to browse
  * 1 "hub" merchant: the account you log in with during the demo. It gets
    listings plus N PROCESSING (paid) orders that are ready for
    POST /merchants/me/shipments, i.e. the ALNS route demo
  * Buyers at the real geocoded Quezon City addresses from
    scripts/data/metro_manila_osrm.json, with map pins (no geocoding needed)
  * ~30 days of DELIVERED orders, paid transactions and reviews so the admin
    dashboard and merchant sales charts have history
  * 1 merchant application in "submitted" state for the admin approval demo

Logging in: seeded rows have no BetterAuth account. To log in as the hub
merchant, sign up through the normal web flow with the --merchant-email
address and verify it. /auth/sync links the BetterAuth login to the existing
unclaimed row by email, so you get the seeded merchant with all its orders.
If --merchant-email already belongs to a real account with a merchant
profile, the orders are attached to that merchant instead.

Usage (from backend/):
  uv run python scripts/seed_demo.py --merchant-email you@example.com
  uv run python scripts/seed_demo.py --merchant-email you@example.com --wipe
  uv run python scripts/seed_demo.py --wipe-only

--wipe removes everything previously seeded (all @demo.carabao.ph users and
everything hanging off them, including their orders on the hub merchant) first.
The hub merchant itself and its listings are kept if it is your real account.
Run it against a local or staging DATABASE_URL before production.
"""

import argparse
import json
import random
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.database import SessionLocal  # noqa: E402
from app.models import (  # noqa: E402,F401
    cart,
    chat,
    farm_follow,
    invoice,
    merchant_payout,
    notification,
    payout_batch,
    receipt,
    reference_price,
    search_log,
    shipment,
)
from app.models.merchant import Merchant  # noqa: E402
from app.models.merchant_application import MerchantApplication  # noqa: E402
from app.models.order import Order  # noqa: E402
from app.models.order_history import OrderHistory  # noqa: E402
from app.models.produce import Produce  # noqa: E402
from app.models.review import Review  # noqa: E402
from app.models.shopPage import ShopPage  # noqa: E402
from app.models.statuses import OrderStatus, TransactionStatus  # noqa: E402
from app.models.transaction import Transaction  # noqa: E402
from app.models.user import User, normalize_email  # noqa: E402

DEMO_DOMAIN = "demo.carabao.ph"
PLATFORM_FEE_RATE = 0.02
RNG = random.Random(2026)
NOW = datetime.now(timezone.utc)
TODAY = date.today()

OSRM_DATA = BACKEND_ROOT / "scripts" / "data" / "metro_manila_osrm.json"

FARMS = [
    {
        "slug": "la-trinidad-highland",
        "name": "La Trinidad Highland Farms",
        "owner": ("Rosario", "Bayang"),
        "region": "CAR", "province": "Benguet", "city": "La Trinidad",
        "barangay": "Balili", "address": "Km 5, Halsema Highway", "postal": "2601",
        "pin": (16.4552, 120.5874),
        "about": "Family-run vegetable terraces in La Trinidad since 1987.",
        "produce": [
            ("Strawberries", "Fruits", 380, 40, "Sweet Benguet strawberries, picked at dawn."),
            ("Baguio Pechay", "Vegetables", 70, 120, "Crisp highland pechay."),
            ("Lettuce (Romaine)", "Vegetables", 140, 80, "Hydroponic romaine heads."),
            ("Carrots", "Vegetables", 95, 200, "Fresh-dug highland carrots."),
            ("Broccoli", "Vegetables", 160, 60, "Tight green crowns."),
        ],
    },
    {
        "slug": "munoz-rice-cooperative",
        "name": "Muñoz Rice Cooperative",
        "owner": ("Eduardo", "Pascual"),
        "region": "Central Luzon", "province": "Nueva Ecija", "city": "Science City of Muñoz",
        "barangay": "Bantug", "address": "Purok 3, Maharlika Highway", "postal": "3119",
        "pin": (15.7161, 120.9036),
        "about": "Cooperative of 40 rice farmers in the rice granary of the Philippines.",
        "produce": [
            ("Dinorado Rice", None, 68, 500, "Aromatic, soft-cooking dinorado."),
            ("Brown Rice", None, 75, 300, "Unpolished, high-fiber."),
            ("Red Onions", "Vegetables", 180, 150, "Nueva Ecija red onions."),
            ("Garlic (Native)", "Vegetables", 220, 80, "Small-clove native garlic."),
        ],
    },
    {
        "slug": "lipa-coffee-and-fruit",
        "name": "Lipa Coffee & Fruit Estate",
        "owner": ("Marites", "Villanueva"),
        "region": "CALABARZON", "province": "Batangas", "city": "Lipa City",
        "barangay": "San Celestino", "address": "Sitio Ilaya", "postal": "4217",
        "pin": (13.9411, 121.1622),
        "about": "Kapeng barako and tropical fruit from volcanic Lipa soil.",
        "produce": [
            ("Kapeng Barako (Beans)", None, 450, 60, "Medium-dark roast barako beans."),
            ("Pineapple (Queen)", "Fruits", 85, 90, "Sweet Queen pineapples, per piece."),
            ("Calamansi", "Fruits", 90, 120, "Juicy calamansi, per kg."),
            ("Saba Banana", "Fruits", 60, 200, "Cooking bananas, per kg."),
        ],
    },
    {
        "slug": "laguna-lakeshore-greens",
        "name": "Laguna Lakeshore Greens",
        "owner": ("Jun", "Dimaculangan"),
        "region": "CALABARZON", "province": "Laguna", "city": "Calauan",
        "barangay": "Dayap", "address": "National Road", "postal": "4012",
        "pin": (14.1489, 121.3152),
        "about": "Lowland vegetables and lake-raised tilapia.",
        "produce": [
            ("Kangkong", "Vegetables", 40, 150, "Water spinach, per bundle-kg."),
            ("Eggplant (Talong)", "Vegetables", 80, 120, "Long purple talong."),
            ("Tilapia (Live)", None, 150, 70, "Lake-raised, delivered on ice."),
            ("Tomatoes", "Vegetables", 90, 140, "Vine-ripened tomatoes."),
            ("Ampalaya", "Vegetables", 110, 60, "Bitter gourd, firm and green."),
        ],
    },
    {
        "slug": "bulacan-poultry-and-eggs",
        "name": "San Ildefonso Poultry & Eggs",
        "owner": ("Liza", "Cruz"),
        "region": "Central Luzon", "province": "Bulacan", "city": "San Ildefonso",
        "barangay": "Pinaod", "address": "Purok 1, Cagayan Valley Road", "postal": "3010",
        "pin": (15.0787, 120.9406),
        "about": "Free-range eggs and native chicken from Bulacan.",
        "produce": [
            ("Fresh Eggs (Large)", None, 260, 100, "Tray of 30 large eggs."),
            ("Native Chicken", None, 320, 40, "Free-range, dressed, per kg."),
            ("Duck Eggs (Itlog na Pula)", None, 15, 300, "Salted red eggs, per piece."),
            ("Sweet Corn", "Vegetables", 70, 120, "Yellow sweet corn, per kg."),
        ],
    },
]

HUB_PRODUCE = [
    ("Mixed Vegetable Box", "Vegetables", 450, 100, "Weekly box: pechay, carrots, tomatoes, eggplant."),
    ("Dinorado Rice (25 kg)", None, 1550, 80, "Sack of aromatic dinorado."),
    ("Red Onions", "Vegetables", 180, 200, "Per kg."),
    ("Fresh Eggs (Large)", None, 260, 120, "Tray of 30."),
    ("Calamansi", "Fruits", 90, 150, "Per kg."),
]

BUYER_NAMES = [
    ("Angela", "Reyes"), ("Mark", "Santos"), ("Bea", "Garcia"), ("Paolo", "Mendoza"),
    ("Kristine", "Aquino"), ("Josh", "Ramos"), ("Carla", "Bautista"), ("Miguel", "Torres"),
    ("Nicole", "Flores"), ("Rafael", "Navarro"), ("Trisha", "Castillo"), ("Enzo", "Delos Santos"),
    ("Hannah", "Lim"), ("Gabriel", "Tan"), ("Sofia", "Villareal"), ("Carlo", "Dizon"),
    ("Jasmine", "Ocampo"), ("Luis", "Salazar"), ("Pia", "Manalo"), ("Ken", "Uy"),
]

REVIEW_TEXT = [
    (5, "Super fresh, arrived on time. Will order again!"),
    (5, "Sulit! Better than the palengke."),
    (4, "Good quality, one item was slightly bruised."),
    (5, "Rider was polite and the produce was well packed."),
    (4, "Fresh, though delivery was a bit late."),
    (3, "Okay lang, smaller than expected."),
]

OPERATING_HOURS = "6:00 AM – 5:00 PM"
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
WINDOWS = ["08:00 – 10:00", "10:00 – 12:00", "13:00 – 15:00", "15:00 – 17:00"]


def demo_email(local: str) -> str:
    return f"{local}@{DEMO_DOMAIN}"


def phone(n: int) -> str:
    return f"+63917{n:07d}"


# --------------------------------------------------------------------------- wipe


def wipe(db, hub_email: str | None) -> None:
    demo_users = db.query(User).filter(User.email.ilike(f"%@{DEMO_DOMAIN}")).all()
    user_ids = [u.id for u in demo_users]
    merchant_ids = [
        m.id for m in db.query(Merchant).filter(Merchant.user_id.in_(user_ids)).all()
    ]

    order_q = db.query(Order).filter(
        (Order.user_id.in_(user_ids))
        | (Order.merchant_id.in_(merchant_ids))
    )
    order_ids = [o.id for o in order_q.all()]

    if order_ids:
        db.query(Review).filter(Review.order_id.in_(order_ids)).delete(synchronize_session=False)
        db.query(Transaction).filter(Transaction.order_id.in_(order_ids)).delete(
            synchronize_session=False
        )
    db.query(Review).filter(Review.merchant_id.in_(merchant_ids)).delete(
        synchronize_session=False
    )
    if order_ids:
        db.query(Order).filter(Order.id.in_(order_ids)).delete(synchronize_session=False)

    if merchant_ids:
        db.query(Produce).filter(Produce.merchant_id.in_(merchant_ids)).delete(
            synchronize_session=False
        )
        db.query(ShopPage).filter(ShopPage.merchant_id.in_(merchant_ids)).delete(
            synchronize_session=False
        )
    if user_ids:
        db.query(MerchantApplication).filter(
            MerchantApplication.user_id.in_(user_ids)
        ).delete(synchronize_session=False)
    if merchant_ids:
        db.query(Merchant).filter(Merchant.id.in_(merchant_ids)).delete(
            synchronize_session=False
        )
    for u in demo_users:
        db.delete(u)  # cascades cart / order_history
    db.commit()
    print(f"Wiped {len(demo_users)} demo users, {len(merchant_ids)} merchants, {len(order_ids)} orders.")


# --------------------------------------------------------------------------- builders


def make_user(db, email, first, last, idx, **extra) -> User:
    user = User(
        email=normalize_email(email),
        first_name=first,
        last_name=last,
        phone_number=phone(idx),
        notifications_preferences={},
        **extra,
    )
    db.add(user)
    db.flush()
    db.add(OrderHistory(user_id=user.id))
    db.flush()
    return user


def make_merchant(db, user, farm, idx) -> Merchant:
    prices = [p[2] for p in farm["produce"]]
    merchant = Merchant(
        user_id=user.id,
        merchant_name=farm["name"],
        contact_number=phone(500 + idx),
        contact_email=user.email,
        region=farm["region"],
        province=farm["province"],
        city=farm["city"],
        barangay=farm["barangay"],
        address=farm["address"],
        postal_code=farm["postal"],
        lat=farm["pin"][0],
        lng=farm["pin"][1],
        available_days=WEEKDAYS,
        operating_hours=OPERATING_HOURS,
        delivery_time=2,
        delivery_price=RNG.choice([80, 90, 100]),
        price_range_min=min(prices),
        price_range_max=max(prices),
        legal_business_name=farm["name"],
        business_type="Farm",
        rsbsa_number=f"03-49-{idx:02d}-{RNG.randint(100, 999)}-{RNG.randint(10000, 99999)}",
        rsbsa_document_path="demo/rsbsa-placeholder.pdf",
        rsbsa_document_original_name="rsbsa.pdf",
        rsbsa_document_content_type="application/pdf",
    )
    db.add(merchant)
    db.flush()
    db.add(
        ShopPage(
            merchant_id=merchant.id,
            title=farm["name"],
            slug=farm["slug"],
            description=farm["about"],
        )
    )
    return merchant


def make_produce(db, merchant, rows) -> list[Produce]:
    out = []
    for name, category, price, stock, desc in rows:
        p = Produce(
            merchant_id=merchant.id,
            name=name,
            description=desc,
            category=category,  # API allows only Vegetables/Fruits/None
            price=price,
            unit="kg",
            unit_quantity=1.0,
            stock_quantity=stock,
            harvest_date=TODAY - timedelta(days=RNG.randint(0, 3)),
            best_before=TODAY + timedelta(days=RNG.randint(7, 30)),
            min_order_qty=1,
            price_tiers=[{"min_qty": 10, "unit_price": int(price * 0.9)}] if price < 500 else [],
        )
        db.add(p)
        out.append(p)
    db.flush()
    return out


def order_items(merchant, produce_list, n_lines):
    items, subtotal = [], 0
    for p in RNG.sample(produce_list, k=min(n_lines, len(produce_list))):
        qty = RNG.randint(1, 5)
        items.append(
            {
                "produce_id": p.id,
                "name": p.name,
                "quantity": qty,
                "price": p.price,
                "unit": p.unit,
                "image_url": p.image_url,
                "merchant_id": merchant.id,
                "farm": merchant.merchant_name,
            }
        )
        subtotal += p.price * qty
    return items, subtotal


def make_order(db, buyer, merchant, produce_list, status, ordered_at, *, address=None, pin=None):
    items, subtotal = order_items(merchant, produce_list, RNG.randint(1, 3))
    fee = merchant.delivery_price or 0
    total = subtotal + fee
    order = Order(
        order_history_id=buyer.order_history.id,
        user_id=buyer.id,
        merchant_id=merchant.id,
        status=status,
        total_price=total,
        items=items,
        delivery_address=address or buyer.address,
        delivery_lat=(pin or (buyer.lat, buyer.lng))[0],
        delivery_lng=(pin or (buyer.lat, buyer.lng))[1],
        requested_delivery_date=(ordered_at + timedelta(days=1)).date(),
        delivery_window=RNG.choice(WINDOWS),
        notes="Please call upon arrival.",
        ordered_at=ordered_at,
        delivery_fee=fee,
    )
    if status == OrderStatus.DELIVERED:
        order.shipped_at = ordered_at + timedelta(hours=RNG.randint(4, 20))
        order.delivered_at = order.shipped_at + timedelta(hours=RNG.randint(1, 4))
        order.delivery_confirmed_by = "buyer"
    db.add(order)
    db.flush()

    platform_fee = round(total * PLATFORM_FEE_RATE)
    db.add(
        Transaction(
            order_id=order.id,
            merchant_id=merchant.id,
            user_id=buyer.id,
            amount=total,
            platform_fee=platform_fee,
            merchant_amount=total - platform_fee,
            status=TransactionStatus.PAID,
            description=f"Carabao order #{order.id}",
            created_at=ordered_at,
            paid_at=ordered_at + timedelta(minutes=2),
        )
    )
    buyer.order_history.last_order_at = ordered_at
    return order


# --------------------------------------------------------------------------- seed


def resolve_hub(db, email: str, hub_point, hub_name) -> tuple[Merchant, bool]:
    """Existing merchant for this email, or a fresh seeded one at the hub."""
    email = normalize_email(email)
    user = db.query(User).filter(User.email == email).first()
    if user and user.merchant and user.merchant.deleted_at is None:
        m = user.merchant
        if m.lat is None:
            m.lat, m.lng = hub_point
        print(f"Using existing merchant #{m.id} '{m.merchant_name}' for {email}.")
        return m, False
    if user is None:
        user = make_user(db, email, "Demo", "Merchant", 999)
    farm = {
        "slug": "carabao-cubao-hub",
        "name": "Carabao Farmers Hub – Cubao",
        "region": "NCR", "province": "Metro Manila", "city": "Quezon City",
        "barangay": "Socorro", "address": hub_name, "postal": "1109",
        "pin": hub_point,
        "about": "Consolidation hub for Luzon farms, delivering across Quezon City.",
        "produce": HUB_PRODUCE,
    }
    m = make_merchant(db, user, farm, 99)
    print(f"Created hub merchant #{m.id} for {email} (sign up with this email to log in).")
    return m, True


def seed(db, hub_email: str, n_ready: int, n_history: int) -> None:
    osrm = json.loads(OSRM_DATA.read_text())["north"]
    hub_name, hub_point = osrm["names"][0], tuple(osrm["points"][0])
    customers = list(zip(osrm["names"][1:], map(tuple, osrm["points"][1:])))

    # Farms
    farms = []
    for i, farm in enumerate(FARMS, start=1):
        first, last = farm["owner"]
        u = make_user(db, demo_email(farm["slug"]), first, last, 100 + i,
                      region=farm["region"], province=farm["province"], city=farm["city"])
        m = make_merchant(db, u, farm, i)
        farms.append((m, make_produce(db, m, farm["produce"])))

    # Hub merchant (the demo login)
    hub, created = resolve_hub(db, hub_email, hub_point, hub_name)
    hub_produce = [p for p in hub.produces if p.hidden_at is None and p.stock_quantity > 0]
    if len(hub_produce) < 3:
        hub_produce += make_produce(db, hub, HUB_PRODUCE)

    # Buyers at real geocoded QC addresses
    buyers = []
    for i, (first, last) in enumerate(BUYER_NAMES):
        addr, pin = customers[i % len(customers)]
        b = make_user(
            db, demo_email(f"{first}.{last}".lower().replace(" ", "")), first, last, 200 + i,
            region="NCR", province="Metro Manila", city="Quezon City",
            address=addr, lat=pin[0], lng=pin[1], postal_code="1100",
        )
        buyers.append(b)

    # Ready-to-ship orders for the ALNS demo, each at a distinct address
    ready_spots = RNG.sample(customers, k=min(n_ready, len(customers)))
    for i, (addr, pin) in enumerate(ready_spots):
        buyer = buyers[i % len(buyers)]
        make_order(db, buyer, hub, hub_produce, OrderStatus.PROCESSING,
                   NOW - timedelta(hours=RNG.randint(1, 10)), address=addr, pin=pin)

    # History: delivered orders over the last 30 days, across all merchants
    sellers = [(hub, hub_produce)] + farms
    reviews = 0
    for _ in range(n_history):
        m, plist = RNG.choice(sellers)
        buyer = RNG.choice(buyers)
        when = NOW - timedelta(days=RNG.randint(1, 30), hours=RNG.randint(0, 12))
        o = make_order(db, buyer, m, plist, OrderStatus.DELIVERED, when)
        if RNG.random() < 0.6:
            rating, text = RNG.choice(REVIEW_TEXT)
            db.add(Review(order_id=o.id, user_id=buyer.id, merchant_id=m.id,
                          rating=rating, comment=text, created_at=o.delivered_at))
            reviews += 1
    db.flush()

    # Cached rating aggregates
    for m, _ in sellers:
        rs = [r.rating for r in db.query(Review).filter(Review.merchant_id == m.id).all()]
        m.rating = round(sum(rs) / len(rs), 2) if rs else None
        m.rating_count = len(rs)

    # Pending application for the admin approval demo
    applicant = make_user(db, demo_email("tarlac-veggies"), "Ramon", "Agustin", 400,
                          region="Central Luzon", province="Tarlac", city="Capas")
    db.add(MerchantApplication(
        user_id=applicant.id, status="submitted", submitted_at=NOW - timedelta(hours=5),
        merchant_name="Capas Organic Vegetables", legal_business_name="Capas Organic Vegetables",
        business_type="Farm",
        contact_email=applicant.email, contact_number=phone(401),
        rsbsa_number="03-69-04-012-34567",
        rsbsa_document_path="demo/rsbsa-placeholder.pdf",
        region="Central Luzon", province="Tarlac", city="Capas",
        barangay="Sta. Lucia", address="Sitio Sta. Lucia", postal_code="2315",
        delivery_time=2, delivery_price=90, price_range_min=40, price_range_max=200,
        available_days=WEEKDAYS,
    ))

    db.commit()
    print(
        f"Seeded {len(farms)} farms, {len(buyers)} buyers, {n_ready} ready-to-ship orders "
        f"on '{hub.merchant_name}', {n_history} delivered orders, {reviews} reviews, "
        "1 pending merchant application."
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--merchant-email", help="Email of the merchant account you demo with.")
    ap.add_argument("--ready", type=int, default=12, help="Processing orders for the ALNS demo (default 12).")
    ap.add_argument("--history", type=int, default=60, help="Delivered past orders (default 60).")
    ap.add_argument("--wipe", action="store_true", help="Remove previous demo seed first.")
    ap.add_argument("--wipe-only", action="store_true", help="Only remove the demo seed.")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        if args.wipe or args.wipe_only:
            wipe(db, args.merchant_email)
        if args.wipe_only:
            return
        if not args.merchant_email:
            ap.error("--merchant-email is required unless --wipe-only")
        seed(db, args.merchant_email, args.ready, args.history)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
