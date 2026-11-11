# SOP 3 performance results

> **Mapbox and Paymongo stubbed.** Those calls were skipped, so these numbers are not end-to-end for the rows that depend on them, and those rows are not judged.

**20 targets met, 15 missed, 27 not judged.**

Run 20261103T024628Z at commit `d0a0a6f` on Windows-10-10.0.19045-SP0 (20 logical CPUs), PostgreSQL 18.2 on 127.0.0.1, 1 uvicorn worker. 60 s measured after 15 s warm-up, 1 repeat(s) pooled per level.

Uncommitted files: M backend/app/api/routes/payments.py,  M backend/app/models/transaction.py,  M backend/pyproject.toml,  M backend/uv.lock, ?? backend/scripts/perf/, ?? backend/scripts/results/perf/.

## API response time, client side (Locust)

### Load summary, all endpoints

Throughput should rise with concurrency. If it falls, the system is saturated, even if few errors were recorded. The limit here is the loosest endpoint target.

| Concurrency | Requests | Req/s | p50 (ms) | p95 (ms) | Max (ms) | Errors | Pool timeouts | p95 <= 2000 ms and errors < 1%? |
|---|---|---|---|---|---|---|---|---|
| 1 | 93 | 1.6 | 8 | 171 | 172 | 0 (0.00%) | 0 | Yes |
| 10 | 785 | 13.1 | 18 | 285 | 949 | 0 (0.00%) | 0 | Yes |
| 25 | 233 | 3.9 | 203 | 30,385 | 31,324 | 2 (0.86%) | 2 | No |
| 50 | 10 | 0.2 | 45,813 | 61,486 | 61,563 | 0 (0.00%) | 0 | No (slow, low n) |

### Per endpoint

