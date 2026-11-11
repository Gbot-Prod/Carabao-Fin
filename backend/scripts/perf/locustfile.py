"""
Client-side load test: what buyers and merchants experience.

Buyers run the full journey (sign in, browse, cart, order, checkout, track) and
merchants work their order queue. Each journey signs in again, otherwise sign-in
would only happen during the warm-up that the analysis throws away.

Each response is written to PERF_CLIENT_CSV so warm-up can be cut by timestamp and
percentiles computed from raw samples, not Locust's rounded histogram.

Run:  see run_suite.py
"""

import atexit
import csv
import itertools
import os
import random
import time

import common
from locust import HttpUser, between, task

N_BUYERS = int(os.getenv("PERF_BUYERS", "200"))
N_MERCHANTS = int(os.getenv("PERF_MERCHANTS", "50"))

_buyer_index = itertools.count()
_merchant_index = itertools.count()

_file = open(os.environ["PERF_CLIENT_CSV"], "w", newline="", encoding="utf-8")  # noqa: SIM115
atexit.register(_file.close)
_writer = csv.writer(_file)
_writer.writerow(["wall_ts", "endpoint", "status", "ms", "ok"])


class CarabaoUser(HttpUser):
    abstract = True
    wait_time = between(1, 3)
    email = ""
    headers: dict[str, str] = {}

    def call(self, method: str, template: str, path: str | None = None, **kwargs):
        """Send one request and log it. Returns the response when it succeeded."""
        endpoint = f"{method} {template}"
        with self.client.request(
            method,
            path or template,
            name=endpoint,
            headers=self.headers,
            catch_response=True,
            **kwargs,
        ) as response:
            ok = 200 <= response.status_code < 300
            if ok:
                response.success()
            else:
                response.failure(f"HTTP {response.status_code}")
            _writer.writerow(
                [
                    time.time(),
                    endpoint,
                    response.status_code,
                    response.request_meta["response_time"],
                    int(ok),
                ]
            )
            return response if ok else None

    def sign_in(self) -> bool:
        self.headers = {}
        response = self.call(
            "POST",
            "/auth/mobile/sign-in",
            json={"email": self.email, "password": common.PERF_PASSWORD},
        )
        if response is None:
            return False
        self.headers = {"Authorization": f"Bearer {response.json()['access_token']}"}
        return True


class BuyerUser(CarabaoUser):
    weight = 4
    # Filled once: parsing the large listing on every journey would stall the
    # load generator's other simulated users and inflate their timings.
    merchant_ids: list[int] = []

    def on_start(self) -> None:
        self.email = common.buyer_email(next(_buyer_index) % N_BUYERS)

    def browse(self) -> int | None:
        response = self.call("GET", "/merchants")
        if response is None:
            return None
        if not BuyerUser.merchant_ids:
            BuyerUser.merchant_ids = [m["id"] for m in response.json()]
        return random.choice(BuyerUser.merchant_ids)

    @task
    def journey(self) -> None:
        if not self.sign_in():
            return
        merchant_id = self.browse()
        if merchant_id is None:
            return
        self.call("GET", "/merchants/{merchant_id}", f"/merchants/{merchant_id}")
        self.call(
            "GET",
            "/merchants/{merchant_id}/shoppage",
            f"/merchants/{merchant_id}/shoppage",
        )
        produce = self.call(
            "GET",
            "/merchants/{merchant_id}/produce",
            f"/merchants/{merchant_id}/produce",
        )
        if produce is None:
            return
        self.wait()

        chosen = random.sample(produce.json(), random.randint(1, 3))
        items = [
            {
                "produce_id": row["id"],
                "merchant_id": merchant_id,
                "name": row["name"],
                "price": row["price"],
                "quantity": random.randint(1, 3),
                "unit": row["unit"],
            }
            for row in chosen
        ]
        self.call("PUT", "/carts/me", json={"items": items})
        self.call("GET", "/carts/me")
        self.wait()

        placed = self.call(
            "POST",
            "/orders/me/place",
            json={"delivery_address": "12 Sampaguita St, Quezon City"},
        )
        if placed is None:
            return
        order_id = placed.json()["order_id"]
        self.call(
            "POST",
            "/payments/checkout/{order_id}",
            f"/payments/checkout/{order_id}",
        )
        self.wait()

        current = self.call("GET", "/orders/me/current")
        self.call("GET", "/orders/me/history")
        if current is None:
            return
        shipped = [o["order_id"] for o in current.json() if o["status"] == "shipped"]
        if shipped:
            self.call(
                "GET",
                "/tracking/{order_id}",
                f"/tracking/{random.choice(shipped)}",
            )


class MerchantUser(CarabaoUser):
    weight = 1

    def on_start(self) -> None:
        self.email = common.merchant_email(next(_merchant_index) % N_MERCHANTS)

    @task
    def work_queue(self) -> None:
        if not self.sign_in():
            return
        orders = self.call("GET", "/merchants/me/orders")
        self.call("GET", "/orders/merchant/current")
        self.call("GET", "/merchants/me/performance")
        if orders is None:
            return
        self.wait()

        ready = [o["id"] for o in orders.json() if o["status"] == "processing"]
        if ready:
            order_id = random.choice(ready)
            self.call(
                "PATCH",
                "/merchants/me/orders/{order_id}/status",
                f"/merchants/me/orders/{order_id}/status",
                json={"status": "shipped"},
            )
