"""历史销售来源修复：只读预览、状态签名、显式保留主单、原子审计。

本工具只处理已知别名及未产生下游业务的重复单。原件版本、明细和旧关联不删除。
"""
from collections import defaultdict
from hashlib import sha256
import json
from typing import Any
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Order, OrderEvent, OrderEventType, OrderItem, OrderStatus, FulfillmentAllocation, FulfillmentTarget
from app.models.operation_log import OperationLog
from app.models.order_source import OrderSource, OrderSourceLink, OrderSourceVersion
from app.models.user import User, UserRole
from app.services.order_source_identity import SOURCE_CATALOG, normalize_source, serialized_identity
from app.services.order_source_service import source_event
from app.services.operation_log_service import record_operation


def _digest(value: Any) -> str:
    return sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def _record(row: Any) -> dict:
    return {column.name: getattr(row, column.name) for column in row.__table__.columns}


def _state(db: Session, *, lock: bool = False) -> dict:
    names = [name for rule in SOURCE_CATALOG for name in [rule['platform'], *rule['aliases']]]

    def rows(model: Any, condition: Any) -> list:
        query = db.query(model).filter(condition).order_by(model.id).populate_existing()
        return (query.with_for_update() if lock else query).all()

    orders = rows(Order, Order.source_platform.in_(names))
    ids = [row.id for row in orders]
    sources = rows(OrderSource, OrderSource.platform.in_(names))
    source_ids = [row.id for row in sources]
    links = rows(OrderSourceLink, or_(OrderSourceLink.source_id.in_(source_ids), OrderSourceLink.order_id.in_(ids)))
    items = rows(OrderItem, OrderItem.order_id.in_(ids))
    item_ids = [row.id for row in items]
    allocations = rows(FulfillmentAllocation, FulfillmentAllocation.order_item_id.in_(item_ids))
    targets = rows(FulfillmentTarget, FulfillmentTarget.order_item_id.in_(item_ids))
    versions = rows(OrderSourceVersion, OrderSourceVersion.source_id.in_(source_ids))
    # 扫描所有直接订单引用，新增财务／邮局表也默认受保护，而不遗漏旧表。
    related = {}
    for name, table in sorted(Base.metadata.tables.items()):
        if 'order_id' not in table.c or name in {'order_items', 'order_source_links'}:
            continue
        query = select(table).where(table.c.order_id.in_(ids)).order_by(table.c.id)
        related[name] = [dict(row) for row in db.execute(query.with_for_update() if lock else query).mappings()]
    state = dict(orders=orders, sources=sources, links=links, items=items, allocations=allocations, targets=targets, versions=versions)
    state['signature'] = _digest({**{key: [_record(row) for row in value] for key, value in state.items()}, 'related': related})
    state['related'] = related
    return state


def _groups(rows: list, *, source: bool = False) -> list[list]:
    grouped = defaultdict(list)
    for row in rows:
        if not source and row.status == OrderStatus.void:
            continue
        platform, store = normalize_source(row.platform, row.store) if source else normalize_source(row.source_platform, row.source_store)
        if row.external_order_no:
            grouped[(platform, store, row.external_order_no)].append(row)
    return [values for values in grouped.values() if len(values) > 1]


def _changes(state: dict) -> tuple[list[dict], list[dict]]:
    orders, sources = [], []
    for row in state['orders']:
        after = normalize_source(row.source_platform, row.source_store)
        if after != (row.source_platform, row.source_store):
            orders.append({'id': row.id, 'before': [row.source_platform, row.source_store], 'after': list(after)})
    for row in state['sources']:
        platform, store = normalize_source(row.platform, row.store)
        after = (platform, store or '')
        if after != (row.platform, row.store):
            sources.append({'id': row.id, 'before': [row.platform, row.store], 'after': list(after)})
    return orders, sources


