"""SAP S/4HANA connector (OData V2, API_BUSINESS_PARTNER).

Configuration: SAP_BASE_URL (e.g. https://s4.example.com), SAP_CLIENT, SAP_USER, SAP_PASSWORD.

Master data is read from the released API `A_Supplier`. Spend, planning, rating and
quality data are company specific (purchasing info records, purchase order history,
SAP IBP / BW queries, QM notifications); `get_internal_data` is the extension point
where that mapping is added.
"""

import httpx

from ..config import settings
from .base import ConnectorError, SourceConnector, SupplierRecord

SERVICE = "/sap/opu/odata/sap/API_BUSINESS_PARTNER"


class SapS4Connector(SourceConnector):
    id = "sap"
    name = "SAP S/4HANA"
    kind = "erp"

    @property
    def configured(self) -> bool:
        return bool(settings.sap_base_url and settings.sap_user and settings.sap_password)

    def _get(self, path: str, params: dict) -> dict | None:
        """Returns the OData payload (`d`), or None if the entity does not exist."""
        self._require_config()
        if settings.sap_client:
            params["sap-client"] = settings.sap_client
        try:
            r = httpx.get(
                f"{settings.sap_base_url.rstrip('/')}{SERVICE}{path}",
                params={**params, "$format": "json"},
                auth=(settings.sap_user, settings.sap_password),
                headers={"Accept": "application/json"},
                timeout=20,
            )
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r.json()["d"]
        except (httpx.HTTPError, KeyError, ValueError) as e:
            raise ConnectorError(f"SAP-Abfrage fehlgeschlagen: {e}") from e

    @staticmethod
    def _record(row: dict) -> SupplierRecord:
        return SupplierRecord(source="sap", number=row["Supplier"], name=row.get("SupplierName", ""))

    def search(self, query: str, limit: int = 20) -> list[SupplierRecord]:
        q = query.replace("'", "''")
        data = self._get(
            "/A_Supplier",
            {
                "$filter": f"Supplier eq '{q}' or substringof('{q}',SupplierName)",
                "$select": "Supplier,SupplierName",
                "$top": str(limit),
            },
        )
        return [self._record(row) for row in (data or {}).get("results", [])]

    def get_master(self, number: str) -> SupplierRecord | None:
        row = self._get(f"/A_Supplier('{number.replace(chr(39), '')}')", {"$select": "Supplier,SupplierName"})
        return self._record(row) if row else None
