# SOP 3 performance results

> **Mapbox and Paymongo stubbed.** Those calls were skipped, so these numbers are not end-to-end for the rows that depend on them, and those rows are not judged.

**50 targets met, 0 missed, 23 not judged.**

Run 20261105T062833Z at commit `d0a0a6f` on Windows-10-10.0.19045-SP0 (20 logical CPUs), PostgreSQL 18.2 on 127.0.0.1, 1 uvicorn worker. 60 s measured after 15 s warm-up, 1 repeat(s) pooled per level.

Uncommitted files: M backend/app/api/routes/_order_helpers.py,  M backend/app/api/routes/auth.py,  M backend/app/api/routes/carts.py,  M backend/app/api/routes/email.py,  M backend/app/api/routes/merchant_onboarding.py,  M backend/app/api/routes/merchants.py,  M backend/app/api/routes/orders.py,  M backend/app/api/routes/payments.py,  M backend/app/api/routes/shipments.py,  M backend/app/api/routes/sms.py,  M backend/app/api/routes/tracking.py,  M backend/app/api/routes/users.py,  M backend/app/api/webhooks/paymongo.py,  M backend/app/models/transaction.py,  M backend/app/services/order_reservations.py,  M backend/app/utils/geocoding.py,  M backend/pyproject.toml,  M backend/tests/test_shipment_matrix.py,  M backend/uv.lock, ?? backend/scripts/perf/, ?? backend/scripts/results/perf/, ?? backend/tests/test_route_concurrency.py.

## API response time, client side (Locust)

### Load summary, all endpoints

Throughput should rise with concurrency. If it falls, the system is saturated, even if few errors were recorded. The limit here is the loosest endpoint target.

| Concurrency | Requests | Req/s | p50 (ms) | p95 (ms) | Max (ms) | Errors | Pool timeouts | p95 <= 2000 ms and errors < 1%? |
|---|---|---|---|---|---|---|---|---|
| 1 | 81 | 1.4 | 6 | 172 | 175 | 0 (0.00%) | 0 | Yes |
| 10 | 811 | 13.5 | 7 | 171 | 184 | 0 (0.00%) | 0 | Yes |
| 25 | 2027 | 33.8 | 7 | 170 | 237 | 0 (0.00%) | 0 | Yes |
| 50 | 3829 | 63.8 | 14 | 335 | 840 | 0 (0.00%) | 0 | Yes |

### Per endpoint