def _preview(state: dict) -> dict:
    changes, sources = _changes(state)
    duplicates = []
    proposals = []
    for group in _groups(state['orders']):
        evidence = []
        for order in group:
            counts = {name: sum(row['order_id'] == order.id for row in rows) for name, rows in state['related'].items() if name != 'order_events'}
            evidence.append({'order_id': order.id, 'entry_method': order.entry_method.value,
                             'status': order.status.value, 'downstream_counts': {key: value for key, value in counts.items() if value}})
        candidates = [row['order_id'] for row in evidence if row['downstream_counts'].get('postal_delivery')]
        if len(candidates) != 1:
            candidates = [row['order_id'] for row in evidence if row['entry_method'] == 'manual']
        keep = candidates[0] if len(candidates) == 1 else None
        fields = ['order_date', 'paid_amount', 'total_amount', 'commercial_status', 'is_historical_archive']
        different = [field for field in fields if len({str(getattr(row, field)) for row in group}) > 1]
        for field in ['publication', 'delivery_method', 'coverage_start_date', 'coverage_end_date', 'total_quantity']:
            values = {tuple(sorted(str(getattr(item, field)) for item in state['items'] if item.order_id == row.id)) for row in group}
            if len(values) > 1:
                different.append('items.' + field)
        item_order = {item.id: item.order_id for item in state['items']}
        for field in ['recipient_name', 'recipient_phone', 'recipient_address']:
            values = {tuple(sorted(str(getattr(target, field)) for target in state['targets'] if item_order[target.order_item_id] == row.id)) for row in group}
            if len(values) > 1:
                different.append('targets.' + field)
        duplicates.append({'orders': evidence, 'different_fields': different,
                           'platform': normalize_source(group[0].source_platform, group[0].source_store)[0]})
        proposals.append({'keep_order_id': keep, 'duplicate_order_ids': [row.id for row in group if row.id != keep],
                          'keep_business_fields': False})
    return {'schema_version': 1, 'expected_state': state['signature'],
            'normalizations': {'orders': changes, 'sources': sources}, 'duplicate_groups': duplicates,
            'source_identity_conflicts': [[row.id for row in group] for group in _groups(state['sources'], source=True)],
            'resolutions': proposals}


def _order_event(db: Session, order_id: int, event_type: OrderEventType, payload: dict, operator_id: int) -> None:
    # 修复整批一次提交；无需像交互接口那样每条审计立即 flush。
    db.add(OrderEvent(order_id=order_id, event_type=event_type, payload_json=payload, operator_id=operator_id))


def preview_repair(db: Session) -> dict:
    """只读输出 IDs、分类及差异字段，不输出真实姓名、电话、地址、来源单号。"""
    if db.new or db.dirty or db.deleted:
        raise HTTPException(409, '修复预览必须使用没有未提交修改的独立会话')
    with db.no_autoflush:
        return {'plan_id': uuid4().hex, **_preview(_state(db))}


