# Twin Test – Bericht UX1 (Nachtgrund, ohne Gelände, Layout nach dem Gästeweg)

Stand: 23.10.2026 · Branch `proto/twin-v01` · nicht auf `main` gemergt, kein Deploy.
Repo öffentlich: nur Code und Platzhalterbilder. Bilder und Messwerte echter Pakete liegen privat.

## Was sich ändert

| Bereich | Umsetzung | Dateien |
|---|---|---|
| Hintergrund | Schwarz statt Sandton; UI dunkel, warmer Akzent (2700 K) als einzige Farbe. | `src/view/viewer.ts`, `src/style.css`, `index.html` |
| Gelände | Standard aus: Das Modell steht frei auf Schwarz, die Geländedatei wird gar nicht geladen. Mit `?gelaende` in der Adresse wieder an. Ohne Gelände legt sich der Zonenumriss auf den Boden des Bestands (tiefster Punkt je 4-m-Feld, Löcher halten die letzte Höhe) und wird über dem Modell gezeichnet. `bundle-models.mjs --ohne-gelaende` lässt die Datei auch im Bündel weg. | `src/view/viewer.ts`, `src/main.ts`, `scripts/bundle-models.mjs` |
| Layout | Nach dem Gästeweg (Handy zuerst, „ein Tag, kein Katalog“): Karte füllt den Schirm; unten ein Blatt in Daumenreichweite mit Ort (‹ Titel ›), Ansicht (Übersicht · Bereich · Ort · Schritt) und Bereichen als wischbare Reihe; Zoom-Leiste rechts; Bestand/Neu als Planungswerkzeug klein oben rechts. Desktop: Blatt schwebt mittig unten statt als Spalte links, die Szene zentriert sich darüber. | `index.html`, `src/style.css`, `src/main.ts` |
| Sprache | Gästesprache statt Technik: „Übersicht“, „Bereich“, „Schritt“; Übersicht zeigt „Übersicht · n Bereiche“ statt des Titels ein zweites Mal. | `src/view/camera-rig.ts`, `src/view/nav.ts` |
| Ausschnitt | Übersicht etwas enger (Kantenlänge = Diagonale statt 1,05 ×). | `src/view/nav.ts` |

## Prüfschritte – was ausgeführt wurde (Cloud, Chromium mit SwiftShader)

1. **Tests:** 9 Dateien, 111 Tests bestanden. **Typprüfung** ohne Fehler, **Build** grün (`index.js` 663,45 kB, gzip 171,07 kB).
2. **Platzhalter:** `npm run shots` – 16 Bilder neu in `docs/shots/`, 48 Requests, 0 fremd, 0 Konsolenfehler, 8/8 Bedienprüfungen OK.
3. **Echtes Paket** (privat): Übersicht und Bereich mobil und Desktop angesehen, 0 Konsolenfehler, Geländedatei wird nicht angefragt. Messlauf mobil im privaten Messbericht.
4. `check:public` mit privater Marker-Liste: in Ordnung.

Beim Umbau gefunden und behoben: Die Bestand/Neu-Knöpfe wurden nach dem Umzug in die Kopfzeile nicht mehr gefunden (Viewer blieb beim Laden stehen); der gewählte Ansichtsknopf war dunkel auf dunkel.

## Nicht geprüft

- Auf echten Geräten (Lesbarkeit draußen, Daumenreichweite, Safari).
- Screenreader mit dem neuen Layout.
- Wie das Blatt mit sehr vielen Bereichen wirkt (Reihe scrollt; nicht mit mehr als 6 ausprobiert).
