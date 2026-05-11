from pydantic import BaseModel
from typing import Optional, Any
from datetime import datetime


class OperationLogOut(BaseModel):
    id: int
    table_name: str
    record_id: int
    record_name: Optional[str]
    action: str
    changes: Optional[Any]
    user_id: Optional[int]
    username: Optional[str]
    created_at: Optional[datetime]

    model_config = {"from_attributes": True}
