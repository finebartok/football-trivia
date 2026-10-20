# Ingest test fixtures

Small, hand-checked snapshots of upstream API responses, so the ingest tests run
offline and deterministically.

| fixture | upstream | what the ingest reads from it |
| --- | --- | --- |
| `dev-licence.json` | [Commons imageinfo for File:Example.jpg](https://commons.wikimedia.org/w/api.php?action=query&titles=File:Example.jpg&prop=imageinfo&iiprop=url\|size\|extmetadata&format=json) (trimmed to the fields used) | `licence`, `attribution`, `sourceUrl`, `width`, `height` |

`dev-licence.json` is keyed by Commons file name, the same shape `fetchLicence`
returns. Refreshing it: run `fetchLicence(['Example.jpg'])` from
`scripts/ingest/photos.js` and paste the result.
