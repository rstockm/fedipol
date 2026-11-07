# Fedipol-Icons

Identisch mit Frontend `icons/`; PNGs aus `favicon.svg` (32 px) beziehungsweise
`app-icon.svg` (180/192/512 px) via ImageMagick generieren, nicht manuell bearbeiten.
Aufruf: `magick -background none -density 768 icons/<quelle>.svg -resize
<größe>x<größe> PNG32:icons/<ziel>.png` aus Dashboard-Verzeichnis.

| Datei | Zweck |
| --- | --- |
| `app-icon.svg` | App-Icon-Quelle; deckender Hintergrund und Sicherheitsabstand für Android-Masken/Apple-Rundung. |
| `app-icon-192.png` | Android-/Web-App-Icon, 192×192. |
| `app-icon-512.png` | Hochauflösendes und maskierbares Manifest-Icon, 512×512. |
| `apple-touch-icon.png` | Apple-Home-Bildschirm/Lesezeichen, 180×180. |
| `favicon.svg` | Browser-Tab-/Bookmark-Icon; größeres Zeichen auf dunkler abgerundeter Kachel. |
| `favicon-32.png` | PNG-Favicon-Fallback, 32×32. |
