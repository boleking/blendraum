# Twin Test – Bericht S0 (Datenpaket und Schema 2)

Stand: 23.10.2026 · Branch `proto/twin-v01` · nicht auf `main` gemergt, kein Deploy.
Dieses Repo ist öffentlich: Es enthält nur Viewer-Code und das erfundene Platzhalterpaket.
Echte Projektpakete werden lokal erzeugt und nie eingecheckt.

## Was steht

| Bereich | Umsetzung | Dateien |
|---|---|---|
| Schema 2 | `placeholder` (Wahrheitswert), `origin` (EPSG + E/N/H oder `null`), optionales `terrain`, Zonen mit Grundriss-Polygon `footprint` statt `center`/`size` (beides wird berechnet), `neu` optional, `terrainPatch` je Variante (nur im Schema, Darstellung folgt später), `source` je Modelldatei (Datei, Datum, Dreiecke, Texturgröße). | `src/model/types.ts`, `src/model/validate.ts` |
| Regeln | Platzhalter ⇒ kein Nullpunkt. Echte Daten ⇒ Nullpunkt und `source` für jede Datei Pflicht. Orte werden gegen das Polygon geprüft. Pfade bleiben relativ und im Paket. Schema 1 (Teil A) wird beim Laden in Schema 2 umgewandelt. | `src/model/validate.ts` |
| Nullpunkt | `utmToWeb` / `webToUtm` (x = E − e, y = H − h, z = −(N − n)), `localCmToUtm` für Quellmodelle in lokalen Zentimetern, `roundOrigin` (10 m / 1 m). | `src/model/geo.ts` |
| Datenpfad | Ohne Variable lädt der Viewer `public/` (Platzhalter). Mit `VITE_TWIN=data/<paket>` dient dieser Ordner als Paket (twin.json + models/). Pfade außerhalb von `data/` und Pakete ohne `twin.json` werden abgelehnt. `data/` ist ignoriert. | `vite.config.ts`, `.gitignore` |
| Viewer | Kopfzeile, Seitentitel und Canvas-Beschriftung folgen dem Paket (Platzhalter oder „Interner Arbeitsstand · nicht weitergeben“). Schalter „Neu“ ist gesperrt, wo es keinen Entwurf gibt. Gelände wird geladen, wenn das Paket eines hat. | `src/main.ts`, `src/view/viewer.ts`, `index.html` |
| Prüfskript | `npm run check:public` (läuft vor `build` und `build:bundle`): nichts unter `data/` im Git-Index, keine 3D-/Scan-/Geodaten-Dateien, `.gitignore` deckt `data/` und die Marker-Datei, `public/twin.json` ist Platzhalter ohne Nullpunkt. Optional Suchbegriffe aus einer lokalen Marker-Datei (`.real-data-markers` oder `TWIN_MARKERS=<pfad>`), die selbst nie im Repo liegt. | `scripts/check-public.mjs` |

## Prüfschritte – was ausgeführt wurde (lokal, Windows, Node 26)

1. **Typprüfung:** `tsc --noEmit` ohne Fehler.
2. **Tests:** `npm test` → 7 Testdateien, **82 Tests bestanden** (vorher 41). Neu: Schema 2 (Polygon, L-Form, optionales Neu, Nullpunkt-Regeln, Herkunft, unsichere Pfade für Gelände/Geländeteil, Umwandlung Schema 1), Nullpunkt-Hin- und Rückrechnung inkl. float32-Genauigkeit, Datenpfad `VITE_TWIN`, Prüfskript.
3. **Build:** `npm run build` grün; Prüfskript läuft davor. Bundle `index.js` 632,57 kB (gzip 161,72 kB).
4. **Prüfskript mit Markern:** mit einer lokalen Marker-Liste (7 Begriffe) über alle 41 eingecheckten Dateien – in Ordnung. Gegenprobe: ein zu allgemeiner Testbegriff schlug in `index.html` an; das Skript meldet Datei und Zeile.
5. **Datenpfad:** erfundenes Paket unter `data/probe` (placeholder false, Nullpunkt, Gelände, Zone B ohne Neu) mit `VITE_TWIN=data/probe` gebaut – Paket landet im Build, `git status` zeigt `data/` nicht. `VITE_TWIN=../x` bricht mit Meldung ab.
6. **Browser (Dev-Server mit dem Probe-Paket):** Kopfzeile „Interner Arbeitsstand · nicht weitergeben“, Titel aus dem Paket, „Neu“ in Zone B gesperrt (mit Hinweis), in Zone C frei, 0 Konsolenfehler.
7. **Screenshots + Netzwerk:** `npm run shots` mit lokalem Edge (`CHROMIUM_PATH`, GPU statt SwiftShader wie in Teil A) – 16 Bilder neu, 48 Requests, **0 fremde Ursprünge**, 0 Konsolenfehler, 8/8 Bedienprüfungen OK.

## Nicht geprüft

- Darstellung von `terrainPatch` – nur Schema und Validierung, Viewer ignoriert es bis S3.
- Gelände mit echter Größe (Kamera, Schatten-Frustum und Boden sind noch auf den Platzhalter-Maßstab ausgelegt) – kommt mit S1.
- `build:bundle` unter Windows: das Skript setzt die Variable POSIX-artig (`VITE_MODEL_BUNDLE=1 …`) und läuft so nur in einer POSIX-Shell; unverändert aus Teil A.
- Das Prüfskript ist nicht als Git-Hook installiert; es läuft vor jedem Build und kann vor einem Commit von Hand gestartet werden.
- Framerate auf echten Geräten, Touch, Screenreader, Safari/Firefox – wie Teil A.

## Nächster Schritt

S1: Importskript für Gelände und Bestand in ein Paket unter `data/`, erstes echtes Bild in der Resort-Stufe. Die Projektkonfiguration liegt in einem privaten Daten-Repo, nicht hier.
