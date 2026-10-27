"""Registry of notification channels and the dispatcher."""

from .. import db
from .base import Notifier, NotifierError, Recipient, RiskMessage
from .inapp import InAppNotifier
from .outlook import OutlookNotifier
from .teams import TeamsNotifier

_REGISTRY: list[Notifier] = [InAppNotifier(), OutlookNotifier(), TeamsNotifier()]


def all_notifiers() -> list[Notifier]:
    return _REGISTRY


def _attempt(n: Notifier, message: RiskMessage, recipient: Recipient | None) -> tuple[str, str]:
    try:
        n.send(message, recipient)
        return "sent", ""
    except NotifierError as e:
        return "failed", str(e)


def dispatch(message: RiskMessage, channels: list[str]) -> list[dict]:
    """Sends the message through the given channels; every attempt is logged in the database.

    E-mail goes to every recipient individually (buyer and the contacts of all linked plants);
    channel posts and the cockpit get one entry naming all recipients.
    """
    deliveries = []
    everyone = ", ".join(r.display for r in message.recipients)
    for n in _REGISTRY:
        if n.id not in channels:
            continue
        targets = message.recipients if n.per_recipient else [None]
        for recipient in targets:
            status, error = _attempt(n, message, recipient)
            deliveries.append(
                db.add_notification(
                    message.supplier_id,
                    recipient.display if recipient else everyone,
                    message.subject,
                    message.text,
                    channel=n.id,
                    status=status,
                    error=error,
                )
            )
    return deliveries


__all__ = ["Notifier", "NotifierError", "Recipient", "RiskMessage", "all_notifiers", "dispatch"]
