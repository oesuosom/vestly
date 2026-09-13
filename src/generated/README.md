# Generated assets — do not edit by hand

Everything in this folder is produced by `npm run icons`
(`scripts/build-icons.ts`). Hand edits are overwritten on the next run.

| Folder   | Source            | Output                                  |
|----------|-------------------|-----------------------------------------|
| `icons/` | `icons/raw/*.svg` | Monochrome UI icons → `@/generated/icons` |
| `logos/` | `logos/raw/*.svg` | Full-colour brand marks → `@/generated/logos` |

To change an icon, edit or replace the SVG in the matching `raw/` folder and
re-run `npm run icons`. Export UI icons at the full 24×24 frame so they arrive
with `viewBox="0 0 24 24"` — every icon here uses that, and the build does no
viewBox correction of its own.

Brand marks under `logos/` are third-party trademarks; see the LICENSE file.
