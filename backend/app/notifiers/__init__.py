"""Registry of notification channels and the dispatcher."""

from .. import db
from .base import Notifier, NotifierError, RiskMessage
from .inapp import InAppNotifier
from .outlook import OutlookNotifier
from .teams import TeamsNotifier

_REGISTRY: list[Notifier] = [InAppNotifier(), OutlookNotifier(), TeamsNotifier()]


def all_notifiers() -> list[Notifier]:
    return _REGISTRY


def dispatch(message: RiskMessage, channels: list[str]) -> list[dict]:
    """Sends the message through the given channels; every attempt is logged in the database."""
    deliveries = []
    for n in _REGISTRY:
        if n.id not in channels:
            continue
        try:
            n.send(message)
            status, error = "sent", ""
        except NotifierError as e:
            status, error = "failed", str(e)
        deliveries.append(
            db.add_notification(
                message.supplier_id,
                f"{message.recipient_name} <{message.recipient_email}>",
                message.subject,
                message.text,
                channel=n.id,
                status=status,
                error=error,
            )
        )
    return deliveries


__all__ = ["Notifier", "NotifierError", "RiskMessage", "all_notifiers", "dispatch"]
