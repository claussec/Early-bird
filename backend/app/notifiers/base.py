"""Common interface for notification channels (in-app, Outlook, Teams, …)."""

from abc import ABC, abstractmethod

from pydantic import BaseModel

from ..i18n import t


class Recipient(BaseModel):
    """A person to warn: the supplier's buyer or a contact of a linked plant."""

    name: str
    email: str = ""
    role: str = ""
    plant: str = ""

    @property
    def display(self) -> str:
        return f"{self.name or self.email} <{self.email}>" if self.email else self.name


class RiskMessage(BaseModel):
    """An early-warning message for everyone affected by a supplier's escalation."""

    supplier_id: str
    supplier_name: str
    supplier_number: str
    recipients: list[Recipient]
    plants: list[str] = []
    lang: str = "de"
    subject: str
    summary: str
    recommendation: str
    measures: list[str]
    link: str

    @property
    def text(self) -> str:
        lines = [self.summary]
        if self.plants:
            lines.append(t(self.lang, "mail.plants", plants=", ".join(self.plants)))
        lines.append(f"{t(self.lang, 'mail.recommendation')}: {self.recommendation}")
        lines.append(f"{t(self.lang, 'mail.measures')}:\n" + "\n".join(f"- {m}" for m in self.measures))
        lines.append(f"{t(self.lang, 'mail.details')}: {self.link}")
        return "\n\n".join(lines)


class NotifierError(Exception):
    """Delivery through a channel failed."""


class Notifier(ABC):
    id: str
    name: str
    # True: one delivery per recipient (e-mail); False: one delivery for all (channel post, cockpit).
    per_recipient = False

    @property
    @abstractmethod
    def configured(self) -> bool: ...

    @abstractmethod
    def send(self, message: RiskMessage, recipient: Recipient | None = None) -> None:
        """Delivers the message (to `recipient` for per-recipient channels) or raises NotifierError."""

    def describe(self) -> dict:
        return {"id": self.id, "name": self.name, "configured": self.configured}
