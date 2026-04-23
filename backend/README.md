## Backend (FastAPI)

### Required environment variables

- `DATABASE_URL`
- `FASTAPI_JWT_SECRET`
- `AUTH_SYNC_SHARED_SECRET`
- `ALLOWED_ORIGINS` (comma-separated origins, e.g. `https://your-frontend.app`)
- `FRONTEND_URL` (used for PayMongo success/cancel redirects)
- `PAYMONGO_SECRET_KEY` (required for `/payments/checkout/{order_id}`)
- `PAYMONGO_WEBHOOK_SECRET` (required for webhook signature verification)

### Checkout troubleshooting

If clicking “Online Payment” fails with a `502`/`500` from `/payments/checkout/{order_id}`:

- Verify `PAYMONGO_SECRET_KEY` is set on the deployed backend.
- Verify `FRONTEND_URL` is set to your deployed frontend origin (must be a valid `http(s)` URL).
- Check backend logs for PayMongo’s response body when the API returns a `502`.
