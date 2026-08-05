"""Unified order timeline assembled from order and postal audit sources."""

from sqlalchemy.orm import Session

from app.models import (
    OrderEvent,
    PostalComplaintHandlingRecord,
    PostalTicket,
    PostalTicketEventType,
    PostalTicketType,
)
from app.services.postal_ticket_service import linked_to_order_clause


def _value(value):
    return value.value if hasattr(value, "value") else value


def _delivery_no(external_order_no):
    if external_order_no and "-" in external_order_no:
        return external_order_no.split("-", 1)[1]
    return external_order_no


def _ticket_created_type(ticket_type) -> str:
    return {
        PostalTicketType.complaint.value: "postal_complaint_created",
        PostalTicketType.address.value: "postal_address_change_created",
        PostalTicketType.follow.value: "postal_follow_up_created",
    }[_value(ticket_type)]


def _ticket_event_type(event_type) -> str:
    return {
        PostalTicketEventType.handling.value: "postal_complaint_handled",
        PostalTicketEventType.follow_up.value: "postal_complaint_followed_up",
        PostalTicketEventType.address_applied.value: "postal_address_change_applied",
        PostalTicketEventType.makeup_created.value: "postal_makeup_created",
        PostalTicketEventType.makeup_shipped.value: "postal_makeup_shipped",
        PostalTicketEventType.makeup_completed.value: "postal_makeup_completed",
        PostalTicketEventType.makeup_cancelled.value: "postal_makeup_cancelled",
    }[_value(event_type)]


def _ticket_payload(ticket: PostalTicket) -> dict:
    ticket_type = _value(ticket.type)
    payload = {
        "ticket_id": ticket.id,
        "delivery_no": _delivery_no(ticket.external_order_no),
        "recipient_name": ticket.snap_name or ticket.new_name or ticket.old_name,
        "business_date": None,
    }
    if ticket_type == PostalTicketType.complaint.value:
        payload.update(
            business_date=ticket.complaint_date.isoformat() if ticket.complaint_date else None,
            summary=ticket.missing_issues,
            status=_value(ticket.status),
            handling_count=ticket.handling_count,
        )
    elif ticket_type == PostalTicketType.address.value:
        payload.update(
            business_date=ticket.change_date.isoformat() if ticket.change_date else None,
            old_name=ticket.old_name,
            new_name=ticket.new_name,
            old_address=ticket.old_address,
            new_address=ticket.new_address,
            applied_to_order=ticket.applied_to_order,
        )
    else:
        payload.update(
            business_date=ticket.follow_up_date.isoformat() if ticket.follow_up_date else None,
            summary=ticket.communication_content or ticket.result,
        )
    return payload


def list_order_timeline(db: Session, order_id: int) -> list[dict]:
    """Return newest-first order activities without duplicating audit data.

    Postal rows are projected into the response at read time, preserving their
    original timestamps and avoiding a second write-only copy in order_events.
    """
    rows = [
        {
            "id": event.id,
            "stream_id": f"order:{event.id}",
            "source": "order",
            "source_id": event.id,
            "event_type": _value(event.event_type),
            "payload_json": event.payload_json,
            "operator_id": event.operator_id,
            "created_at": event.created_at,
        }
        for event in db.query(OrderEvent).filter(OrderEvent.order_id == order_id).all()
    ]

    tickets = (
        db.query(PostalTicket)
        .filter(linked_to_order_clause(order_id))
        .all()
    )
    for ticket in tickets:
        rows.append(
            {
                "id": ticket.id,
                "stream_id": f"postal-ticket:{ticket.id}",
                "source": "postal_ticket",
                "source_id": ticket.id,
                "event_type": _ticket_created_type(ticket.type),
                "payload_json": _ticket_payload(ticket),
                "operator_id": None,
                "created_at": ticket.created_at,
            }
        )

    ticket_ids = [ticket.id for ticket in tickets]
    if ticket_ids:
        ticket_by_id = {ticket.id: ticket for ticket in tickets}
        events = (
            db.query(PostalComplaintHandlingRecord)
            .filter(PostalComplaintHandlingRecord.ticket_id.in_(ticket_ids))
            .all()
        )
        for event in events:
            ticket = ticket_by_id[event.ticket_id]
            rows.append(
                {
                    "id": event.id,
                    "stream_id": f"postal-ticket-event:{event.id}",
                    "source": "postal_ticket_event",
                    "source_id": event.id,
                    "event_type": _ticket_event_type(event.event_type),
                    "payload_json": {
                        "ticket_id": ticket.id,
                        "delivery_no": _delivery_no(ticket.external_order_no),
                        "recipient_name": ticket.snap_name or ticket.new_name or ticket.old_name,
                        "action": event.action,
                        "follow_result": event.follow_result,
                        "result_status": event.result_status,
                    },
                    "operator_id": event.handled_by,
                    "created_at": event.handled_at,
                }
            )

    return sorted(rows, key=lambda row: (row["created_at"], row["stream_id"]), reverse=True)
