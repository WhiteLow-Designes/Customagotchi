# Customagotchi – GitHub-Pages-Version

Diese Ausgabe ist vollständig für GitHub Pages vorbereitet und benötigt keinen PHP-, Python- oder Datenbankserver.

## Live-Adresse

`https://whitelow-designes.github.io/Customagotchi/`

## Technik

- HTML5, CSS3 und Vanilla JavaScript
- relative Dateipfade für GitHub Pages
- installierbare Progressive Web App mit Manifest und Service Worker
- Spielstände und Konten werden lokal im Browser gespeichert
- lokale Registrierung und Anmeldung mit PBKDF2-gehashten Passwörtern
- fröhliche, synthetisch erzeugte Hintergrundmusik ohne externe Audiodatei
- Musiksteuerung im Footer: Abspielen/Pausieren, Stummschalten und Lautstärke

## Wichtiger Hinweis zum Login

GitHub Pages stellt ausschließlich statische Dateien bereit. Konten funktionieren deshalb nur im Browser und auf dem Gerät, auf dem sie registriert wurden. Für geräteübergreifende Konten wäre später ein externer Dienst wie Supabase oder Firebase erforderlich.

## Dateien

- `index.html`
- `styles.css`
- `enhancements.css`
- `app.js`
- `auth-music.js`
- `sw.js`
- `manifest.webmanifest`
- `assets/icon.svg`
- `.nojekyll`
