# Polices vendorées — Roboto

`Roboto-Regular.ttf`, `Roboto-Medium.ttf`, `Roboto-Italic.ttf`,
`Roboto-MediumItalic.ttf` — **Roboto**, Google Fonts, licence **Apache 2.0**
(https://www.apache.org/licenses/LICENSE-2.0).

Vendorées ici parce que `pdfmake` en mode serveur (`PdfPrinter`) charge les
polices depuis des chemins de fichier et ne les bundle pas. `nest-cli.json` les
copie vers `dist/rendering/fonts/` au build (`compilerOptions.assets`).

Source : identiques à celles distribuées par le paquet `pdfmake` (dossier
`fonts/Roboto/`). Ne pas modifier — remplacer uniquement par une version
officielle de Roboto si mise à jour nécessaire.
