"""External Module.

A web crawler collects online information about a supplier (starting from the
master data: name and website), and an AI agent classifies every document into a
category and marks it as a risk or success indicator.

Live crawling is disabled by default (CRAWLER_ENABLED=false) so the demo runs
offline; the demo dataset then provides pre-collected documents.
"""

import re
import urllib.robotparser
from email.utils import parsedate_to_datetime
from html import unescape
from typing import Literal
from urllib.parse import quote_plus, urljoin, urlparse
from xml.etree import ElementTree

import httpx
from pydantic import BaseModel

from ..config import settings
from ..llm import LLM, LLMUnavailable

CATEGORIES = ["Finanzen", "Personal", "Management", "Markt", "Produktion", "ESG", "Presse"]
USER_AGENT = "SupplierRiskEarlyWarning/1.0 (+research prototype)"

RISK_TERMS = [
    "insolvenz", "insolvency", "kurzarbeit", "stellenabbau", "streicht", "restrukturierung", "restructuring",
    "verlust", "loss", "zahlungsverzug", "verzögerten zahlungen", "schließt", "schließung", "kündigt rahmenvertrag",
    "rückruf", "recall", "verlagerung", "tritt zurück", "verlässt", "gerüchte", "banken", "einbruch", "layoff",
]
SUCCESS_TERMS = [
    "investiert", "investition", "gewinnzone", "gewinnt", "preis", "erweitert", "expansion", "auftrag",
    "wachstum", "growth", "rekord", "finanzinvestor", "award",
]


class DocClassification(BaseModel):
    index: int
    category: Literal["Finanzen", "Personal", "Management", "Markt", "Produktion", "ESG", "Presse"]
    signal: Literal["risk", "success", "neutral"]
    severity: Literal[1, 2, 3]
    rationale: str


class Classifications(BaseModel):
    items: list[DocClassification]


SYSTEM = (
    "Du bist der AI Agent 'External Data' eines Frühwarnsystems für finanziell kritische Lieferanten "
    "im Automotive-Einkauf. Du klassifizierst Web-Dokumente über einen Lieferanten. Für jedes Dokument: "
    f"Kategorie ({', '.join(CATEGORIES)}), Signal (risk = Hinweis auf finanzielle Instabilität, success = Hinweis "
    "auf Stabilität, neutral), Schwere 1–3 (3 = unmittelbar insolvenzrelevant) und eine kurze, sachliche "
    "Begründung auf Deutsch. Bewerte nur, was im Dokument steht; spekuliere nicht."
)


# --- Web crawler ------------------------------------------------------------------------


def _allowed(url: str) -> bool:
    parsed = urlparse(url)
    rp = urllib.robotparser.RobotFileParser()
    try:
        r = httpx.get(f"{parsed.scheme}://{parsed.netloc}/robots.txt", timeout=8, headers={"User-Agent": USER_AGENT})
        if r.status_code >= 400:
            return True
        rp.parse(r.text.splitlines())
        return rp.can_fetch(USER_AGENT, url)
    except httpx.HTTPError:
        return True