| Endpoint | Concurrency | n | p50 (ms) | p95 (ms) | Max (ms) | Errors | Target (ms) | Met? |
|---|---|---|---|---|---|---|---|---|
| `GET /carts/me` | 1 | 7 | 3 | 3 | 4 | 0 (0.0%) | 500 | Not judged (n<30) |
| `GET /carts/me` | 10 | 58 | 3 | 6 | 7 | 0 (0.0%) | 500 | Yes |
| `GET /carts/me` | 25 | 141 | 3 | 6 | 58 | 0 (0.0%) | 500 | Yes |
| `GET /carts/me` | 50 | 269 | 5 | 119 | 368 | 0 (0.0%) | 500 | Yes |
| `GET /merchants` | 1 | 7 | 21 | 22 | 22 | 0 (0.0%) | 500 | Not judged (n<30) |
| `GET /merchants` | 10 | 57 | 22 | 57 | 64 | 0 (0.0%) | 500 | Yes |
| `GET /merchants` | 25 | 145 | 22 | 59 | 87 | 0 (0.0%) | 500 | Yes |
| `GET /merchants` | 50 | 268 | 30 | 342 | 489 | 0 (0.0%) | 500 | Yes |
| `GET /merchants/me/orders` | 10 | 29 | 8 | 10 | 10 | 0 (0.0%) | 500 | Not judged (n<30) |
| `GET /merchants/me/orders` | 25 | 69 | 8 | 14 | 60 | 0 (0.0%) | 500 | Yes |
| `GET /merchants/me/orders` | 50 | 133 | 10 | 265 | 477 | 0 (0.0%) | 500 | Yes |
| `GET /merchants/me/performance` | 10 | 29 | 7 | 9 | 74 | 0 (0.0%) | 500 | Not judged (n<30) |
| `GET /merchants/me/performance` | 25 | 69 | 7 | 12 | 81 | 0 (0.0%) | 500 | Yes |
| `GET /merchants/me/performance` | 50 | 133 | 11 | 375 | 638 | 0 (0.0%) | 500 | Yes |
| `GET /merchants/{merchant_id}` | 1 | 7 | 3 | 4 | 4 | 0 (0.0%) | 500 | Not judged (n<30) |
| `GET /merchants/{merchant_id}` | 10 | 57 | 4 | 6 | 8 | 0 (0.0%) | 500 | Yes |
| `GET /merchants/{merchant_id}` | 25 | 145 | 4 | 8 | 82 | 0 (0.0%) | 500 | Yes |
| `GET /merchants/{merchant_id}` | 50 | 268 | 7 | 169 | 507 | 0 (0.0%) | 500 | Yes |
| `GET /merchants/{merchant_id}/produce` | 1 | 7 | 2 | 3 | 3 | 0 (0.0%) | 500 | Not judged (n<30) |
| `GET /merchants/{merchant_id}/produce` | 10 | 57 | 3 | 4 | 8 | 0 (0.0%) | 500 | Yes |
| `GET /merchants/{merchant_id}/produce` | 25 | 145 | 3 | 7 | 15 | 0 (0.0%) | 500 | Yes |
| `GET /merchants/{merchant_id}/produce` | 50 | 268 | 5 | 208 | 442 | 0 (0.0%) | 500 | Yes |
| `GET /merchants/{merchant_id}/shoppage` | 1 | 7 | 2 | 2 | 2 | 0 (0.0%) | 500 | Not judged (n<30) |
| `GET /merchants/{merchant_id}/shoppage` | 10 | 57 | 2 | 4 | 19 | 0 (0.0%) | 500 | Yes |
| `GET /merchants/{merchant_id}/shoppage` | 25 | 145 | 2 | 17 | 18 | 0 (0.0%) | 500 | Yes |
| `GET /merchants/{merchant_id}/shoppage` | 50 | 268 | 5 | 208 | 394 | 0 (0.0%) | 500 | Yes |
| `GET /orders/me/current` | 1 | 6 | 13 | 45 | 55 | 0 (0.0%) | 500 | Not judged (n<30) |
| `GET /orders/me/current` | 10 | 55 | 11 | 14 | 46 | 0 (0.0%) | 500 | Yes |
| `GET /orders/me/current` | 25 | 140 | 11 | 22 | 81 | 0 (0.0%) | 500 | Yes |
| `GET /orders/me/current` | 50 | 275 | 14 | 232 | 352 | 0 (0.0%) | 500 | Yes |
| `GET /orders/me/history` | 1 | 6 | 6 | 7 | 7 | 0 (0.0%) | 500 | Not judged (n<30) |
| `GET /orders/me/history` | 10 | 55 | 6 | 9 | 24 | 0 (0.0%) | 500 | Yes |
| `GET /orders/me/history` | 25 | 140 | 6 | 11 | 90 | 0 (0.0%) | 500 | Yes |
| `GET /orders/me/history` | 50 | 275 | 10 | 224 | 398 | 0 (0.0%) | 500 | Yes |
| `GET /orders/merchant/current` | 10 | 29 | 8 | 10 | 12 | 0 (0.0%) | 500 | Not judged (n<30) |
| `GET /orders/merchant/current` | 25 | 69 | 8 | 16 | 93 | 0 (0.0%) | 500 | Yes |
| `GET /orders/merchant/current` | 50 | 133 | 11 | 285 | 405 | 0 (0.0%) | 500 | Yes |
| `GET /tracking/{order_id}` | 1 | 6 | 4 | 4 | 5 | 0 (0.0%) | 500 | Not judged (n<30) |
| `GET /tracking/{order_id}` | 10 | 48 | 4 | 5 | 6 | 0 (0.0%) | 500 | Yes |
| `GET /tracking/{order_id}` | 25 | 117 | 4 | 8 | 22 | 0 (0.0%) | 500 | Yes |
| `GET /tracking/{order_id}` | 50 | 223 | 6 | 172 | 470 | 0 (0.0%) | 500 | Yes |
| `PATCH /merchants/me/orders/{order_id}/status` | 10 | 22 | 10 | 16 | 16 | 0 (0.0%) | 2000 | Not judged (stubbed) |
| `PATCH /merchants/me/orders/{order_id}/status` | 25 | 59 | 11 | 31 | 87 | 0 (0.0%) | 2000 | Not judged (stubbed) |
| `PATCH /merchants/me/orders/{order_id}/status` | 50 | 108 | 17 | 262 | 468 | 0 (0.0%) | 2000 | Not judged (stubbed) |
| `POST /auth/mobile/sign-in` | 1 | 7 | 172 | 175 | 175 | 0 (0.0%) | 1000 | Not judged (n<30) |
| `POST /auth/mobile/sign-in` | 10 | 86 | 171 | 178 | 184 | 0 (0.0%) | 1000 | Yes |
| `POST /auth/mobile/sign-in` | 25 | 214 | 170 | 182 | 237 | 0 (0.0%) | 1000 | Yes |
| `POST /auth/mobile/sign-in` | 50 | 401 | 175 | 554 | 840 | 0 (0.0%) | 1000 | Yes |
| `POST /orders/me/place` | 1 | 7 | 10 | 14 | 16 | 0 (0.0%) | 1000 | Not judged (n<30) |
| `POST /orders/me/place` | 10 | 57 | 11 | 18 | 26 | 0 (0.0%) | 1000 | Yes |
| `POST /orders/me/place` | 25 | 144 | 10 | 19 | 78 | 0 (0.0%) | 1000 | Yes |
| `POST /orders/me/place` | 50 | 269 | 14 | 390 | 644 | 0 (0.0%) | 1000 | Yes |
| `POST /payments/checkout/{order_id}` | 1 | 7 | 7 | 11 | 11 | 0 (0.0%) | 2000 | Not judged (stubbed) |
| `POST /payments/checkout/{order_id}` | 10 | 57 | 8 | 13 | 45 | 0 (0.0%) | 2000 | Not judged (stubbed) |
| `POST /payments/checkout/{order_id}` | 25 | 144 | 8 | 15 | 42 | 0 (0.0%) | 2000 | Not judged (stubbed) |
| `POST /payments/checkout/{order_id}` | 50 | 269 | 13 | 369 | 571 | 0 (0.0%) | 2000 | Not judged (stubbed) |
| `PUT /carts/me` | 1 | 7 | 6 | 7 | 7 | 0 (0.0%) | 1000 | Not judged (n<30) |
| `PUT /carts/me` | 10 | 58 | 8 | 12 | 154 | 0 (0.0%) | 1000 | Yes |
| `PUT /carts/me` | 25 | 141 | 7 | 15 | 51 | 0 (0.0%) | 1000 | Yes |
| `PUT /carts/me` | 50 | 269 | 11 | 249 | 509 | 0 (0.0%) | 1000 | Yes |

