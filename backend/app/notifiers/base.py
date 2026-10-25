"""Common interface for notification channels (in-app, Outlook, Teams, …)."""

from abc import ABC, abstractmethod

from pydantic import BaseModel


class RiskMessage(BaseModel):
    """An early-warning message for the buyer responsible for a supplier."""

    supplier_id: str
    supplier_name: str
    supplier_number: str
    recipient_name: str
    recipient_email: str
    subject: str
    summary: str
    recommendation: str
    measures: list[str]
    link: str

    @property
    def text(self) -> str:
        return (
            f"{self.summary}\n\nEmpfehlung: {self.recommendation}\n\nMaßnahmen:\n"
            + "\n".join(f"- {m}" for m in self.measures)
            + f"\n\nDetails: {self.link}"
        )


class NotifierError(Exception):
    """Delivery through a channel failed."""


class Notifier(ABC):
    id: str
    name: str

    @property
    @abstractmethod
    def configured(self) -> bool: ...

    @abstractmethod
    def send(self, message: RiskMessage) -> None:
        """Delivers the message or raises NotifierError."""

    def describe(self) -> dict:
        return {"id": self.id, "name": self.name, "configured": self.configured}
