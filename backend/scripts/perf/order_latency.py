"""
Order status and payment webhook latency, measured against a running server.

Status: a merchant changes an order's status while a separate buyer session polls
GET /orders/me/current, the call the Orders and Track pages make. The commit happens
somewhere between sending the PATCH and receiving its response, and both ends use
this machine's clock, so each trial gives a bracket on commit-to-visible latency:
  from_ack_ms   PATCH response -> buyer sees it (lower bound, floored at 0)
  from_send_ms  PATCH sent -> buyer sees it (upper bound; targets judge this one)

Webhook: replays a correctly signed checkout_session.payment.paid event and times
the handler. The event is built here, so it says nothing about PayMongo's delivery
delay; see the README for measuring that with a real test payment.

Run:  see run_suite.py
"""

import argparse
import csv
import hashlib
import hmac
import json
import os
import random
import threading
import time
from pathlib import Path

import common
import requests
from dotenv import dotenv_values

# The transitions a dispatched order makes. "shipped" also computes the route.
TRANSITIONS = ("shipped", "out_for_delivery")
POLL_DEADLINE_SECONDS = 60
N_BUYER_SESSIONS = 10


class Client:
    def __init__(self, base_url: str, email: str) -> None:
        self.base_url = base_url
        self.session = requests.Session()
        response = self.session.post(
            f"{base_url}/auth/mobile/sign-in",
            json={"email": email, "password": common.PERF_PASSWORD},
            timeout=60,
        )
        response.raise_for_status()
        self.user_id = response.json()["user_id"]
        token = response.json()["access_token"]
        self.session.headers["Authorization"] = f"Bearer {token}"

    def request(self, method: str, path: str, **kwargs) -> requests.Response:
        response = self.session.request(
            method, f"{self.base_url}{path}", timeout=120, **kwargs
        )
        response.raise_for_status()
        return response


class Fixture:
    """One merchant and a rotating set of buyers, so no order list keeps growing."""

    def __init__(self, base_url: str) -> None:
        self.base_url = base_url
        self.merchant = Client(base_url, common.merchant_email(0))
        self.buyers = [
            Client(base_url, common.buyer_email(i)) for i in range(N_BUYER_SESSIONS)
        ]
        merchant_id = next(
            m["id"]
            for m in self.merchant.request("GET", "/merchants").json()
            if m["user_id"] == self.merchant.user_id
        )
        self.merchant_id = merchant_id
        self.produce = self.merchant.request(
            "GET", f"/merchants/{merchant_id}/produce"
        ).json()

    def place_order(self, buyer: Client) -> int:
        row = random.choice(self.produce)
        item = {
            "produce_id": row["id"],
            "merchant_id": self.merchant_id,
            "name": row["name"],
            "price": row["price"],
            "quantity": 1,
            "unit": row["unit"],
        }
        buyer.request("PUT", "/carts/me", json={"items": [item]})
        placed = buyer.request(
            "POST",
            "/orders/me/place",
            json={"delivery_address": "12 Sampaguita St, Quezon City"},
        )
        return placed.json()["order_id"]

    def pay_order(self, buyer: Client, order_id: int) -> requests.Response:
        """Pay through the real path: open a checkout, then replay its webhook.

        Payment is the only way an order leaves "pending"; merchants can't
        move unpaid orders.
        """
        checkout = buyer.request("POST", f"/payments/checkout/{order_id}").json()
        body, signature = signed_webhook(
            checkout["paymongo_session_id"], webhook_secret()
        )
        return requests.post(
            f"{self.base_url}/webhooks/paymongo",
            data=body,
            headers={
                "Paymongo-Signature": signature,
                "Content-Type": "application/json",
            },
            timeout=60,
        )

    def set_status(self, order_id: int, status: str) -> None:
        self.merchant.request(
            "PATCH",
            f"/merchants/me/orders/{order_id}/status",
            json={"status": status},
        )


def status_of(buyer: Client, order_id: int) -> str | None:
    orders = buyer.request("GET", "/orders/me/current").json()
    return next((o["status"] for o in orders if o["order_id"] == order_id), None)