## Client vs server time

The gap is network, connection setup and time spent queued before the server's middleware runs. Each p95 comes from its own samples, so small negative gaps are noise.

| Endpoint | Concurrency | Client p95 (ms) | Server p95 (ms) | Outside app code (ms) |
|---|---|---|---|---|
| `GET /carts/me` | 1 | 3 | 3 | 0 |
| `GET /carts/me` | 10 | 6 | 6 | 0 |
| `GET /carts/me` | 25 | 6 | 7 | -1 |
| `GET /carts/me` | 50 | 119 | 220 | -101 |
| `GET /merchants` | 1 | 22 | 22 | 0 |
| `GET /merchants` | 10 | 57 | 57 | 0 |
| `GET /merchants` | 25 | 59 | 59 | 0 |
| `GET /merchants` | 50 | 342 | 362 | -20 |
| `GET /merchants/me/orders` | 10 | 10 | 10 | -1 |
| `GET /merchants/me/orders` | 25 | 14 | 15 | -1 |
| `GET /merchants/me/orders` | 50 | 265 | 296 | -31 |
| `GET /merchants/me/performance` | 10 | 9 | 8 | 0 |
| `GET /merchants/me/performance` | 25 | 12 | 11 | 0 |
| `GET /merchants/me/performance` | 50 | 375 | 400 | -24 |
| `GET /merchants/{merchant_id}` | 1 | 4 | 4 | 0 |
| `GET /merchants/{merchant_id}` | 10 | 6 | 7 | -1 |
| `GET /merchants/{merchant_id}` | 25 | 8 | 10 | -1 |
| `GET /merchants/{merchant_id}` | 50 | 169 | 237 | -67 |
| `GET /merchants/{merchant_id}/produce` | 1 | 3 | 3 | 0 |
| `GET /merchants/{merchant_id}/produce` | 10 | 4 | 4 | 0 |
| `GET /merchants/{merchant_id}/produce` | 25 | 7 | 6 | 0 |
| `GET /merchants/{merchant_id}/produce` | 50 | 208 | 232 | -24 |
| `GET /merchants/{merchant_id}/shoppage` | 1 | 2 | 2 | 0 |
| `GET /merchants/{merchant_id}/shoppage` | 10 | 4 | 5 | 0 |
| `GET /merchants/{merchant_id}/shoppage` | 25 | 17 | 16 | 1 |
| `GET /merchants/{merchant_id}/shoppage` | 50 | 208 | 232 | -24 |
| `GET /orders/me/current` | 1 | 45 | 44 | 1 |
| `GET /orders/me/current` | 10 | 14 | 14 | 0 |
| `GET /orders/me/current` | 25 | 22 | 22 | 0 |
| `GET /orders/me/current` | 50 | 232 | 255 | -23 |
| `GET /orders/me/history` | 1 | 7 | 7 | 0 |
| `GET /orders/me/history` | 10 | 9 | 10 | -1 |
| `GET /orders/me/history` | 25 | 11 | 13 | -2 |
| `GET /orders/me/history` | 50 | 224 | 239 | -15 |
| `GET /orders/merchant/current` | 10 | 10 | 9 | 0 |
| `GET /orders/merchant/current` | 25 | 16 | 16 | -1 |
| `GET /orders/merchant/current` | 50 | 285 | 315 | -30 |
| `GET /tracking/{order_id}` | 1 | 4 | 4 | 1 |
| `GET /tracking/{order_id}` | 10 | 5 | 6 | 0 |
| `GET /tracking/{order_id}` | 25 | 8 | 8 | 0 |
| `GET /tracking/{order_id}` | 50 | 172 | 222 | -50 |
| `PATCH /merchants/me/orders/{order_id}/status` | 10 | 16 | 15 | 1 |
| `PATCH /merchants/me/orders/{order_id}/status` | 25 | 31 | 30 | 1 |
| `PATCH /merchants/me/orders/{order_id}/status` | 50 | 262 | 285 | -23 |
| `POST /auth/mobile/sign-in` | 1 | 175 | 175 | 0 |
| `POST /auth/mobile/sign-in` | 10 | 178 | 177 | 1 |
| `POST /auth/mobile/sign-in` | 25 | 182 | 181 | 1 |
| `POST /auth/mobile/sign-in` | 50 | 554 | 589 | -34 |
| `POST /orders/me/place` | 1 | 14 | 14 | 1 |
| `POST /orders/me/place` | 10 | 18 | 19 | -1 |
| `POST /orders/me/place` | 25 | 19 | 19 | 0 |
| `POST /orders/me/place` | 50 | 390 | 461 | -71 |
| `POST /payments/checkout/{order_id}` | 1 | 11 | 10 | 1 |
| `POST /payments/checkout/{order_id}` | 10 | 13 | 13 | 0 |
| `POST /payments/checkout/{order_id}` | 25 | 15 | 16 | -2 |
| `POST /payments/checkout/{order_id}` | 50 | 369 | 399 | -30 |
| `PUT /carts/me` | 1 | 7 | 6 | 0 |
| `PUT /carts/me` | 10 | 12 | 12 | 0 |
| `PUT /carts/me` | 25 | 15 | 15 | 0 |
| `PUT /carts/me` | 50 | 249 | 314 | -65 |

