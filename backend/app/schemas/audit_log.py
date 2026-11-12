from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class AuditLogEntry(BaseModel):
    id: int
    admin_id: int | None
    admin_email: str
    action: str
    target_type: str
    target_id: int | None
    before: dict[str, Any] | None
    after: dict[str, Any] | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
