"""Stores the message in the cockpit (bell icon). Always available."""

from .base import Notifier, RiskMessage


class InAppNotifier(Notifier):
    id = "inapp"
    name = "Cockpit"

    @property
    def configured(self) -> bool:
        return True

    def send(self, message: RiskMessage) -> None:
        # Persisting is done by the dispatcher for every channel; nothing else to deliver.
        return None
