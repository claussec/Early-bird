"""Suppliers entered in the cockpit (and the demo data). Always available."""

from .. import db
from .base import SourceConnector, SupplierRecord


def _record(master: dict) -> SupplierRecord:
    return SupplierRecord(
        source=master.get("source", "manual"),
        number=master["number"],
        name=master["name"],
        city=master.get("city", ""),
        country=master.get("country", ""),
        website=master.get("website", ""),
        commodity=master.get("commodity", ""),
        buyer_name=master.get("buyer", {}).get("name", ""),
        buyer_email=master.get("buyer", {}).get("email", ""),
    )


class LocalConnector(SourceConnector):
    id = "local"
    name = "Cockpit (manuell erfasst)"
    kind = "local"

    @property
    def configured(self) -> bool:
        return True

    def search(self, query: str, limit: int = 20) -> list[SupplierRecord]:
        q = query.strip().lower()
        hits = [
            s for s in db.list_suppliers()
            if s.get("source") in ("manual", "demo") and (q in s["name"].lower() or q in s["number"].lower())
        ]
        return [_record(s) for s in hits[:limit]]

    def get_master(self, number: str) -> SupplierRecord | None:
        master = db.find_supplier_by_number(number)
        return _record(master) if master else None

    def get_internal_data(self, number: str) -> dict | None:
        master = db.find_supplier_by_number(number)
        return db.get_internal(master["id"]) if master else None
