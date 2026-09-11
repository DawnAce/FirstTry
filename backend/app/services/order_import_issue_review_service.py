"""导入中的期号人工核对：缓存依据、刊期冲突校验及订单审计。"""

from collections import defaultdict
from typing import TypedDict

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Order, OrderEventType, PublicationSchedule
from app.services.order_event_logger import log_event


class IssueReview(TypedDict):
    suggested_issue_number: int | None
    suggested_publish_date: str | None
    reason: str


class IssueOption(TypedDict):
    issue_number: int
    publish_date: str


def issue_review_options(schedule: list[PublicationSchedule]) -> list[IssueOption]:
    """仅提供刊期表中唯一、非休刊的期号，日期作为确认时的冲突快照。"""
    by_number: dict[int, list[PublicationSchedule]] = defaultdict(list)
    for entry in schedule:
        if entry.issue_number is not None:
            by_number[entry.issue_number].append(entry)
    return sorted([
        {"issue_number": number, "publish_date": entries[0].publish_date.isoformat()}
        for number, entries in by_number.items()
        if len(entries) == 1 and not entries[0].is_suspended
    ], key=lambda option: option["publish_date"], reverse=True)


def apply_issue_reviews(
    db: Session, rows: list[dict], options: list[IssueOption], confirmed: dict[str, int],
) -> None:
    """在会话副本上应用逐明细确认；校验完成前不写入任何订单。"""
    required = {
        f'{row["order_create"]["external_order_no"]}#{index}': (row, int(index), review)
        for row in rows for index, review in row.get("issue_reviews", {}).items()
    }
    if confirmed.keys() - required.keys():
        raise HTTPException(409, "期号核对明细与当前预览不一致，请重新预览后逐条核对期号")
    missing = required.keys() - confirmed.keys()
    if missing:
        raise HTTPException(409, f"还有 {len(missing)} 条明细未核对期号，请在预览中确认或修改期号后再导入")
    if not required:
        return

    expected_dates = {option["issue_number"]: option["publish_date"] for option in options}
    if any(type(number) is not int or number <= 0 or number not in expected_dates for number in confirmed.values()):
        raise HTTPException(422, "核对期号必须选择本次预览刊期表中的有效期号；如需补刊期表，请补齐后重新预览")
    current: dict[int, list[PublicationSchedule]] = defaultdict(list)
    for entry in db.query(PublicationSchedule).filter(
        PublicationSchedule.issue_number.in_(set(confirmed.values()))
    ).order_by(PublicationSchedule.id).populate_existing().with_for_update().all():
        current[entry.issue_number].append(entry)
    for number in set(confirmed.values()):
        entries = current[number]
        if (len(entries) != 1 or entries[0].is_suspended
                or entries[0].publish_date.isoformat() != expected_dates[number]):
            raise HTTPException(409, f"第 {number} 期的刊期表已变化，请重新预览后核对期号")

    for key, (row, index, review) in required.items():
        number = confirmed[key]
        row["order_create"]["items"][index]["issue_number"] = number
        row.setdefault("confirmed_issue_reviews", []).append({
            **review, "item_index": index, "issue_number": number,
            "publish_date": expected_dates[number],
        })


def log_import_issue_reviews(db: Session, order: Order, row: dict, operator_id: int | None) -> None:
    """复用明细审计事件，原始来源快照不变；与整批订单同事务提交。"""
    if not row.get("confirmed_issue_reviews"):
        return
    items = sorted(order.items, key=lambda item: item.id)
    for review in row["confirmed_issue_reviews"]:
        before, after = review["suggested_issue_number"], review["issue_number"]
        suggestion = f"第 {before} 期" if before is not None else "未能判定"
        log_event(db, order_id=order.id, event_type=OrderEventType.item_modified,
                  operator_id=operator_id, payload={
                      "operation": "import_issue_review", "during_import": True,
                      "item_id": items[review["item_index"]].id,
                      "suggested_issue_number": before,
                      "suggested_publish_date": review["suggested_publish_date"],
                      "issue_number": after, "publish_date": review["publish_date"],
                      "review_reason": review["reason"],
                      "field_diff": {"issue_number": {"before": before, "after": after}} if before != after else {},
                      "targets_changed": False,
                      "change_reason": "导入时人工核对期号",
                      "summary": f"期号已核对：自动建议{suggestion}，人工确认第 {after} 期（{review['publish_date']} 出版）",
                  })
