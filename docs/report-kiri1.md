# Twin Test – Bericht KIRI1 (Fremdmodelle einpassen)

Stand: 23.10.2026 · Branch `proto/twin-v01` · nicht auf `main` gemergt, kein Deploy.
Repo öffentlich: nur Code und Tests mit erfundenen Daten. Konfiguration, Passpunkte und Messwerte echter Modelle liegen privat.

Ziel: Ein Modell aus einem Scan-Dienst (z. B. KIRI-Export als GLB oder OBJ) hat keine echte Lage und keinen echten Maßstab. Der Import soll es über Passpunkte in das georeferenzierte Projektsystem setzen und je Zone verwenden – Zone für Zone, neben dem bisherigen Bestand.

## Was steht

| Bereich | Umsetzung | Dateien |
|---|---|---|
| Einpassung | Ähnlichkeitstransformation aus Passpunkten (Maßstab, Drehung, Verschiebung; keine Spiegelung), geschlossene Lösung nach Horn über Quaternionen. Bericht: Restfehler je Passpunkt, unabhängig je Prüfpunkt, Maßstab, Drehung, Neigung. | `scripts/import/place.mjs` |
| Fremdmodell | GLB/glTF (auch Meshopt) oder OBJ mit MTL-Textur lesen; Knoten-Transformationen und Einpassung in die Vertices einbacken; auf das Zonen-Polygon schneiden (Dreiecksmittelpunkt); relativ zur Zonenmitte; ungeleuchtet; Textur auf eine Kantenlänge verkleinert (JPEG); danach die bestehende Reduktion und Meshopt-Kompression. Instanzen, Nicht-Dreiecke und Draco werden mit klarer Meldung abgelehnt. | `scripts/import/kiri-model.mjs` |
| Import | Zone bekommt optional `kiri`: Datei, Passpunkte, Prüfpunkte (Pflicht), Fehlergrenze (Standard 2 m), `use` = `detail` (beim Hineinzoomen) oder `bestand` (ersetzt das leichte Modell). Passpunkt-Ziele als UTM, als Koordinaten der Bestands-OBJ (cm, inkl. senkrechtem Versatz) oder als Web-Meter; Quellkoordinaten wie in der Datei (glTF, y oben) oder aus Blender (`srcFrame: "blender"`, z oben). Die Einpassung läuft vor allem anderen – schlechte Punkte brechen ab, bevor etwas geschrieben wird. `--nur-passpunkte` prüft nur die Punkte, ohne Daten zu lesen. | `scripts/import/run.mjs` |

## Schneller Weg: Einzelmodell ohne Georeferenz

Für einen ersten Blick und die Diskussion, bevor Passpunkte gesetzt sind: `npm run standalone -- <modell.glb> --out data/<paket> --title "…" --zone "…"` macht aus einer Datei ein eigenes Paket mit leichter Fassung (Übersicht) und Detailfassung (Zoom), Hochachse wählbar (`--up y|z`), Maßstab (`--scale`). Das Paket trägt `georeferenced: false` und keinen Nullpunkt; die Kopfzeile sagt „Lage nicht georeferenziert“. Schema: `georeferenced` ist optional; `false` erlaubt echte Daten ohne Nullpunkt und verbietet dann einen. Überschreibt nie (Ziel darf nicht existieren). Dateien: `scripts/import/standalone.mjs`, `src/model/types.ts`, `src/model/validate.ts`, `src/main.ts`; 6 Tests (`standalone.test.mjs`, `validate.test.ts`). Ein Test fand dabei eine Schwäche: Die Bodenhöhe aus jedem 7. Punkt lief bei regelmäßigen Gittern im Gleichtakt – jetzt aus allen Punkten. Probe mit einem erfundenen Scan in realistischer Größe (120 × 90 m, 400 000 Dreiecke, 4096-px-Textur, z oben): Kette von der GLB bis zum Vorschau-Ordner in rund 7 s; dabei zwei Fehler gefunden und behoben – die Übersicht blieb leer, weil der Scan 300 m über ±0 lag (Boden wird jetzt auf ±0 gesetzt, Höhe im Bericht), und eine große Zone ragte im Hochformat über den Rand (Zonenausschnitt jetzt volle Diagonale statt 0,9). Detailfassung mit 250 000 Dreiecken als Standard; eine Budgetüberschreitung meldet das Skript mit Code 2.

## Prüfschritte – was ausgeführt wurde (Cloud, Node 22)

1. **Tests:** 11 Dateien, **131 Tests bestanden** (vorher 111). Neu 20: Einpassung (exakte Rückgewinnung einer gedrehten, skalierten Lage; drei Punkte; Rauschen mit Prüfpunkten; keine Spiegelung; zu wenige, ungleiche, ungültige, kollineare Punkte; Drehung/Neigung), Modellaufbereitung (verschachtelte Knoten einbacken, Zuschnitt mit leerem Teil, „nichts bleibt“, unlit + Textur + Optimierung lesbar, OBJ mit MTL, fremdes Format), Konfiguration (UTM und Bestands-OBJ ergeben denselben Punkt, Pflicht-Prüfpunkt, Fehlergrenze, Blender-Achsen) und ein **Gesamtlauf** des Imports mit erfundenem Gelände, Bestand und Fremdmodell: gültiges Paket, Fremdmodell als Detail, 2 von 4 Dreiecken im Grundriss; bei 5 m Fehler am Prüfpunkt Abbruch ohne geschriebene Datei.
2. **Gegenprobe:** dieselben neuen Tests gegen den alten `run.mjs` – 7 scheitern.
3. **Typprüfung** ohne Fehler. `check:public` mit privater Marker-Liste in Ordnung.

## Nicht geprüft

- **Mit einem echten Export** – liegt nur lokal; Format, Größe, Texturen und Achsen eines echten Exports sind unbekannt, bis er einmal durchläuft.
- **Automatische Feinanpassung** (ICP gegen den Bestand) – bewusst nicht gebaut; die Lage kommt allein aus den Passpunkten, belegt durch Prüfpunkte.
- Koordinaten aus Cinema 4D (eigene Achsen und Einheiten) – nicht unterstützt; Punkte in Blender oder direkt aus der Datei ablesen.
- Codex-Prüfung nach R1 (Koordinaten, schreibender Code) – läuft lokal, noch nicht geschehen.