def _text(html: str) -> tuple[str, str]:
    title = re.search(r"<title[^>]*>(.*?)</title>", html, re.S | re.I)
    body = re.sub(r"<(script|style|nav|footer)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
    body = unescape(re.sub(r"<[^>]+>", " ", body))
    return (unescape(title.group(1)).strip() if title else ""), re.sub(r"\s+", " ", body).strip()


def crawl_website(website: str, max_pages: int = 5) -> list[dict]:
    if not website or not _allowed(website):
        return []
    docs = []
    with httpx.Client(timeout=10, follow_redirects=True, headers={"User-Agent": USER_AGENT}) as client:
        try:
            home = client.get(website)
        except httpx.HTTPError:
            return []
        links = re.findall(r'href="([^"#]+)"', home.text)
        candidates = [
            urljoin(website, link)
            for link in links
            if re.search(r"news|presse|aktuell|press|karriere|nachhaltig|sustainab", link, re.I)
        ]
        for url in [website, *dict.fromkeys(candidates)][:max_pages]:
            if urlparse(url).netloc != urlparse(website).netloc or not _allowed(url):
                continue
            try:
                page = client.get(url)
            except httpx.HTTPError:
                continue
            title, text = _text(page.text)
            docs.append({"date": "", "title": title or url, "source": urlparse(url).netloc, "url": url, "text": text[:3000]})
    return docs


def search_news(name: str, max_items: int = 10) -> list[dict]:
    url = f"https://news.google.com/rss/search?q={quote_plus(chr(34) + name + chr(34))}&hl=de&gl=DE&ceid=DE:de"
    try:
        r = httpx.get(url, timeout=10, headers={"User-Agent": USER_AGENT})
        r.raise_for_status()
        root = ElementTree.fromstring(r.content)
    except (httpx.HTTPError, ElementTree.ParseError):
        return []
    docs = []
    for item in root.iter("item"):
        try:
            date = parsedate_to_datetime(item.findtext("pubDate", "")).date().isoformat()
        except (TypeError, ValueError):
            date = ""
        docs.append(
            {
                "date": date,
                "title": item.findtext("title", ""),
                "source": item.findtext("source", "Google News"),
                "url": item.findtext("link", ""),
                "text": "",
            }
        )
        if len(docs) >= max_items:
            break
    return docs


def collect(master: dict, stored: list[dict]) -> tuple[list[dict], str]:
    """Returns the documents to analyze and a description of where they came from."""
    if settings.crawler_enabled and not master.get("is_case_study"):
        docs = crawl_website(master.get("website", "")) + search_news(master["name"])
        if docs:
            return docs, f"Live-Crawling: {len(docs)} Dokumente (Website + News)"
    if master.get("is_case_study"):
        return [], "Webcrawler für den historischen Zeitraum (2019) nicht verfügbar – wie im Paper"
    return stored, f"Demo-Datenbestand: {len(stored)} vorab gesammelte Dokumente"


# --- Classification agent ---------------------------------------------------------------


def _keyword_classify(i: int, doc: dict) -> DocClassification:
    text = f"{doc.get('title', '')} {doc.get('text', '')}".lower()
    risk = [t for t in RISK_TERMS if t in text]
    success = [t for t in SUCCESS_TERMS if t in text]
    category = doc.get("hint") if doc.get("hint") in CATEGORIES else "Presse"
    if risk and len(risk) >= len(success):
        severe = any(t in text for t in ["insolvenz", "restrukturierung", "zahlungsverzug", "verzögerten zahlungen", "banken"])
        return DocClassification(
            index=i, category=category, signal="risk", severity=3 if severe else 2,
            rationale=f"Risikobegriffe erkannt: {', '.join(risk)}",
        )
    if success:
        return DocClassification(
            index=i, category=category, signal="success", severity=1,
            rationale=f"Erfolgsbegriffe erkannt: {', '.join(success)}",
        )
    return DocClassification(index=i, category=category, signal="neutral", severity=1, rationale="Kein eindeutiges Signal")


def classify(master: dict, docs: list[dict], llm: LLM) -> tuple[list[dict], str]:
    if not docs:
        return [], "keine Dokumente"
    method = llm.label
    try:
        listing = "\n".join(
            f"[{i}] {d.get('date', '')} | {d.get('source', '')} | {d.get('title', '')}\n{d.get('text', '')[:1500]}"
            for i, d in enumerate(docs)
        )
        result = llm.structured(
            SYSTEM,
            f"Lieferant: {master['name']} ({master['city']}, {master['country']}), Warengruppe {master['commodity']}.\n\n"
            f"Dokumente:\n{listing}\n\nKlassifiziere jedes Dokument (index = Nummer in eckigen Klammern).",
            Classifications,
        )
        by_index = {c.index: c for c in result.items}
        classes = [by_index.get(i) or _keyword_classify(i, d) for i, d in enumerate(docs)]
    except LLMUnavailable:
        method = "Regelbasierte Schlagwort-Klassifikation"
        classes = [_keyword_classify(i, d) for i, d in enumerate(docs)]
    out = []
    for d, c in zip(docs, classes):
        out.append({**{k: v for k, v in d.items() if k != "text"}, **c.model_dump(exclude={"index"})})
    return out, method
