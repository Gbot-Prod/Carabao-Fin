"""
Reset the perf database and fill it with a fixed, realistic volume of data.

No order starts as "pending": the reservation sweep would try to expire its
PayMongo session. Stock is effectively unlimited so a load test never fails on
"insufficient stock".

Run:  uv run python scripts/perf/seed.py
"""

import argparse
import random
from datetime import UTC, datetime, timedelta

import common

common.use_perf_database()

from sqlalchemy import insert, text  # noqa: E402

from app.api.routes.auth import _bcrypt_hash  # noqa: E402
from app.core.database import Base, engine  # noqa: E402
from app.models.cart import Cart  # noqa: E402
from app.models.current_orders import CurrentOrder  # noqa: E402
from app.models.merchant import Merchant  # noqa: E402
from app.models.mobile_credential import MobileCredential  # noqa: E402
from app.models.order import Order  # noqa: E402
from app.models.order_history import OrderHistory  # noqa: E402
from app.models.produce import Produce  # noqa: E402
from app.models.shopPage import ShopPage  # noqa: E402
from app.models.transaction import Transaction  # noqa: E402
from app.models.user import User  # noqa: E402
from main import app  # noqa: E402, F401  (registers every mapper)

RNG_SEED = 42
STOCK = 10_000_000
PLATFORM_FEE_RATE = 0.02
# Merchants list orders and ship "processing" ones during the load test, so keep
# enough of those for the whole measurement window.
STATUS_WEIGHTS = {"delivered": 70, "cancelled": 5, "processing": 15, "shipped": 10}
PRODUCE_NAMES = {
    "Vegetables": ["Kangkong", "Pechay", "Sitaw", "Talong", "Ampalaya", "Kalabasa"],
    "Fruits": ["Mango", "Calamansi", "Banana", "Papaya", "Pineapple", "Lanzones"],
}
CITIES = ["Quezon City", "Manila", "Makati", "Pasig", "Taguig", "Marikina"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--merchants", type=int, default=50)
    parser.add_argument("--produce", type=int, default=2000)
    parser.add_argument("--orders", type=int, default=5000)
    parser.add_argument("--buyers", type=int, default=200)
    return parser.parse_args()


def build_users(n_buyers: int, n_merchants: int, now: datetime) -> list[dict]:
    emails = [common.buyer_email(i) for i in range(n_buyers)]
    emails += [common.merchant_email(i) for i in range(n_merchants)]
    return [
        {
            "id": user_id,
            # Phone numbers stay NULL so no order update can ever trigger an SMS.
            "email": email,
            "external_auth_id": f"mobile:perf-{user_id}",
            "first_name": "Perf",
            "last_name": f"User{user_id}",
            "address": f"{user_id} Sampaguita St",
            "city": CITIES[user_id % len(CITIES)],
            "notifications_preferences": {},
            "is_admin": False,
            "created_at": now,
            "updated_at": now,
        }
        for user_id, email in enumerate(emails, start=1)
    ]


def build_merchants(n_merchants: int, first_user_id: int, now: datetime) -> list[dict]:
    return [
        {
            "id": merchant_id,
            "user_id": first_user_id + merchant_id - 1,
            "merchant_name": f"Perf Farm {merchant_id}",
            "contact_number": f"0917{merchant_id:07d}",
            "contact_email": f"farm{merchant_id}@example.com",
            # Nothing in the app writes a rating, so real merchants have none.
            "rating": None,
            "region": "NCR",
            "province": "Metro Manila",
            "city": CITIES[merchant_id % len(CITIES)],
            "barangay": "Poblacion",
            "address": f"{merchant_id} Rizal Ave",
            "postal_code": "1100",
            "available_days": ["Mon", "Tue", "Wed", "Thu", "Fri"],
            "operating_hours": {"open": "06:00", "close": "18:00"},
            "delivery_time": 60,
            "delivery_price": 40,
            "price_range_min": 20,
            "price_range_max": 400,
            "business_type": "individual",
            "rsbsa_document_path": "perf/rsbsa.pdf",
            "created_at": now,
            "updated_at": now,
        }
        for merchant_id in range(1, n_merchants + 1)
    ]


def build_produce(rng: random.Random, n_produce: int, n_merchants: int) -> list[dict]:
    rows = []
    for produce_id in range(1, n_produce + 1):
        category = rng.choice(list(PRODUCE_NAMES))
        rows.append(
            {
                "id": produce_id,
                # Round robin, so every merchant lists the same number of items.
                "merchant_id": (produce_id - 1) % n_merchants + 1,
                "name": f"{rng.choice(PRODUCE_NAMES[category])} {produce_id}",
                "description": "Harvested this week.",
                "category": category,
                "price": rng.randint(20, 400),
                "unit": "kg",
                "unit_quantity": 1.0,
                "stock_quantity": STOCK,
            }
        )
    return rows


def route_for(order_id: int, merchant_name: str, rng: random.Random) -> list[dict]:
    return [
        {
            "sequence": 0,
            "order_id": None,
            "lat": 14.60 + rng.uniform(-0.05, 0.05),
            "lng": 120.98 + rng.uniform(-0.05, 0.05),
            "label": f"Pickup: {merchant_name}",
            "type": "pickup",
            "status": "pickup",
            "total_duration_seconds": 1800.0,
        },
        {
            "sequence": 1,
            "order_id": order_id,
            "lat": 14.60 + rng.uniform(-0.05, 0.05),
            "lng": 120.98 + rng.uniform(-0.05, 0.05),
            "label": "Your Location",
            "type": "delivery",
            "status": "in_transit",
            "duration_seconds": 1800.0,
        },
    ]


def build_orders(
    rng: random.Random,
    n_orders: int,
    n_buyers: int,
    produce: list[dict],
    merchants: list[dict],
    now: datetime,
) -> tuple[list[dict], list[dict], list[dict]]:
    by_merchant: dict[int, list[dict]] = {}
    for row in produce:
        by_merchant.setdefault(row["merchant_id"], []).append(row)

    orders, current_orders, transactions = [], [], []
    statuses, weights = zip(*STATUS_WEIGHTS.items(), strict=True)
    for order_id in range(1, n_orders + 1):
        buyer_id = rng.randint(1, n_buyers)
        merchant = rng.choice(merchants)
        status = rng.choices(statuses, weights)[0]
        chosen = rng.sample(by_merchant[merchant["id"]], rng.randint(1, 3))
        items = [
            {
                "produce_id": row["id"],
                "name": row["name"],
                "merchant_id": merchant["id"],
                "farm": merchant["merchant_name"],
                "price": row["price"],
                "quantity": rng.randint(1, 5),
                "unit": "kg",
            }
            for row in chosen
        ]
        total = sum(i["price"] * i["quantity"] for i in items)
        total += merchant["delivery_price"]

        # Active orders are recent: older in-transit ones would be auto-confirmed.
        age_days = 180 if status in ("delivered", "cancelled") else 2
        ordered_at = now - timedelta(minutes=rng.randint(60, age_days * 24 * 60))
        shipped_at = None
        if status in ("delivered", "shipped"):
            shipped_at = ordered_at + timedelta(minutes=30)
        delivered = status == "delivered"
        orders.append(
            {
                "id": order_id,
                "order_history_id": buyer_id,
                "user_id": buyer_id,
                "merchant_id": merchant["id"],
                "status": status,
                "total_price": total,
                "items": items,
                "delivery_address": f"{buyer_id} Sampaguita St, Quezon City",
                "ordered_at": ordered_at,
                "shipped_at": shipped_at,
                "delivered_at": shipped_at + timedelta(days=1) if delivered else None,
                "delivery_confirmed_by": "buyer" if delivered else None,
                "route_waypoints": route_for(order_id, merchant["merchant_name"], rng)
                if status == "shipped"
                else None,
            }
        )
        current_orders.append(
            {
                "id": order_id,
                "order_id": order_id,
                "merchant_id": merchant["id"],
                "status": status,
                "delivery_fee": merchant["delivery_price"],
                "created_at": ordered_at,
            }
        )
        if status != "cancelled":
            fee = round(total * PLATFORM_FEE_RATE)
            transactions.append(
                {
                    "id": len(transactions) + 1,
                    "order_id": order_id,
                    "merchant_id": merchant["id"],
                    "user_id": buyer_id,
                    "amount": total,
                    "platform_fee": fee,
                    "merchant_amount": total - fee,
                    "status": "paid",
                    "description": f"Carabao Order #{order_id}",
                    "paymongo_session_id": f"cs_seed_{order_id}",
                    "paymongo_payment_id": f"pay_seed_{order_id}",
                    "created_at": ordered_at,
                    "paid_at": ordered_at,
                }
            )
    return orders, current_orders, transactions


def main() -> None:
    args = parse_args()
    rng = random.Random(RNG_SEED)
    now = datetime.now(UTC)

    users = build_users(args.buyers, args.merchants, now)
    merchants = build_merchants(args.merchants, args.buyers + 1, now)
    produce = build_produce(rng, args.produce, args.merchants)
    orders, current_orders, transactions = build_orders(
        rng, args.orders, args.buyers, produce, merchants, now
    )
    password_hash = _bcrypt_hash(common.PERF_PASSWORD)

    Base.metadata.create_all(bind=engine)
    tables = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
    rows_by_model = [
        (User, users),
        (
            MobileCredential,
            [
                {
                    "id": u["id"],
                    "user_id": u["id"],
                    "password_hash": password_hash,
                    "created_at": now,
                    "updated_at": now,
                }
                for u in users
            ],
        ),
        (Cart, [{"id": u["id"], "user_id": u["id"], "items": []} for u in users]),
        (
            OrderHistory,
            [
                {
                    "id": i,
                    "user_id": i,
                    "created_at": now,
                    "updated_at": now,
                }
                for i in range(1, args.buyers + 1)
            ],
        ),
        (Merchant, merchants),
        (
            ShopPage,
            [
                {
                    "id": m["id"],
                    "merchant_id": m["id"],
                    "title": m["merchant_name"],
                    "slug": f"perf-farm-{m['id']}",
                    "description": "A seeded farm for performance testing.",
                }
                for m in merchants
            ],
        ),
        (Produce, produce),
        (Order, orders),
        (CurrentOrder, current_orders),
        (Transaction, transactions),
    ]
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
        for model, rows in rows_by_model:
            conn.execute(insert(model), rows)
            # Rows carry explicit ids, so move the sequence past them.
            table = model.__tablename__
            conn.execute(
                text(
                    "SELECT setval(pg_get_serial_sequence(:t, 'id'), "
                    f'(SELECT max(id) FROM "{table}"))'
                ),
                {"t": table},
            )
    # Fresh planner statistics, or EXPLAIN reflects an unanalyzed table.
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        conn.execute(text("ANALYZE"))

    print(
        f"Seeded {len(users)} users, {len(merchants)} merchants, "
        f"{len(produce)} produce, {len(orders)} orders, "
        f"{len(transactions)} transactions."
    )


if __name__ == "__main__":
    main()
