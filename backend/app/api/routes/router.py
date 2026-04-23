from fastapi import APIRouter

from .auth import router as auth_router
from .carts import router as carts_router
from .email import router as email_router
from .merchant_onboarding import router as merchant_onboarding_router
from .merchants import router as merchants_router
from .misc import router as misc_router
from .orders import router as orders_router
from .payments import router as payments_router
from .sms import router as sms_router
from .tracking import router as tracking_router
from .users import router as users_router
from app.api.webhooks.paymongo import router as paymongo_webhook_router

router = APIRouter()

# Keep paths exactly the same by not using prefixes here.
router.include_router(email_router)
router.include_router(misc_router)
router.include_router(merchant_onboarding_router)
router.include_router(merchants_router)
router.include_router(users_router)
router.include_router(carts_router)
router.include_router(orders_router)
router.include_router(auth_router)
router.include_router(sms_router)
router.include_router(tracking_router)
router.include_router(payments_router)
router.include_router(paymongo_webhook_router)
