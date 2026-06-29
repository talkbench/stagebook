# Bundled font provenance

`InterVariable.woff2` is vendored (not fetched at runtime) so every participant
sees the same font regardless of network, CSP, or CDN availability — the
measurement-instrument guarantee. See deliberation-lab/stagebook#412.

| Field   | Value                                                                   |
| ------- | ----------------------------------------------------------------------- |
| Source  | https://github.com/rsms/inter — release `v4.1`, asset `Inter-4.1.zip`   |
| Member  | `web/InterVariable.woff2`                                               |
| Size    | 352240 bytes                                                            |
| SHA-256 | `693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3`      |
| License | SIL Open Font License 1.1 — see `Inter-OFL.txt` (no Reserved Font Name) |

To re-verify the bundled binary against this record:

```bash
shasum -a 256 InterVariable.woff2
# → 693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3
```

To re-vendor from upstream:

```bash
gh release download v4.1 --repo rsms/inter --pattern Inter-4.1.zip
unzip -p Inter-4.1.zip web/InterVariable.woff2 > InterVariable.woff2
```