@serialized_identity
def apply_repair(db: Session, plan: dict, *, operator_id: int, reason: str) -> dict:
    """只接受已核对的主单选择；失败整批回滚，重复执行返回已有结果。"""
    try:
        operator = db.get(User, operator_id)
        if operator is None or operator.role != UserRole.admin:
            raise HTTPException(403, '销售来源修复需要管理员操作人')
        if not reason.strip() or plan.get('schema_version') != 1 or not plan.get('plan_id'):
            raise HTTPException(422, '请提供有效预览及修复原因')
        request_hash = _digest({'state': plan.get('expected_state'), 'resolutions': plan.get('resolutions'), 'reason': reason})
        previous = db.query(OperationLog).filter(OperationLog.action == 'identity_repair',
            OperationLog.changes['plan_id'].as_string() == plan['plan_id']).populate_existing().with_for_update().first()
        if previous:
            if previous.changes['request_hash'] != request_hash:
                raise HTTPException(409, '该预览已按另一份核对决定执行，不能复用')
            return {**previous.changes['result'], 'already_applied': True}
        state = _state(db, lock=True)
        if state['signature'] != plan.get('expected_state'):
            raise HTTPException(409, '预览后订单、来源或下游关联已变化，请重新生成修复预览')
        current = _preview(state)
        if current['source_identity_conflicts']:
            raise HTTPException(409, '规范化后来源原件身份冲突，需要单独核对，不能自动合并原件')
        groups = [{row.id for row in group} for group in _groups(state['orders'])]
        resolutions = plan.get('resolutions', [])
        if len(resolutions) != len(groups):
            raise HTTPException(422, '必须逐组核对所有重复订单')
        orders = {row.id: row for row in state['orders']}
        sources = {row.id: row for row in state['sources']}
        replacements = {}
        seen = set()
        for resolution in resolutions:
            keep = resolution.get('keep_order_id')
            drops = resolution.get('duplicate_order_ids', [])
            identities = {keep, *drops}
            if resolution.get('keep_business_fields') is not True or keep in drops or not drops or identities not in groups or seen & identities:
                raise HTTPException(422, '请逐组明确保留主单，并确认保留主单的日期、金额、订期和收件资料')
            seen.update(identities)
            for duplicate_id in drops:
                # 有财务、邮局、发货、投诉等下游时，不能靠更改订单 ID 猜测迁移。
                for name, rows in state['related'].items():
                    if name != 'order_events' and any(row['order_id'] == duplicate_id for row in rows):
                        raise HTTPException(409, f'重复订单 {duplicate_id} 已有 {name} 关联，需单独处理')
                for link in state['links']:
                    if link.order_id == duplicate_id and link.active:
                        source = sources.get(link.source_id)
                        if source is None or source.kind != 'subscription' or link.order_item_id or link.target_id or link.refund_amount or link.delivery_from_issue:
                            raise HTTPException(409, '重复订单已有明细级、运费或退款关联，需单独核对')
                replacements[duplicate_id] = keep
        # 所有保护检查都在首次修改前完成；原始版本、履约明细及邮局引用保持原记录。
        audit = {'repair_id': plan['plan_id'], 'reason': reason}
        for change in current['normalizations']['orders']:
            row = orders[change['id']]
            row.source_platform, row.source_store = change['after']
            _order_event(db, row.id, OrderEventType.modified, {**audit, 'diff': {
                'source_platform': {'from': change['before'][0], 'to': change['after'][0]},
                'source_store': {'from': change['before'][1], 'to': change['after'][1]},
            }}, operator_id)
        for change in current['normalizations']['sources']:
            source = sources[change['id']]
            source.platform, source.store = change['after']
            source.lock_version += 1
            source_event(db, source, 'identity_normalized', {**audit, 'before': change['before'], 'after': change['after']}, operator_id)
        moved = 0
        new_link_keys = set()
        for link in state['links']:
            if not link.active or link.order_id not in replacements:
                continue
            keep = replacements[link.order_id]
            if (link.source_id, keep) in new_link_keys or any(other.active and other.source_id == link.source_id and other.order_id == keep for other in state['links']):
                raise HTTPException(409, '保留订单已有相同来源关联，需先核对金额归属')
            new_link_keys.add((link.source_id, keep))
            link.active = 0
            new_link = OrderSourceLink(source_id=link.source_id, order_id=keep, amount=link.amount,
                                      active=1, reason=reason, created_by=operator_id)
            db.add(new_link)
            db.flush()
            source = sources[link.source_id]
            source.lock_version += 1
            source_event(db, source, 'identity_order_relinked', {**audit, 'old_link_id': link.id,
                'new_link_id': new_link.id, 'from_order_id': link.order_id, 'to_order_id': keep}, operator_id)
            moved += 1
        for duplicate_id, keep in replacements.items():
            orders[duplicate_id].status = OrderStatus.void
            _order_event(db, duplicate_id, OrderEventType.voided, {**audit, 'merged_into_order_id': keep,
                      'orphaned_shipping_details': 0}, operator_id)
            _order_event(db, keep, OrderEventType.modified, {**audit, 'duplicate_order_id': duplicate_id,
                      'business_fields_preserved': True}, operator_id)
        result = {'normalized_orders': len(current['normalizations']['orders']),
                  'normalized_sources': len(current['normalizations']['sources']),
                  'voided_orders': len(replacements), 'moved_source_links': moved, 'already_applied': False}
        record_operation(db, table_name='order_sources', record_id=0, action='identity_repair', user=operator,
                         changes={'plan_id': plan['plan_id'], 'request_hash': request_hash, 'result': result})
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise
