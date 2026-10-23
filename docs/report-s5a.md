# Twin Test – Bericht S5a (Messstation)

Stand: 23.10.2026 · Branch `proto/twin-v01` · nicht auf `main` gemergt, kein Deploy.
Repo öffentlich: nur Code und Werte des erfundenen Platzhalterpakets. Messwerte echter Pakete liegen privat.

S5 verlangt Messungen auf echten Geräten. Diese Vorstufe baut das Werkzeug dafür und misst, was sich ohne Geräte messen lässt.

## Was steht

| Bereich | Umsetzung | Dateien |
|---|---|---|
| Messanzeige | Mit `#messen` am Ende der Adresse erscheint eine einklappbare Anzeige: erstes Bild (Gelände und Startmodelle geladen, erstes gerendertes Bild danach), erster Download, Draw Calls, Dreiecke. Knopf „Messfahrt starten“: Zone → Ort → Zone → Resort mit Bildrate (Median), p95-Bildabstand und nachgeladenen MB je Fahrt, danach 5 s Dauerlauf. „Ergebnis kopieren“ legt alles als JSON in die Zwischenablage. Werte mit Urteil gegen die Budgets: ok, knapp (ab 80 %), über, offen (unter 10 Bildern). | `src/messen.ts`, `src/style.css` |
| Eigener Chunk | Die Anzeige wird nur mit `#messen` nachgeladen (4,6 kB); ohne bleibt der Viewer unverändert. | `src/main.ts` |
| Viewer-Haken | `onFrame` nach jedem Bild, `stats()` (Draw Calls, Dreiecke, Geometrien, Texturen), `continuous` für den Dauerlauf, `terrainReady`. | `src/view/viewer.ts` |
| Auswertung | Median, Perzentil, Anteil langsamer Bilder, Urteile – rein und getestet. | `src/view/perf.ts`, `src/view/perf.test.ts` |
| Messskript | `npm run measure -- --dist <build> [--out <ordner>] [--netz fast4g\|aus] [--ansicht mobil,desktop] [--gpu] [--bild]`. Startet `vite preview`, Chromium ohne Cache, Netz per DevTools-Protokoll gedrosselt (Fast 4G: 9 / 1,5 Mbit/s, 165 ms), führt die Messfahrt aus, schreibt JSON (und Bild), zählt fremde Requests. Ohne `--out` nur Konsole. | `scripts/measure.mjs` |

## Prüfschritte – was ausgeführt wurde (Cloud, Linux, Node 22, Chromium mit SwiftShader)

1. **Tests:** 9 Testdateien, **111 Tests bestanden** (S2: 103; neu 8 für die Auswertung).
2. **Typprüfung** ohne Fehler, **Build** (Platzhalter) grün: `index.js` 663,05 kB (gzip 170,97 kB), `messen.js` 4,58 kB (gzip 2,17 kB).
3. **Platzhalter-Regression:** `npm run shots` – 48 Requests, 0 fremd, 0 Konsolenfehler, 8/8 Bedienprüfungen OK. (Bilder nicht neu eingecheckt, Viewer ohne `#messen` unverändert.)
4. **Messlauf Platzhalter, Fast 4G simuliert:** erstes Bild mobil 2,18 s / Desktop 1,59 s, erster Download 0,20 / 0,26 MB, 50 Draw Calls, 0 fremde Requests. Bildrate in SwiftShader 6–10 fps – Software-Rendering, kein Gerätewert.
5. **Messlauf mit einem echten Paket** (privat): Fast 4G simuliert und ungedrosselt, mobil und Desktop, 0 fremde Requests, 0 Konsolenfehler. Werte und Bilder im privaten Messbericht.
6. `check:public` mit privater Marker-Liste: in Ordnung.

## Nicht geprüft

- **Bildrate auf echten Geräten** – das ist der eigentliche S5-Schritt. In der Cloud rendert SwiftShader auf der CPU; dessen Bildrate sagt über ein Handy nichts aus. Fahrten mit unter 10 Bildern werden deshalb als „offen“ gewertet.
- **Echtes 4G** – nur simuliert (DevTools-Drosselung, ohne Funkschwankungen).
- **Dreiecke** zählen den Schattendurchgang mit (three.js zählt jeden Render-Durchgang); die Zahl liegt daher über der Dreieckszahl der Modelle.
- **Erster Download** zählt `transferSize` aus der Resource-Timing-API; Dateien aus dem Browser-Cache zählen 0. Der Messlauf schaltet den Cache ab, die Anzeige am Gerät nicht.
- Safari/iOS: `WEBGL_debug_renderer_info` kann fehlen; dann steht nur der allgemeine Renderer-Name im Ergebnis.

## So misst man am Gerät

1. Build des Pakets erzeugen, `npx vite preview --host --outDir <build>` im eigenen WLAN starten.
2. Am Handy `http://<rechner-ip>:4173/#messen` öffnen, warten bis „Erstes Bild“ einen Wert hat.
3. „Messfahrt starten“, nach „Messfahrt fertig.“ auf „Ergebnis kopieren“ und das JSON in den privaten Messbericht übernehmen.
4. Für eine 4G-nahe Ladezeit am Laptop: Chrome-DevTools → Netzwerk → „Fast 4G“, Cache deaktivieren.

## Nächster Schritt

Messungen am Mittelklasse-Android, am iPhone und am Laptop (S5). Vorher klären, wie das Budget „erstes Bild < 3 s“ zum Budget „erster Download < 5 MB“ steht – siehe privaten Messbericht.
