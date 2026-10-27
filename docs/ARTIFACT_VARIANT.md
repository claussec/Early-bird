# Server-Version, Artefakt und Demo im Vergleich

Das Frontend lässt sich für drei Ziele bauen:

| | Server-Version | Artefakt (claude.ai) | Eigenständige Demo |
|---|---|---|---|
| Build | `npm run build` (bzw. Docker) | `npm run build:artifact` → `frontend/dist-artifact/early-bird.html` | `npm run build:demo` → `frontend/dist-demo/index.html` |
| Läuft | lokal / eigener Server mit FastAPI-Backend | als private Seite auf claude.ai | als einzelne HTML-Datei auf jedem Webspace (z. B. Netlify Drop) oder lokal per Doppelklick |
| Code-Weiche | `src/backend/http.ts` | `src/backend/browser.ts` (`VITE_TARGET=artifact`) | `src/backend/browser.ts` (`VITE_TARGET=demo`) |

Die Oberfläche spricht in allen Fällen nur mit dem gemeinsamen Interface `src/backend/types.ts`. Funktionen, die es nicht überall gibt, sind dort optionale Gruppen (`automode`, `webResearch`, `agents`, `storage`). Die UI blendet sie nur ein, wenn die Gruppe vorhanden ist.

## Was gleich ist

- **Ansichten:** 3D-Karte (Länder, Werke, Lieferanten an ihrer Adresse, Lieferbögen zu den verknüpften Werken), 3D-Radar und sortierbare Liste
- **Sprache:** Umschalter DE/EN (Flaggen oben rechts) für Oberfläche und von den Agenten erzeugte Texte
- **Werke** anlegen, bearbeiten, löschen, mit Adresse und Kontakten; **Lieferanten** anlegen, bearbeiten (Adresse, Werke), löschen
- **Eskalation an alle Betroffenen:** Einkäufer plus alle Kontakte der verknüpften Werke, doppelte Adressen nur einmal
- **Bewertungslogik nach dem Paper:** KPIs, Schwellen, „Risk?“, Indikator-Matrix, Cross-Referencing, Argumentation, „Escalation?“, ohne Score. In `src/engine/` als TypeScript-Port der Python-Module. Die Texte kommen aus `backend/app/i18n.py` (`scripts/gen-texts.py` erzeugt `texts.gen.ts`). Geprüft: Für alle 16 Demo-Lieferanten in beiden Sprachen (32/32) sind Status, Indikatoren, Kombinationen, Argumente, Empfehlung, Maßnahmen und Begründung identisch.
- **Prompts der KI-Agenten** (Internal Data: Risk?, Decision Maker: Argumentation und Escalation?)
- **Geokodierung** offline über dieselbe Ortsliste (`data/gazetteer.json`, GeoNames)

## Unterschiede

| Bereich | Server-Version | Artefakt | Demo |
|---|---|---|---|
| **Agenten-Logik läuft** | Python-Backend (`backend/app/`) | im Browser (`frontend/src/engine/`) | im Browser |
| **LLM** | `LLM_PROVIDER`: Claude-API, Ollama (offline) oder regelbasiert | Claude über das claude.ai-Konto des Betrachters oder regelbasiert (umschaltbar) | nur regelbasiert |
| **Speicher** | SQLite | Datenbank des Artefakts (`suppliers`, `plants`, `results`, `notifications`), geteilt; ohne Anmeldung Demodaten im Speicher | Demodaten im Speicher bis zum Neuladen |
| **Web-Signale** | Live-Crawling (`CRAWLER_ENABLED=true`) | Prompt-Workflow: Prompt kopieren → Claude-Chat mit Websuche → Antwort einfügen | Prompt-Workflow, ohne automatische Strukturierung freier Texte |
| **Geokodierung** | offline oder straßengenau mit `GEOCODER=nominatim` | offline (Stadt, sonst Land) | offline |
| **Quellsysteme (SAP, ERP)** | `backend/app/connectors/` | – | – |
| **Benachrichtigungen** | Cockpit + Outlook (eine Mail je Empfänger) + Teams | Cockpit (Glocke), nennt alle Empfänger | wie Artefakt |
| **Automode** | Zeitplan, Kanäle und Sprache der Warnungen einstellbar | – („Alle prüfen“, regelbasiert) | – („Alle prüfen“) |
| **CSV-Export der Liste** | ja | nein (claude.ai erlaubt keine Downloads) | ja |
| **Deep-Link** `?supplier=…` | aus Mails/Teams-Karten | nicht nutzbar | ja |
| **IDs** | fortlaufend `S1000…`, `P01…` | `S`/`P` + Zeitstempel (mehrere Personen gleichzeitig) | wie Artefakt |

## Ältere Ergebnisse

Ergebnisse aus der ersten Artefakt-Version (mit Score) erkennt das Artefakt am fehlenden `risk_check` und bewertet sie regelbasiert neu. Regelbasierte Ergebnisse in der jeweils anderen Sprache werden für die Anzeige in der aktuellen Sprache neu erzeugt; mit Claude erzeugte bleiben, wie sie sind, und die Detailansicht weist darauf hin.

## Wo im Code

- `frontend/src/backend/types.ts`: gemeinsames Interface
- `frontend/src/backend/http.ts`: Server-Variante (REST + Server-Sent Events, `?lang=`)
- `frontend/src/backend/browser.ts`: Artefakt und Demo (claude.ai `db` + `sample`, sonst Speicher mit `demo-seed.json`)
- `frontend/src/backend/demo-seed.json`: fiktive Demodaten, erzeugt mit `scripts/export-demo-seed.py` aus `backend/app/seed.py`
- `frontend/src/engine/`: Agenten-Logik, Texte (`texts.ts`, `texts.gen.ts`), Geokodierung (`geo.ts`)
- `frontend/src/i18n.tsx`: Texte der Oberfläche
- `frontend/src/scene/MapScene.tsx`, `RadarScene.tsx`: 3D-Ansichten; `components/ListView.tsx`: Liste
- `frontend/scripts/artifact-page.mjs`: macht aus dem Single-File-Build die Artefakt-Seite
