# Twin Test – Bericht Teil A

Stand: 23.10.2026 · Branch `proto/twin-v01` im Repo `boleking/blendraum` · nicht auf `main` gemergt, kein Deploy.

Die alte, ungenutzte Datei `blendraum_website.html` wurde auf diesem Branch entfernt (auf Wunsch).

## Was steht

| Bereich | Umsetzung | Dateien |
|---|---|---|
| Datenmodell | `twin.json` mit Ebenen UG/EG/OG1, Zonen A–F (je Bestand/Neu), 12 Orten, 18 Route-Schritten als Kamerafokus. TypeScript-Typen und `validateTwin`, die kaputte Daten mit deutschen Fehlermeldungen ablehnt. | `public/twin.json`, `src/model/` |
| Modelle | Node-Skript erzeugt je Zone und Variante eine GLB aus Boxen (12 Dateien, zusammen 87 KB). Ebene steht in `extras.level` jedes Knotens. Bestand und Neu haben unterschiedliche Massen; Neu zeigt Glasvolumen, Vordach, Becken. | `scripts/build-models.mjs`, `scripts/zone-specs.mjs` |
| Nachladen / Tausch | `twin.json` wird zur Laufzeit geladen und validiert. Bestand aller Zonen lädt zuerst, Neu im Hintergrund. Der Schalter Bestand/Neu wirkt auf die gewählte Zone; in der Stufe Resort auf alle Zonen. Wechsel mit kurzem Wachsen aus dem Sockel. | `src/view/viewer.ts`, `src/main.ts` |
| Kamera | Perspektivkamera, Start-FOV 18°, Drehung 45°, Neigung 35,26° (wahre Isometrie). Vier Stufen Resort → Zone → Ort → Route-Schritt; FOV 18 → 28 → 42 → 58°, Drehung und Neigung nehmen ab, Bildausschnitt wird logarithmisch kleiner. Fahrt mit easeInOutCubic (1,35–2,25 s). Kein freies Orbit. | `src/view/camera-rig.ts`, `src/view/nav.ts` |
| Licht | Sonne 2700 K (Kelvin→RGB), warmes Himmels-/Bodenlicht, PCF-Schatten mit Radius auf einem reinen Schattenboden; der UG-Sockel bleibt als geschnittener Block sichtbar. ACES-Tonemapping. Rendern nur bei Bewegung. | `src/view/light.ts`, `src/view/viewer.ts` |
| UI | Deutsch, mobil unten als Leiste (390×844), Desktop als Karte links (1440×900); Szene zentriert sich im freien Bereich. Tasten: ↑/+ hinein, ↓/−/Esc hinaus, ←/→ wechseln, 1–4 Stufe, B/N Variante. Touch: Wischen links/rechts wechselt, hoch/runter und Zwei-Finger-Zoom ändern die Stufe. Mausrad stufenweise. Zielgrößen ≥ 44 px, `aria-pressed`, Live-Region für Ansagen. `prefers-reduced-motion` schaltet Fahrten und Wachsen ab. | `index.html`, `src/style.css`, `src/main.ts` |
| Keine Fremd-Requests | Keine CDNs, Webfonts, Tracker; Systemschrift. Im Build setzt eine CSP alle Quellen auf `'self'`. | `vite.config.ts` |

## Prüfschritte – was ausgeführt wurde

1. **Build und Tests** (ausgeführt, grün)
   - `npm run build`: erzeugt Modelle, `tsc --noEmit` ohne Fehler, Vite-Build.
   - Bundle: `index.js` 629,15 kB (gzip 160,35 kB), `index.css` 2,68 kB (gzip 1,13 kB), `index.html` 2,74 kB. Modelle 87 KB. `dist/` gesamt 764 KB. Den Großteil macht three.js aus.
   - `npm test`: 4 Testdateien, 41 Tests bestanden (Validierung inkl. 18 Ablehnungsfälle, GLB-Erzeugung, Kamera/Navigation, Kelvin).
2. **Screenshots** (ausgeführt, Headless-Chromium mit Software-WebGL/SwiftShader)
   - `npm run shots` → 16 Bilder in `docs/shots/`: `{mobil|desktop}-{1-resort|2-zone|3-ort|4-schritt}-{bestand|neu}.png`. Zone/Ort/Schritt zeigen Zone B.
3. **Netzwerk** (ausgeführt) – `docs/shots/network.txt`: 48 Requests, alle an `http://127.0.0.1:4173` (Seite, JS, CSS, `twin.json`, 12 GLBs), **0 fremde Ursprünge**, 0 Konsolenfehler. Browser-eigene Hintergrunddienste (Google-Update o. ä.) sind im Testlauf per Flag abgeschaltet; sie stammen nicht von der Seite.
4. **Bedienung** (ausgeführt, mit `reducedMotion: 'reduce'`) – Taste ↑, →, 3, Escape, N, Wischen per Zeigerereignis, Mausrad: alle 8 Prüfungen OK, Szene ruht jeweils sofort (also ohne Kamerafahrt). Ergebnis ebenfalls in `network.txt`.

## Nicht geprüft

- **Framerate auf echten Geräten** (Smartphone, Tablet, Laptop-GPU). Die Screenshots liefen in Software-Rendering; daraus lässt sich keine Framerate ableiten.
- **Echte Touch-Eingabe**: Wischen wurde mit Maus-Zeigerereignissen geprüft (gleicher Codepfad), Zwei-Finger-Zoom gar nicht automatisiert.
- **Screenreader** (VoiceOver/TalkBack) und Safari/Firefox – nur Chromium getestet.
- **Weichheit der Kamerafahrt** nur im Code und per Einzelbildern geprüft, nicht als Video.
- CSP gilt nur im Build, nicht im `vite`-Dev-Server.

## Platzhalter

- Alles Gelände, alle Massen, Maße und Farben sind erfunden. Zonen „Zone A–F“, Orte „Ort A1…F2“, Schritte „Schritt A1.1…“. Keine echten Orte, Preise, Betreiber oder Eigentümer.
- Alle Orte liegen im EG (UG und OG1 kommen nur als Massen vor).
- Route-Schritte sind nur Kamerafokuspunkte, damit die vierte Zoomstufe etwas zeigt; die Route selbst ist Teil B.
- Ortsmarker sind schlichte Kegel, kein Text im 3D-Modell.

## Offene Punkte / Vorschläge

- Teil B (Overlay, Route, Seitenpanel) ist bewusst nicht begonnen.
- three.js-Bundle: mit Teil B ggf. Code-Splitting oder Tree-Shaking prüfen (Warnschwelle auf 700 kB gesetzt).
- Ebenen-Filter (UG/EG/OG1 ein-/ausblenden) wäre mit `extras.level` direkt machbar.
- Gebackenes Licht (Lightmap/AO beim GLB-Export) als Alternative zu Echtzeit-Schatten, falls Mobilgeräte zu langsam sind.
- In der Schritt-Stufe verdeckt die mobile Leiste viel; ggf. einklappbar machen.
- `public/models/` wird beim Build erzeugt und ist nicht eingecheckt.

## Befehle

```sh
npm install
npm run dev      # Modelle erzeugen + Dev-Server
npm run build    # Modelle + Typprüfung + Build nach dist/
npm test         # Vitest
npm run shots    # nach build: Screenshots + Netzwerkprotokoll (braucht Chromium)
```