## Database query execution time

| Concurrency | Queries | p50 (ms) | p95 (ms) | Max (ms) | Target | Met? |
|---|---|---|---|---|---|---|
| 1 | 365 | 0.27 | 0.59 | 4.77 | 100 | Yes |
| 10 | 3981 | 0.29 | 0.84 | 15.45 | 100 | Yes |
| 25 | 9922 | 0.30 | 1.10 | 61.92 | 100 | Yes |
| 50 | 18827 | 0.51 | 17.12 | 170.82 | 100 | Yes |

### 15 slowest statements by p95, all levels

| Id | n | p50 (ms) | p95 (ms) | Max (ms) | Statement |
|---|---|---|---|---|---|
| `1ecd80c1c559` | 477 | 1.11 | 47.01 | 165.80 | `SELECT produces.merchant_id, produces.id, produces.name, produces.description, produces.ca` |
| `cf7a6cba83fa` | 231 | 1.20 | 34.64 | 115.38 | `SELECT orders.id AS orders_id, orders.order_history_id AS orders_order_history_id, orders.` |
| `3715f609e5ec` | 477 | 0.80 | 28.67 | 97.42 | `SELECT merchants.id AS merchants_id, merchants.merchant_name AS merchants_merchant_name, m` |
| `d34b8163b9ea` | 14 | 0.50 | 23.20 | 37.27 | `SELECT orders.id, orders.order_history_id, orders.user_id, orders.merchant_id, orders.stat` |
| `2dd5973cb25c` | 45 | 0.57 | 22.36 | 33.88 | `SELECT merchants.id, merchants.merchant_name, merchants.contact_number, merchants.rating, ` |
| `a11b5b420924` | 954 | 0.50 | 19.21 | 75.63 | `SELECT merchants.id AS merchants_id, merchants.merchant_name AS merchants_merchant_name, m` |
| `90160554c582` | 231 | 0.79 | 17.88 | 41.11 | `SELECT current_orders.id AS current_orders_id, current_orders.order_id AS current_orders_o` |
| `ab3b5111cc1d` | 706 | 0.54 | 17.88 | 72.51 | `SELECT backend_users.id AS backend_users_id, backend_users.external_auth_id AS backend_use` |
| `bffc3283db56` | 12 | 1.19 | 17.38 | 26.87 | `SELECT merchants.id, merchants.merchant_name, merchants.contact_number, merchants.rating, ` |
| `9ea2690b0ddc` | 477 | 0.48 | 16.86 | 69.22 | `SELECT shop_pages.id AS shop_pages_id, shop_pages.merchant_id AS shop_pages_merchant_id, s` |
| `e90fdb956838` | 6 | 0.99 | 16.81 | 20.95 | `SELECT orders.id, orders.order_history_id, orders.user_id, orders.merchant_id, orders.stat` |
| `1950d2fe6ffa` | 34 | 0.49 | 16.32 | 29.68 | `SELECT orders.id, orders.order_history_id, orders.user_id, orders.merchant_id, orders.stat` |
| `d5e849707559` | 477 | 0.29 | 16.20 | 79.76 | `SELECT transactions.id, transactions.order_id, transactions.merchant_id, transactions.user` |
| `667dc65e4283` | 55 | 0.48 | 16.00 | 31.43 | `SELECT orders.id, orders.order_history_id, orders.user_id, orders.merchant_id, orders.stat` |
| `b810c1ce2177` | 4131 | 0.46 | 15.68 | 164.88 | `SELECT backend_users.id AS backend_users_id, backend_users.external_auth_id AS backend_use` |

