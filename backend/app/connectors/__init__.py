"""Registry of source systems. Add new connectors to `_REGISTRY`."""

from .base import ConnectorError, NotConfigured, SourceConnector, SupplierRecord
from .generic_rest import GenericRestConnector
from .local import LocalConnector
from .sap import SapS4Connector

_REGISTRY: list[SourceConnector] = [LocalConnector(), SapS4Connector(), GenericRestConnector()]


def all_connectors() -> list[SourceConnector]:
    return _REGISTRY


def get_connector(source_id: str) -> SourceConnector | None:
    return next((c for c in _REGISTRY if c.id == source_id), None)


def search_all(query: str, sources: list[str] | None = None, limit: int = 20) -> dict:
    """Searches the selected source systems (all configured ones by default).

    Returns hits per source and errors per source, so one unreachable system does not
    hide the results of the others.
    """
    results: list[SupplierRecord] = []
    errors: dict[str, str] = {}
    for c in _REGISTRY:
        if sources and c.id not in sources:
            continue
        if not sources and not c.configured:
            continue
        try:
            results.extend(c.search(query, limit))
        except ConnectorError as e:
            errors[c.id] = str(e)
    return {"results": [r.model_dump() for r in results], "errors": errors}


__all__ = [
    "ConnectorError",
    "NotConfigured",
    "SourceConnector",
    "SupplierRecord",
    "all_connectors",
    "get_connector",
    "search_all",
]
