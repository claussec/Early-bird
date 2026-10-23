"""Common interface for source systems that provide supplier master and transactional data.

Every source system (SAP, other ERPs, the cockpit's own manual entry) implements
`SourceConnector`. The rest of the application only talks to this interface, so
new systems can be added without touching the pipeline.
"""

from abc import ABC, abstractmethod

from pydantic import BaseModel


class SupplierRecord(BaseModel):
    """Supplier master data as delivered by a source system."""

    source: str
    number: str
    name: str
    city: str = ""
    country: str = ""
    website: str = ""
    commodity: str = ""
    buyer_name: str = ""
    buyer_email: str = ""


class ConnectorError(Exception):
    """The source system could not be reached or returned an unexpected response."""


class NotConfigured(ConnectorError):
    """The connector is registered but its connection settings are missing."""


class SourceConnector(ABC):
    id: str
    name: str
    kind: str

    @property
    @abstractmethod
    def configured(self) -> bool: ...

    @abstractmethod
    def search(self, query: str, limit: int = 20) -> list[SupplierRecord]:
        """Finds suppliers by number or name."""

    @abstractmethod
    def get_master(self, number: str) -> SupplierRecord | None:
        """Returns the master data of one supplier, or None if the number is unknown."""

    def get_internal_data(self, number: str) -> dict | None:
        """Returns the Internal Module dataset (revenue, purchase, plan_snapshots, pd_history,
        quality; format see README) or None if this system does not provide it."""
        raise NotImplementedError(f"{self.name} liefert noch keine Transaktionsdaten")

    def describe(self) -> dict:
        provides_data = type(self).get_internal_data is not SourceConnector.get_internal_data
        return {
            "id": self.id,
            "name": self.name,
            "kind": self.kind,
            "configured": self.configured,
            "capabilities": ["search", "master_data"] + (["internal_data"] if provides_data else []),
        }

    def _require_config(self) -> None:
        if not self.configured:
            raise NotConfigured(f"{self.name} ist nicht konfiguriert")