### EXPLAIN ANALYZE on key queries

| Query | Median exec (ms) | Sequential scans | Indexes used |
|---|---|---|---|
| merchant listing (GET /merchants) | 0.042 | merchants (50 rows); merchant_applications (0 rows) | none |
| product listing (GET /merchants/{id}/produce) | 0.019 | none | ix_produces_merchant_id |
| buyer current orders (GET /orders/me/current) | 0.073 | order_histories (1 rows) | ix_orders_order_history_id; ix_current_orders_order_id |
| merchant orders (GET /merchants/me/orders) | 0.543 | current_orders (5000 rows); backend_users (250 rows) | ix_orders_merchant_id |
| merchant paid queue (GET /orders/merchant/current) | 0.096 | none | ix_current_orders_merchant_id; ix_transactions_order_id; ix_orders_id |
| stale reservation scan (POST /orders/me/place) | 0.007 | none | ix_orders_status |
| order lookup (GET /tracking/{id}) | 0.019 | order_histories (1 rows) | ix_orders_id |
| stock lock (POST /orders/me/place) | 0.018 | none | ix_produces_id |
| stock update (POST /orders/me/place) | 0.025 | none | ix_produces_id |

### SQL statements per request

| Endpoint | Requests | Mean statements |
|---|---|---|
| `GET /merchants/me/performance` | 236 | 11.0 |
| `PATCH /merchants/me/orders/{order_id}/status` | 192 | 11.0 |
| `POST /orders/me/place` | 481 | 10.0 |
| `POST /payments/checkout/{order_id}` | 481 | 10.0 |
| `GET /orders/merchant/current` | 236 | 8.0 |
| `GET /orders/me/current` | 490 | 7.0 |
| `PUT /carts/me` | 480 | 6.0 |
| `GET /orders/me/history` | 490 | 5.0 |
| `GET /tracking/{order_id}` | 406 | 3.0 |
| `GET /merchants` | 484 | 3.0 |
| `GET /merchants/{merchant_id}` | 484 | 3.0 |
| `GET /merchants/me/orders` | 236 | 3.0 |
| `POST /auth/mobile/sign-in` | 720 | 2.0 |
| `GET /merchants/{merchant_id}/produce` | 484 | 2.0 |
| `GET /carts/me` | 480 | 2.0 |
| `GET /merchants/{merchant_id}/shoppage` | 484 | 1.0 |

