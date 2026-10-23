"""Generic REST connector for any other system (other ERPs, a data warehouse, a middleware).

Configuration: ERP_NAME, ERP_BASE_URL, ERP_TOKEN (Bearer). Expected endpoints:

    GET {base}/suppliers?q=<text>&limit=<n>      -> [SupplierRecord, ...]
    GET {base}/suppliers/{number}                -> SupplierRecord (404 if unknown)
    GET {base}/suppliers/{number}/risk-data      -> Internal Module dataset (format see README)

The JSON fields follow `SupplierRecord`, so a thin adapter in front of the source
system is enough to connect it.
"""

import httpx

from ..config import settings
from .base import ConnectorError, SourceConnector, SupplierRecord


class GenericRestConnector(SourceConnector):
    id = "erp"
    kind = "erp"

    @property
    def name(self) -> str:  # type: ignore[override]
        return settings.erp_name

    @property
    def configured(self) -> bool:
        return bool(settings.erp_base_url)

    def _get(self, path: str, params: dict | None = None) -> httpx.Response:
        self._require_config()
        headers = {"Accept": "application/json"}
        if settings.erp_token:
            headers["Authorization"] = f"Bearer {settings.erp_token}"
        try:
            return httpx.get(f"{settings.erp_base_url.rstrip('/')}{path}", params=params, headers=headers, timeout=20)
        except httpx.HTTPError as e:
            raise ConnectorError(f"{self.name} nicht erreichbar: {e}") from e

    def _json(self, r: httpx.Response):
        if r.status_code >= 400:
            raise ConnectorError(f"{self.name} antwortet mit {r.status_code}")
        return r.json()

    def search(self, query: str, limit: int = 20) -> list[SupplierRecord]:
        rows = self._json(self._get("/suppliers", {"q": query, "limit": limit}))
        return [SupplierRecord(**{**row, "source": self.id}) for row in rows]

    def get_master(self, number: str) -> SupplierRecord | None:
        r = self._get(f"/suppliers/{number}")
        if r.status_code == 404:
            return None
        return SupplierRecord(**{**self._json(r), "source": self.id})

    def get_internal_data(self, number: str) -> dict | None:
        r = self._get(f"/suppliers/{number}/risk-data")
        if r.status_code == 404:
            return None
        return self._json(r)
