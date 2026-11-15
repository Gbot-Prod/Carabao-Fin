from fastapi import APIRouter

from app.api.webhooks.paymongo import router as paymongo_webhook_router

from .admin import router as admin_router
from .admin_audit import router as admin_audit_router
from .admin_orders import router as admin_orders_router
from .admin_transactions import router as admin_transactions_router
from .admin_produce import router as admin_produce_router
from .auth import router as auth_router
from .carts import router as carts_router
from .chat import router as chat_router
from .demand_insight import router as demand_insight_router
from .email import router as email_router
from .follows import router as follows_router
from .merchant_onboarding import router as merchant_onboarding_router
from .merchant_sales import router as merchant_sales_router
from .merchants import router as merchants_router
from .misc import router as misc_router
from .notifications import router as notifications_router
from .orders import router as orders_router
from .payments import router as payments_router
from .produce_search import router as produce_search_router
from .reference_prices import router as reference_prices_router
from .reorder import router as reorder_router
from .reviews import router as reviews_router
from .shipments import router as shipments_router
from .sms import router as sms_router
from .stock_alerts import router as stock_alerts_router
from .support_chat import router as support_chat_router
from .tracking import router as tracking_router
from .user_addresses import router as user_addresses_router
from .users import router as users_router

router = APIRouter()

# Keep paths exactly the same by not using prefixes here.
router.include_router(produce_search_router)
router.include_router(reorder_router)
router.include_router(follows_router)
router.include_router(notifications_router)
router.include_router(chat_router)
router.include_router(support_chat_router)
router.include_router(stock_alerts_router)
router.include_router(merchant_sales_router)
router.include_router(demand_insight_router)
router.include_router(admin_router)
router.include_router(admin_orders_router)
router.include_router(admin_transactions_router)
router.include_router(admin_audit_router)
router.include_router(admin_produce_router)
router.include_router(email_router)
router.include_router(misc_router)
router.include_router(merchant_onboarding_router)
router.include_router(merchants_router)
router.include_router(users_router)
router.include_router(user_addresses_router)
router.include_router(carts_router)
router.include_router(orders_router)
router.include_router(reviews_router)
router.include_router(auth_router)
router.include_router(sms_router)
router.include_router(shipments_router)
router.include_router(tracking_router)
router.include_router(payments_router)
router.include_router(reference_prices_router)
router.include_router(paymongo_webhook_router)
