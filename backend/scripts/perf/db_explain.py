"""
EXPLAIN ANALYZE on the key queries of the seeded perf database.

Queries are built with the same ORM calls the routes make, so the plans match
what the app really sends. The stock update runs inside a transaction that is
rolled back. Writes explain.csv and explain_plans.txt to --out.

Run:  uv run python scripts/perf/db_explain.py --out scripts/results/perf/<run>
"""

import argparse
import csv
import json
import statistics
from pathlib import Path

import common

common.use_perf_database()

from sqlalchemy import func, or_, select, text, update  # noqa: E402
from sqlalchemy.dialects import postgresql  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.core.database import engine  # noqa: E402
from app.models.merchant import Merchant  # noqa: E402
from app.models.merchant_application import MerchantApplication  # noqa: E402
from app.models.order import Order  # noqa: E402
from app.models.order_history import OrderHistory  # noqa: E402
from app.models.produce import Produce  # noqa: E402
from app.models.statuses import OrderStatus  # noqa: E402
from app.services.order_status import (  # noqa: E402
    ACTIVE_ORDER_STATUSES,
    money_received_clause,
)
from app.models.user import User  # noqa: E402
from main import app  # noqa: E402, F401  (registers every mapper)

RUNS = 20


def key_queries(session: Session) -> dict[str, object]:
    merchant_id = session.scalar(select(func.min(Merchant.id)))
    produce_id = session.scalar(
        select(func.min(Produce.id)).where(Produce.merchant_id == merchant_id)
    )
    busiest_buyer = session.scalar(
        select(Order.user_id)
        .group_by(Order.user_id)
        .order_by(func.count().desc())
        .limit(1)
    )
    order_id = session.scalar(select(func.max(Order.id)))
    return {
        "merchant listing (GET /merchants)": select(Merchant)
        .outerjoin(MerchantApplication, MerchantApplication.user_id == Merchant.user_id)
        .where(
            Merchant.deleted_at.is_(None),
            or_(
                MerchantApplication.id.is_(None),
                MerchantApplication.status != "rejected",
            ),
        )
        .order_by(Merchant.id.asc()),
        "product listing (GET /merchants/{id}/produce)": select(Produce).where(
            Produce.merchant_id == merchant_id
        ),
        "buyer current orders (GET /orders/me/current)": select(Order)
        .join(OrderHistory, OrderHistory.id == Order.order_history_id)
        .where(
            OrderHistory.user_id == busiest_buyer,
            Order.status.in_(ACTIVE_ORDER_STATUSES),
        )
        .order_by(Order.id.asc()),
        "merchant orders (GET /merchants/me/orders)": select(Order, User)
        .outerjoin(User, User.id == Order.user_id)
        .where(Order.merchant_id == merchant_id, money_received_clause())
        .order_by(Order.ordered_at.desc())
        .limit(200),
        "merchant paid queue (GET /orders/merchant/current)": select(Order)
        .where(
            Order.merchant_id == merchant_id,
            Order.status.in_(ACTIVE_ORDER_STATUSES - {OrderStatus.PENDING}),
            money_received_clause(),
        )
        .order_by(Order.ordered_at.asc()),
        "stale reservation scan (POST /orders/me/place)": select(Order.id).where(
            Order.status == "pending", Order.ordered_at < func.now()
        ),
        "order lookup (GET /tracking/{id})": select(Order)
        .join(OrderHistory)
        .where(Order.id == order_id, OrderHistory.user_id == busiest_buyer)
        .limit(1),
        "stock lock (POST /orders/me/place)": select(Produce)
        .where(Produce.id == produce_id)
        .with_for_update()
        .limit(1),
        "stock update (POST /orders/me/place)": update(Produce)
        .where(Produce.id == produce_id)
        .values(stock_quantity=Produce.stock_quantity - 1),
    }


def walk_plan(node: dict) -> list[dict]:
    nodes = [node]
    for child in node.get("Plans", []):
        nodes.extend(walk_plan(child))
    return nodes


def scans_of(plan: dict) -> tuple[str, str]:
    """Return (sequential scans, index scans) named by table and index."""
    seq, indexed = [], []
    for node in walk_plan(plan):
        kind = node["Node Type"]
        if kind == "Seq Scan":
            seq.append(f"{node['Relation Name']} ({int(node['Actual Rows'])} rows)")
        elif "Index" in kind and "Index Name" in node:
            indexed.append(node["Index Name"])
    return "; ".join(seq), "; ".join(dict.fromkeys(indexed))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    rows = []
    with (
        Session(engine) as session,
        (args.out / "explain_plans.txt").open("w", encoding="utf-8") as plans,
    ):
        for name, statement in key_queries(session).items():
            sql = str(
                statement.compile(
                    dialect=postgresql.dialect(),
                    compile_kwargs={"literal_binds": True},
                )
            )
            # The rollback undoes the UPDATE and releases the row locks.
            times = []
            top_plan = None
            for _ in range(RUNS):
                result = session.execute(
                    text(f"EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {sql}")
                ).scalar_one()
                document = result if isinstance(result, list) else json.loads(result)
                top_plan = document[0]
                times.append(top_plan["Execution Time"])
                session.rollback()
            seq, indexed = scans_of(top_plan["Plan"])
            rows.append(
                {
                    "query": name,
                    "runs": RUNS,
                    "median_exec_ms": round(statistics.median(times), 3),
                    "max_exec_ms": round(max(times), 3),
                    "plan_ms": round(top_plan["Planning Time"], 3),
                    "seq_scans": seq,
                    "indexes_used": indexed,
                }
            )

            text_plan = session.execute(
                text(f"EXPLAIN (ANALYZE, BUFFERS) {sql}")
            ).scalars()
            plans.write(f"=== {name} ===\n{sql}\n\n")
            plans.write("\n".join(text_plan) + "\n\n")
            session.rollback()

    with (args.out / "explain.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    print(f"Explained {len(rows)} queries.")


if __name__ == "__main__":
    main()