| Endpoint | Concurrency | n | p50 (ms) | p95 (ms) | Max (ms) | Errors | Target (ms) | Met? |
|---|---|---|---|---|---|---|---|---|
| `GET /carts/me` | 1 | 8 | 3 | 3 | 3 | 0 (0.0%) | 500 | Not judged (n<30) |
| `GET /carts/me` | 10 | 54 | 3 | 32 | 106 | 0 (0.0%) | 500 | Yes |
| `GET /carts/me` | 25 | 17 | 48 | 723 | 915 | 0 (0.0%) | 500 | No (slow, low n) |
| `GET /merchants` | 1 | 8 | 51 | 76 | 88 | 0 (0.0%) | 500 | Not judged (n<30) |
| `GET /merchants` | 10 | 55 | 60 | 286 | 438 | 0 (0.0%) | 500 | Yes |
| `GET /merchants` | 25 | 16 | 241 | 7,984 | 30,276 | 0 (0.0%) | 500 | No (slow, low n) |
| `GET /merchants` | 50 | 2 | 45,813 | 59,388 | 60,896 | 0 (0.0%) | 500 | No (slow, low n) |
| `GET /merchants/me/orders` | 10 | 27 | 23 | 376 | 565 | 0 (0.0%) | 500 | Not judged (n<30) |
| `GET /merchants/me/orders` | 25 | 9 | 329 | 18,654 | 30,673 | 0 (0.0%) | 500 | No (slow, low n) |
| `GET /merchants/me/performance` | 10 | 27 | 10 | 156 | 373 | 0 (0.0%) | 500 | Not judged (n<30) |
| `GET /merchants/me/performance` | 25 | 9 | 45 | 510 | 653 | 0 (0.0%) | 500 | Not judged (n<30) |
| `GET /merchants/me/performance` | 50 | 1 | 61,077 | 61,077 | 61,077 | 0 (0.0%) | 500 | Not judged (n<30) |
| `GET /merchants/{merchant_id}` | 1 | 8 | 3 | 4 | 4 | 0 (0.0%) | 500 | Not judged (n<30) |
| `GET /merchants/{merchant_id}` | 10 | 55 | 8 | 239 | 344 | 0 (0.0%) | 500 | Yes |
| `GET /merchants/{merchant_id}` | 25 | 17 | 349 | 30,341 | 30,605 | 0 (0.0%) | 500 | No (slow, low n) |
| `GET /merchants/{merchant_id}/produce` | 1 | 8 | 2 | 2 | 2 | 0 (0.0%) | 500 | Not judged (n<30) |
| `GET /merchants/{merchant_id}/produce` | 10 | 55 | 4 | 120 | 226 | 0 (0.0%) | 500 | Yes |
| `GET /merchants/{merchant_id}/produce` | 25 | 15 | 62 | 9,469 | 30,449 | 0 (0.0%) | 500 | Not judged (n<30) |
| `GET /merchants/{merchant_id}/produce` | 50 | 4 | 30,730 | 30,731 | 30,731 | 0 (0.0%) | 500 | No (slow, low n) |
| `GET /merchants/{merchant_id}/shoppage` | 1 | 8 | 2 | 2 | 2 | 0 (0.0%) | 500 | Not judged (n<30) |
| `GET /merchants/{merchant_id}/shoppage` | 10 | 55 | 3 | 104 | 171 | 0 (0.0%) | 500 | Yes |
| `GET /merchants/{merchant_id}/shoppage` | 25 | 17 | 213 | 6,507 | 30,448 | 0 (0.0%) | 500 | No (slow, low n) |
| `GET /merchants/{merchant_id}/shoppage` | 50 | 1 | 60,896 | 60,896 | 60,896 | 0 (0.0%) | 500 | Not judged (n<30) |
| `GET /orders/me/current` | 1 | 7 | 34 | 38 | 38 | 0 (0.0%) | 500 | Not judged (n<30) |
| `GET /orders/me/current` | 10 | 56 | 37 | 252 | 554 | 0 (0.0%) | 500 | Yes |
| `GET /orders/me/current` | 25 | 16 | 366 | 30,398 | 30,672 | 0 (0.0%) | 500 | No (slow, low n) |
| `GET /orders/me/history` | 1 | 7 | 20 | 22 | 22 | 0 (0.0%) | 500 | Not judged (n<30) |
| `GET /orders/me/history` | 10 | 56 | 22 | 222 | 420 | 0 (0.0%) | 500 | Yes |
| `GET /orders/me/history` | 25 | 15 | 364 | 30,645 | 30,645 | 0 (0.0%) | 500 | No (slow, low n) |
| `GET /orders/merchant/current` | 10 | 27 | 23 | 355 | 576 | 0 (0.0%) | 500 | Not judged (n<30) |
| `GET /orders/merchant/current` | 25 | 8 | 79 | 539 | 559 | 0 (0.0%) | 500 | No (slow, low n) |
| `GET /tracking/{order_id}` | 1 | 7 | 3 | 3 | 4 | 0 (0.0%) | 500 | Not judged (n<30) |
| `GET /tracking/{order_id}` | 10 | 49 | 4 | 80 | 251 | 0 (0.0%) | 500 | Yes |
| `GET /tracking/{order_id}` | 25 | 11 | 80 | 30,659 | 30,673 | 0 (0.0%) | 500 | No (slow, low n) |
| `PATCH /merchants/me/orders/{order_id}/status` | 10 | 21 | 11 | 68 | 111 | 0 (0.0%) | 2000 | Not judged (stubbed) |
| `PATCH /merchants/me/orders/{order_id}/status` | 25 | 9 | 264 | 19,018 | 30,954 | 0 (0.0%) | 2000 | Not judged (stubbed) |
| `POST /auth/mobile/sign-in` | 1 | 8 | 171 | 172 | 172 | 0 (0.0%) | 1000 | Not judged (n<30) |
| `POST /auth/mobile/sign-in` | 10 | 82 | 173 | 470 | 544 | 0 (0.0%) | 1000 | Yes |
| `POST /auth/mobile/sign-in` | 25 | 24 | 361 | 25,901 | 30,748 | 1 (4.0%) | 1000 | No (slow, low n) |
| `POST /auth/mobile/sign-in` | 50 | 2 | 61,478 | 61,555 | 61,563 | 0 (0.0%) | 1000 | No (slow, low n) |
| `POST /orders/me/place` | 1 | 8 | 11 | 13 | 13 | 0 (0.0%) | 1000 | Not judged (n<30) |
| `POST /orders/me/place` | 10 | 56 | 12 | 254 | 354 | 0 (0.0%) | 1000 | Yes |
| `POST /orders/me/place` | 25 | 18 | 194 | 772 | 845 | 0 (0.0%) | 1000 | Not judged (n<30) |
| `POST /payments/checkout/{order_id}` | 1 | 8 | 9 | 10 | 10 | 0 (0.0%) | 2000 | Not judged (stubbed) |
| `POST /payments/checkout/{order_id}` | 10 | 56 | 10 | 240 | 949 | 0 (0.0%) | 2000 | Not judged (stubbed) |
| `POST /payments/checkout/{order_id}` | 25 | 16 | 24 | 8,356 | 31,324 | 0 (0.0%) | 2000 | Not judged (stubbed) |
| `PUT /carts/me` | 1 | 8 | 7 | 8 | 8 | 0 (0.0%) | 1000 | Not judged (n<30) |
| `PUT /carts/me` | 10 | 54 | 7 | 423 | 611 | 0 (0.0%) | 1000 | Yes |
| `PUT /carts/me` | 25 | 14 | 208 | 665 | 861 | 1 (6.7%) | 1000 | Not judged (n<30) |

