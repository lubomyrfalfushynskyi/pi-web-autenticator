# pi-site-backend-2fa-module

**Installationsfolge:** Stufe 3 — Installation des serverseitigen Adapters in
der Website, nachdem privacyIDEA und der benötigte Token-Typ bereitstehen.
Die vollständige Reihenfolge mit Voraussetzungen und Fehlersuche steht in
[`docs/installation-sequence.uk.md`](docs/installation-sequence.uk.md).
Sprachen: [English](README.md) · [Українська](README.uk.md).
Kurzanleitung (Ukrainisch): [`DEPLOYMENT.txt`](DEPLOYMENT.txt).

## Zweck

Diese Node.js-Bibliothek verbindet das Backend einer Website mit privacyIDEA.
Sie stellt selbst weder HTTP-Routen noch Login-Seiten, Sitzungen,
Benutzerzuordnungen, Administrationsoberflächen oder Domain-Login bereit.
Diese Aufgaben gehören zur jeweiligen Website.

Beim Challenge-Response-Ablauf fordert das Website-Backend eine Challenge bei
privacyIDEA an und speichert die `transaction_id` serverseitig im offenen
Login-Vorgang. Der Browser erhält nur `nonce_hex`, `key_hint` und
`key_hint_kind`, lässt den lokalen Signatur-Agenten signieren und sendet die
Signatur an die Website zurück. Das Backend prüft sie mit der gespeicherten
Transaktion. Nur die Website erstellt nach `ACCEPT` und erfolgreicher Prüfung
von Token-Seriennummer und Typ eine Sitzung.

privacyIDEA-URL, API-Schlüssel, `transaction_id` und die Entscheidung über
die Sitzung dürfen nicht an Browser oder lokalen Agenten gelangen.

## Unterstützte Tokenprofile

- `pkcs11cr`: Challenge-Attribut `pkcs11cr_challenge`, Schlüsselhinweis
  `pkcs11cr_cert_modulus_sha256`, Typ `cert_modulus_sha256`.
- `avtorcc338`: Challenge-Attribut `avtor_challenge`, Schlüsselhinweis
  `avtor_cert_thumbprint`, Typ `cert_thumbprint_sha256`.
- Standard-Token, deren Code im Feld `pass` geprüft wird (zum Beispiel TOTP),
  verwenden `createValidationProvider()`. Sie verwenden keinen Browser-
  Signatur-Agenten.

Ein Challenge-Response-Profil benötigt die Capability
`challenge_response`. `begin()` verweigert den Aufruf ohne Token-`serial`.
Die Website muss die Seriennummer serverseitig zuordnen und nach `ACCEPT`
erneut mit der gespeicherten Zuordnung vergleichen. Ein fehlender oder
abweichender Wert sowie ein abweichender zurückgegebener Token-Typ führen
zur Ablehnung.

## Integration und Installation

Für InTrack wird das versionierte npm-Archiv in `backend/vendor/` abgelegt
und in `backend/package.json` exakt festgeschrieben. Erstellen des Archivs:

Dieses Paket ist eine Bibliothek, kein eigenständiger Container oder Dienst.
`transport.diagnose()` sendet eine unauthentifizierte `GET`-Anfrage an den
konfigurierten Origin und prüft DNS/TLS/HTTP. Es ruft keinen
Validierungsendpunkt auf und sendet keinen API-Schlüssel. HTTP 5xx gilt als
nicht erreichbar. Dies bestätigt weder API-Schlüssel, Token-Plugin-Registrierung
noch eine erfolgreiche Authentifizierung. `validatePrivacyIdeaConfig()` prüft
die lokale Konfiguration ohne Netzwerkzugriff.
Aktuelle Paketversion: `0.3.0`.
Es muss in das Backend-Image der Website aufgenommen werden. Offene
Login-Challenges und ihre `transaction_id` müssen mit begrenzter TTL im
serverseitigen Speicher der Website liegen, nicht nur im Prozessspeicher
(wichtig bei Neustarts und mehreren Replikaten). Beim Update nur das Backend
neu bauen und ersetzen. Volumes, Health-Checks, Sitzungen und Containerbetrieb
verwaltet die Website, nicht dieses Paket.
Bei der aktuellen InTrack-Implementierung liegen offene MFA-Challenges noch
im Prozessspeicher: Ein Backend-Neustart verwirft laufende Logins; mehrere
Backend-Replikate werden für MFA nicht unterstützt.

```sh
npm pack --pack-destination /path/to/InTrack/backend/vendor
```

Danach die `file:`-Abhängigkeit in InTrack auf den neuen Archivnamen setzen,
die Paketabhängigkeiten aktualisieren und das Backend neu bauen:

```sh
cd /path/to/InTrack
npm install
docker compose build backend
docker compose up -d --no-deps backend
docker exec intrack-backend node -p "require('pi-site-backend-2fa-module/package.json').version"
```

Die letzte Ausgabe muss der festgeschriebenen Paketversion entsprechen.
Das Archiv muss im Build-Kontext `backend/vendor/` bleiben. Andere Websites
müssen ihre eigenen Routen, Speicherung des offenen Logins, Sitzungsverwaltung,
Identitätszuordnung und Enrollment-Oberfläche implementieren.

Die vollständigen Stufen, Voraussetzungen, Prüfergebnisse und Fehlersuche
stehen in [`docs/installation-sequence.uk.md`](docs/installation-sequence.uk.md)
und [`docs/integration-contract.uk.md`](docs/integration-contract.uk.md).

## Lokalisierung

Die Bibliothek hat keine Endbenutzer-Oberfläche. Sie liefert stabile
maschinenlesbare Statuswerte (`accept`, `reject`, `no_token`, `unknown_user`,
`misconfigured`, `unavailable`, `not_linked`), aber keine lokalisierten
Benutzertexte. Die Website übersetzt diese Werte mit ihrem eigenen
Lokalisierungssystem. Technische Dokumentation liegt auf Englisch, Deutsch
und Ukrainisch vor.

## Tests

```sh
npm test
npm run lint
```

Bei der Abnahme müssen gültige und ungültige OTP-/Signaturwerte,
Seriennummern-Zuordnung, abgelaufene Challenges, fehlgeschlagene Anmeldungen
ohne Sitzung und die Nichtoffenlegung von Geheimnissen im Browser geprüft
werden. Domain-SSO und OS-Login sind separate Integrationen.
