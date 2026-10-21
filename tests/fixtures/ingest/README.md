# Ingest test fixtures

Small, recorded snapshots of upstream API responses, so the ingest tests run
offline and deterministically.

| fixture | upstream | what the ingest reads from it |
| --- | --- | --- |
| `dev-licence.json` | [Commons imageinfo for File:Example.jpg](https://commons.wikimedia.org/w/api.php?action=query&titles=File:Example.jpg&prop=imageinfo&iiprop=url\|size\|extmetadata&format=json) (recorded raw response, trimmed to the fields used) | `licence`, `attribution`, `sourceUrl`, `width`, `height` |

`dev-licence.json` is keyed by Commons file name, the same shape `fetchLicence`
returns. Regenerate it by fetching the recorded Commons `imageinfo` response for
the target file (including `extmetadata`) and trimming it to the fields the
ingest uses — do not hand-write plausible values. Zero fabrication applies to
fixtures too.