## Client vs server time

The gap is network, connection setup and time spent queued before the server's middleware runs. Each p95 comes from its own samples, so small negative gaps are noise.

| Endpoint | Concurrency | Client p95 (ms) | Server p95 (ms) | Outside app code (ms) |
|---|---|---|---|---|
| `GET /carts/me` | 1 | 3 | 3 | 0 |
| `GET /carts/me` | 10 | 32 | 29 | 3 |
| `GET /carts/me` | 25 | 723 | 6,982 | -6,259 |
| `GET /merchants` | 1 | 76 | 75 | 1 |
| `GET /merchants` | 10 | 286 | 540 | -254 |
| `GET /merchants` | 25 | 7,984 | 6,832 | 1,152 |
| `GET /merchants` | 50 | 59,388 | - | - |
| `GET /merchants/me/orders` | 10 | 376 | 570 | -195 |
| `GET /merchants/me/orders` | 25 | 18,654 | 941 | 17,713 |
| `GET /merchants/me/performance` | 10 | 156 | 82 | 74 |
| `GET /merchants/me/performance` | 25 | 510 | 481 | 29 |
| `GET /merchants/me/performance` | 50 | 61,077 | - | - |
| `GET /merchants/{merchant_id}` | 1 | 4 | 3 | 0 |
| `GET /merchants/{merchant_id}` | 10 | 239 | 246 | -6 |
| `GET /merchants/{merchant_id}` | 25 | 30,341 | 30,725 | -384 |
| `GET /merchants/{merchant_id}/produce` | 1 | 2 | 2 | 0 |
| `GET /merchants/{merchant_id}/produce` | 10 | 120 | 66 | 55 |
| `GET /merchants/{merchant_id}/produce` | 25 | 9,469 | 11,002 | -1,533 |
| `GET /merchants/{merchant_id}/produce` | 50 | 30,731 | - | - |
| `GET /merchants/{merchant_id}/shoppage` | 1 | 2 | 2 | 0 |
| `GET /merchants/{merchant_id}/shoppage` | 10 | 104 | 171 | -67 |
| `GET /merchants/{merchant_id}/shoppage` | 25 | 6,507 | 9,815 | -3,307 |
| `GET /merchants/{merchant_id}/shoppage` | 50 | 60,896 | - | - |
| `GET /orders/me/current` | 1 | 38 | 38 | 0 |
| `GET /orders/me/current` | 10 | 252 | 266 | -14 |
| `GET /orders/me/current` | 25 | 30,398 | 8,573 | 21,825 |
| `GET /orders/me/history` | 1 | 22 | 22 | 0 |
| `GET /orders/me/history` | 10 | 222 | 203 | 19 |
| `GET /orders/me/history` | 25 | 30,645 | 31,132 | -487 |
| `GET /orders/merchant/current` | 10 | 355 | 333 | 22 |
| `GET /orders/merchant/current` | 25 | 539 | 723 | -184 |
| `GET /tracking/{order_id}` | 1 | 3 | 3 | 0 |
| `GET /tracking/{order_id}` | 10 | 80 | 58 | 21 |
| `GET /tracking/{order_id}` | 25 | 30,659 | 14,678 | 15,981 |
| `PATCH /merchants/me/orders/{order_id}/status` | 10 | 68 | 65 | 4 |
| `PATCH /merchants/me/orders/{order_id}/status` | 25 | 19,018 | 19,143 | -125 |
| `POST /auth/mobile/sign-in` | 1 | 172 | 172 | 0 |
| `POST /auth/mobile/sign-in` | 10 | 470 | 610 | -140 |
| `POST /auth/mobile/sign-in` | 25 | 25,901 | 27,808 | -1,907 |
| `POST /auth/mobile/sign-in` | 50 | 61,555 | - | - |
| `POST /orders/me/place` | 1 | 13 | 12 | 1 |
| `POST /orders/me/place` | 10 | 254 | 232 | 22 |
| `POST /orders/me/place` | 25 | 772 | 956 | -184 |
| `POST /payments/checkout/{order_id}` | 1 | 10 | 10 | 0 |
| `POST /payments/checkout/{order_id}` | 10 | 240 | 132 | 108 |
| `POST /payments/checkout/{order_id}` | 25 | 8,356 | 670 | 7,686 |
| `PUT /carts/me` | 1 | 8 | 7 | 1 |
| `PUT /carts/me` | 10 | 423 | 329 | 94 |
| `PUT /carts/me` | 25 | 665 | 1,175 | -510 |

