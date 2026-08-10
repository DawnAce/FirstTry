from pydantic import BaseModel, computed_field
from typing import Optional, Any
from datetime import datetime


# 机器 action key -> 中文「操作内容」标签。读取时派生，不落库（避免回填历史行）。
ACTION_LABELS: dict[str, str] = {
    "create": "新增发货明细",
    "update": "修改发货明细",
    "delete": "删除发货明细",
    "ship": "标记已发货",
    "unship": "撤销已发货",
    "batch_copy": "复制上期发货明细",
    "batch_delete_issue": "清空本期发货明细",
    "replace_shipping": "重新上传中通明细",
    "ship_batch": "批量标记已发货",
    "confirm": "确认发货明细",
    "revoke": "作废报数确认",
    "export_report": "导出报数数据",
    "export_shipping": "导出发货明细",
    "export_all": "导出全部数据",
    "create_issue": "新建期数",
    "delete_issue": "删除期数",
    "normalize_addresses": "批量规整收件地址",
    "import_history": "导入历史数据",
    "upload_source": "上传报数来源文件",
    "delete_source": "撤销报数来源文件",
    "confirm_source": "确认来源识别与映射",
    "import_waybills": "导入运单",
    "review_waybill": "核对并修改运单信息",
    "add_waybill_row": "补录运单信息",
    "bulk_match_waybills": "批量关联运单与发货明细",
    "add_package": "补录运单",
    "delete_package": "删除运单",
    "set_shipping_requirement": "调整发货要求",
    "delete_order": "删除订单",
    "skip": "跳过本次发货同步",
    "attribute": "关联无需发货记录",
    "bulk_create": "登记月底合寄明细",
    "create_consolidated": "完成月底合寄发货",
    "transfer_quantity": "调整发货计划份数",
}


class OperationLogOut(BaseModel):
    id: int
    table_name: str
    record_id: int
    record_name: Optional[str] = None
    action: str
    changes: Optional[Any] = None
    user_id: Optional[int] = None
    username: Optional[str] = None
    issue_number: Optional[int] = None
    channel: Optional[str] = None
    status: str = "success"
    created_at: Optional[datetime] = None

    @computed_field
    @property
    def action_label(self) -> str:
        """中文操作内容，从 action 派生（不落库）。"""
        return ACTION_LABELS.get(self.action, self.action)

    model_config = {"from_attributes": True}
