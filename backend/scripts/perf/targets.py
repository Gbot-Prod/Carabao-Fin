"""SOP 3 pass/fail thresholds. Fix these before collecting data, then don't edit.

Anchors: Nielsen's response-time limits (0.1 s instant, 1 s keeps flow, 10 s
attention), Google's RAIL model, and ISO/IEC 25010 time behaviour.
"""

P95_TARGET_MS = {
    "read": 500,
    "write": 1000,
    # Calls a third party (PayMongo or Mapbox) inside the request.
    "external": 2000,
    "db_query": 100,
    "order_status": 5000,
}
MAX_ERROR_RATE = 0.01
# A p95 from fewer samples is too noisy to judge against a target.
MIN_SAMPLES = 30

# Endpoint -> the third party it calls inside the request.
EXTERNAL_ENDPOINTS = {
    "POST /payments/checkout/{order_id}": "paymongo",
    "PATCH /merchants/me/orders/{order_id}/status": "mapbox",
}


def endpoint_class(endpoint: str) -> str:
    if endpoint in EXTERNAL_ENDPOINTS:
        return "external"
    return "read" if endpoint.startswith("GET ") else "write"