## Database query execution time

| Concurrency | Queries | p50 (ms) | p95 (ms) | Max (ms) | Target | Met? |
|---|---|---|---|---|---|---|
| 1 | 2130 | 0.13 | 0.33 | 3.70 | 100 | Yes |
| 10 | 16473 | 0.13 | 0.42 | 7.35 | 100 | Yes |
| 25 | 4551 | 0.13 | 1.64 | 10.61 | 100 | Yes |
| 50 | 30 | 0.15 | 8.54 | 9.09 | 100 | Yes |

### 15 slowest statements by p95, all levels

| Id | n | p50 (ms) | p95 (ms) | Max (ms) | Statement |
|---|---|---|---|---|---|
| `90160554c582` | 36 | 0.69 | 7.33 | 9.26 | `SELECT current_orders.id AS current_orders_id, current_orders.order_id AS current_orders_o` |
| `cf7a6cba83fa` | 37 | 1.17 | 6.42 | 8.26 | `SELECT orders.id AS orders_id, orders.order_history_id AS orders_order_history_id, orders.` |
| `c03e6d61f72a` | 139 | 0.32 | 5.08 | 9.09 | `SELECT merchants.id AS merchants_id, merchants.merchant_name AS merchants_merchant_name, m` |
| `9e0b72480a78` | 79 | 0.71 | 4.89 | 10.61 | `SELECT current_orders.id AS current_orders_id, current_orders.order_id AS current_orders_o` |
| `b810c1ce2177` | 683 | 0.48 | 4.71 | 7.60 | `SELECT backend_users.id AS backend_users_id, backend_users.external_auth_id AS backend_use` |
| `3715f609e5ec` | 79 | 0.66 | 4.17 | 7.33 | `SELECT merchants.id AS merchants_id, merchants.merchant_name AS merchants_merchant_name, m` |
| `9ea2690b0ddc` | 81 | 0.35 | 3.86 | 6.24 | `SELECT shop_pages.id AS shop_pages_id, shop_pages.merchant_id AS shop_pages_merchant_id, s` |
| `c4845dc660ff` | 82 | 0.28 | 3.69 | 4.47 | `SELECT transactions.id AS transactions_id, transactions.order_id AS transactions_order_id,` |
| `73be517f1f7b` | 167 | 0.27 | 3.12 | 5.48 | `SELECT orders.id AS orders_id FROM orders WHERE orders.status = %(status_1)s::VARCHAR AND ` |
| `d5e849707559` | 82 | 0.29 | 3.06 | 3.83 | `SELECT transactions.id, transactions.order_id, transactions.merchant_id, transactions.user` |
| `9849fda62c5f` | 67 | 0.34 | 2.98 | 4.36 | `SELECT orders.id AS orders_id, orders.order_history_id AS orders_order_history_id, orders.` |
| `0cee598aa8a6` | 78 | 0.28 | 2.62 | 4.19 | `SELECT orders.id, orders.order_history_id, orders.user_id, orders.merchant_id, orders.stat` |
| `682e92a627f7` | 60 | 0.21 | 2.37 | 2.60 | `SELECT current_orders.id, current_orders.order_id, current_orders.merchant_id, current_ord` |
| `56bc2aa50c4e` | 114 | 0.23 | 2.24 | 2.95 | `SELECT mobile_credentials.id AS mobile_credentials_id, mobile_credentials.user_id AS mobil` |
| `6cb065d8f445` | 30 | 0.28 | 2.06 | 5.78 | `SELECT orders.id AS orders_id, orders.order_history_id AS orders_order_history_id, orders.` |

### EXPLAIN ANALYZE on key queries