def timed_transition(
    fixture: Fixture, buyer: Client, order_id: int, status: str, poll_ms: int
) -> dict:
    """Change the status while the buyer polls on its own schedule."""
    seen_at: list[float] = []
    polls = [0]
    stop = threading.Event()

    def poll() -> None:
        deadline = time.perf_counter() + POLL_DEADLINE_SECONDS
        while not stop.is_set() and time.perf_counter() < deadline:
            polls[0] += 1
            if status_of(buyer, order_id) == status:
                seen_at.append(time.perf_counter())
                return
            time.sleep(poll_ms / 1000)

    poller = threading.Thread(target=poll)
    poller.start()
    # Random phase: the change lands at an arbitrary point in the polling cycle.
    time.sleep(random.uniform(0, poll_ms / 1000))

    sent = time.perf_counter()
    try:
        fixture.set_status(order_id, status)
    except requests.RequestException as exc:
        print(f"PATCH failed on order {order_id}: {exc}", flush=True)
        stop.set()
    acked = time.perf_counter()
    poller.join(POLL_DEADLINE_SECONDS + 5)
    stop.set()

    if not seen_at:
        return {
            "patch_ms": (acked - sent) * 1000,
            "from_ack_ms": "",
            "from_send_ms": "",
            "polls": polls[0],
            "seen": 0,
        }
    return {
        "patch_ms": (acked - sent) * 1000,
        "from_ack_ms": max(seen_at[0] - acked, 0) * 1000,
        "from_send_ms": (seen_at[0] - sent) * 1000,
        "polls": polls[0],
        "seen": 1,
    }


def run_status(
    fixture: Fixture, out_dir: Path, poll_intervals: list[int], trials: int
) -> None:
    with (out_dir / "order_status.csv").open("w", newline="") as f:
        writer = csv.DictWriter(
            f,
            [
                "poll_ms",
                "trial",
                "order_id",
                "transition",
                "patch_ms",
                "from_ack_ms",
                "from_send_ms",
                "polls",
                "seen",
            ],
        )
        writer.writeheader()
        for poll_ms in poll_intervals:
            for trial in range(trials):
                buyer = fixture.buyers[trial % len(fixture.buyers)]
                order_id = fixture.place_order(buyer)
                fixture.pay_order(buyer, order_id)
                for transition in TRANSITIONS:
                    row = timed_transition(
                        fixture, buyer, order_id, transition, poll_ms
                    )
                    writer.writerow(
                        {
                            "poll_ms": poll_ms,
                            "trial": trial,
                            "order_id": order_id,
                            "transition": transition,
                            **row,
                        }
                    )
                    if not row["seen"]:
                        # The next transition isn't valid from this state.
                        break
                f.flush()
            print(f"status: {trials} trials at {poll_ms} ms polling done", flush=True)


def signed_webhook(session_id: str, secret: str) -> tuple[bytes, str]:
    now = int(time.time())
    body = json.dumps(
        {
            "data": {
                "id": f"evt_perf_{session_id}",
                "type": "event",
                "attributes": {
                    "type": "checkout_session.payment.paid",
                    "livemode": False,
                    "created_at": now,
                    "perf_replay": True,
                    "data": {
                        "id": session_id,
                        "attributes": {
                            "status": "paid",
                            "payments": [{"id": f"pay_perf_{session_id}"}],
                        },
                    },
                },
            }
        }
    ).encode()
    digest = hmac.new(
        secret.encode(), f"{now}.".encode() + body, hashlib.sha256
    ).hexdigest()
    return body, f"t={now},te={digest},li="


def webhook_secret() -> str:
    secret = dotenv_values(common.BACKEND_ROOT / ".env").get("PAYMONGO_WEBHOOK_SECRET")
    if not secret:
        raise SystemExit("PAYMONGO_WEBHOOK_SECRET is not set in .env.")
    return secret


def run_webhook(fixture: Fixture, base_url: str, out_dir: Path, trials: int) -> None:
    secret = webhook_secret()

    with (out_dir / "webhook.csv").open("w", newline="") as f:
        writer = csv.DictWriter(f, ["trial", "order_id", "http", "ms", "settled"])
        writer.writeheader()
        for trial in range(trials):
            buyer = fixture.buyers[trial % len(fixture.buyers)]
            order_id = fixture.place_order(buyer)
            checkout = buyer.request("POST", f"/payments/checkout/{order_id}").json()
            body, signature = signed_webhook(checkout["paymongo_session_id"], secret)

            start = time.perf_counter()
            response = requests.post(
                f"{base_url}/webhooks/paymongo",
                data=body,
                headers={
                    "Paymongo-Signature": signature,
                    "Content-Type": "application/json",
                },
                timeout=60,
            )
            ms = (time.perf_counter() - start) * 1000
            writer.writerow(
                {
                    "trial": trial,
                    "order_id": order_id,
                    "http": response.status_code,
                    "ms": ms,
                    "settled": int(status_of(buyer, order_id) == "processing"),
                }
            )
            f.flush()
    print(f"webhook: {trials} trials done", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="http://127.0.0.1:8765")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--trials", type=int, default=50)
    parser.add_argument(
        "--poll-ms",
        default="50,3000",
        help="Buyer poll intervals: 50 shows the system's own propagation, 3000 "
        "matches the interval in the Track page's fetch loop.",
    )
    args = parser.parse_args()

    os.makedirs(args.out, exist_ok=True)
    fixture = Fixture(args.host)
    run_status(
        fixture, args.out, [int(p) for p in args.poll_ms.split(",")], args.trials
    )
    run_webhook(fixture, args.host, args.out, args.trials)


if __name__ == "__main__":
    main()