## Order status latency

Measured at the API: a buyer session polls `GET /orders/me/current` while the merchant updates the order. The upper bound starts when the PATCH is sent and the lower bound when its response arrives; the commit is between them. Measured on an idle server.

| Buyer polling | Transition | n | Not seen | Lower bound p50 (ms) | Upper bound p50 (ms) | Upper bound p95 (ms) | Upper bound max (ms) | PATCH p95 (ms) | Target (ms) | Met? |
|---|---|---|---|---|---|---|---|---|---|---|
| 50 ms | out_for_delivery | 30 | 0 | 32 | 41 | 68 | 71 | 13 | 5000 | Yes |
| 50 ms | shipped | 30 | 0 | 39 | 47 | 63 | 65 | 11 | 5000 | Not judged (stubbed) |
| 3000 ms | out_for_delivery | 30 | 0 | 1,485 | 1,495 | 2,822 | 2,933 | 13 | 5000 | Yes |
| 3000 ms | shipped | 30 | 0 | 1,590 | 1,601 | 2,778 | 2,913 | 13 | 5000 | Not judged (stubbed) |

### PayMongo webhook handler (signed replay)

| n | Failed | p50 (ms) | p95 (ms) | Max (ms) | Target (ms) | Met? |
|---|---|---|---|---|---|---|
| 30 | 0 | 21 | 27 | 34 | 1000 | Yes |

## Time inside third-party and solver calls

Compare with the endpoint's total to attribute delay to the provider or to our code.

| Call | Concurrency | n | p50 (ms) | p95 (ms) | Max (ms) |
|---|---|---|---|---|---|
| `alns.compute_route` | 10 | 22 | 0.00 | 0.00 | 0.00 |
| `alns.compute_route` | 25 | 59 | 0.00 | 0.00 | 0.00 |
| `alns.compute_route` | 50 | 107 | 0.00 | 0.00 | 0.01 |
| `mapbox.directions` | 10 | 22 | 0.00 | 0.00 | 0.00 |
| `mapbox.directions` | 25 | 59 | 0.00 | 0.00 | 0.00 |
| `mapbox.directions` | 50 | 107 | 0.00 | 0.00 | 0.01 |
| `mapbox.geocode` | 10 | 44 | 0.01 | 0.01 | 0.01 |
| `mapbox.geocode` | 25 | 118 | 0.00 | 0.01 | 0.02 |
| `mapbox.geocode` | 50 | 214 | 0.01 | 0.02 | 0.05 |
| `paymongo.create_checkout_session` | 1 | 7 | 0.01 | 0.02 | 0.02 |
| `paymongo.create_checkout_session` | 10 | 57 | 0.01 | 0.02 | 0.02 |
| `paymongo.create_checkout_session` | 25 | 144 | 0.01 | 0.02 | 0.03 |
| `paymongo.create_checkout_session` | 50 | 269 | 0.01 | 0.02 | 0.53 |