| Query | Median exec (ms) | Sequential scans | Indexes used |
|---|---|---|---|
| merchant listing (GET /merchants) | 0.038 | merchants (50 rows); merchant_applications (0 rows) | none |
| product listing (GET /merchants/{id}/produce) | 0.014 | none | ix_produces_merchant_id |
| buyer current orders (GET /orders/me/current) | 0.073 | order_histories (1 rows) | ix_orders_order_history_id; ix_current_orders_order_id |
| merchant orders (GET /merchants/me/orders) | 0.542 | current_orders (5000 rows); backend_users (250 rows) | ix_orders_merchant_id |
| merchant paid queue (GET /orders/merchant/current) | 0.094 | none | ix_current_orders_merchant_id; ix_transactions_order_id; ix_orders_id |
| stale reservation scan (POST /orders/me/place) | 0.011 | none | ix_orders_status |
| order lookup (GET /tracking/{id}) | 0.02 | order_histories (1 rows) | ix_orders_id |
| stock lock (POST /orders/me/place) | 0.021 | none | ix_produces_id |
| stock update (POST /orders/me/place) | 0.036 | none | ix_produces_id |

### SQL statements per request

| Endpoint | Requests | Mean statements |
|---|---|---|
| `GET /merchants` | 81 | 102.2 |
| `GET /orders/me/current` | 81 | 77.8 |
| `GET /orders/me/history` | 82 | 48.7 |
| `GET /orders/merchant/current` | 36 | 27.4 |
| `POST /orders/me/place` | 84 | 11.2 |
| `PATCH /merchants/me/orders/{order_id}/status` | 31 | 11.0 |
| `GET /merchants/me/performance` | 36 | 11.0 |
| `POST /payments/checkout/{order_id}` | 81 | 10.4 |
| `PUT /carts/me` | 82 | 6.2 |
| `GET /tracking/{order_id}` | 69 | 3.1 |
| `GET /merchants/me/orders` | 36 | 3.1 |
| `GET /merchants/{merchant_id}` | 85 | 2.9 |
| `POST /auth/mobile/sign-in` | 119 | 2.0 |
| `GET /merchants/{merchant_id}/produce` | 80 | 2.0 |
| `GET /carts/me` | 83 | 2.0 |
| `GET /merchants/{merchant_id}/shoppage` | 81 | 1.0 |

## Order status latency

Measured at the API: a buyer session polls `GET /orders/me/current` while the merchant updates the order. The upper bound starts when the PATCH is sent and the lower bound when its response arrives; the commit is between them. Measured on an idle server.

| Buyer polling | Transition | n | Not seen | Lower bound p50 (ms) | Upper bound p50 (ms) | Upper bound p95 (ms) | Upper bound max (ms) | PATCH p95 (ms) | Target (ms) | Met? |
|---|---|---|---|---|---|---|---|---|---|---|
| 50 ms | out_for_delivery | 30 | 0 | 68 | 77 | 100 | 102 | 25 | 5000 | Yes |
| 50 ms | shipped | 30 | 0 | 63 | 71 | 98 | 104 | 29 | 5000 | Not judged (stubbed) |
| 3000 ms | out_for_delivery | 30 | 0 | 1,441 | 1,453 | 2,871 | 2,994 | 14 | 5000 | Yes |
| 3000 ms | shipped | 30 | 0 | 1,854 | 1,867 | 2,892 | 2,896 | 14 | 5000 | Not judged (stubbed) |

### PayMongo webhook handler (signed replay)

| n | Failed | p50 (ms) | p95 (ms) | Max (ms) | Target (ms) | Met? |
|---|---|---|---|---|---|---|
| 30 | 0 | 22 | 32 | 33 | 1000 | Yes |

## Time inside third-party and solver calls

Compare with the endpoint's total to attribute delay to the provider or to our code.

| Call | Concurrency | n | p50 (ms) | p95 (ms) | Max (ms) |
|---|---|---|---|---|---|
| `alns.compute_route` | 10 | 21 | 0.00 | 0.00 | 0.00 |
| `alns.compute_route` | 25 | 9 | 0.00 | 0.00 | 0.00 |
| `mapbox.directions` | 10 | 21 | 0.00 | 0.00 | 0.00 |
| `mapbox.directions` | 25 | 9 | 0.00 | 0.00 | 0.00 |
| `mapbox.geocode` | 10 | 42 | 0.01 | 0.01 | 0.02 |
| `mapbox.geocode` | 25 | 18 | 0.01 | 0.02 | 0.02 |
| `paymongo.create_checkout_session` | 1 | 8 | 0.01 | 0.02 | 0.02 |
| `paymongo.create_checkout_session` | 10 | 56 | 0.01 | 0.02 | 0.02 |
| `paymongo.create_checkout_session` | 25 | 18 | 0.01 | 0.01 | 0.01 |
