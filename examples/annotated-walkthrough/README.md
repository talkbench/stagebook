# Annotated walkthrough

A self-contained pedagogical example that tours Stagebook's treatment-file syntax. The study itself is a two-person text discussion: each participant writes an initial position on a topic, discusses it with a partner, then reflects after seeing the partner's original response.

Two treatments are generated from a single template by broadcasting over a list of topics — you'll see them side-by-side in the treatment picker.

## What this example demonstrates

| Feature                                                              | Where it lives                                                         |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Templates** with `${fieldName}` placeholders                       | `templates:` → `studyTreatment`                                        |
| **Broadcast** expansion (one template → N treatments)                | `treatments:` → `broadcast: { d0: [...] }`                             |
| **Intro / game / exit** sequences                                    | `introSequences`, `gameStages`, `exitSequence`                         |
| **Timed elements** (`displayTime`, `hideTime`)                       | Stage 1 (`*_initial`)                                                  |
| **Position-based visibility** (`showToPositions`)                    | Stage 3 (`*_reflection`) display elements                              |
| **`groupComposition`** (matching participants by condition)          | `studyTreatment.groupComposition`                                      |
| **Conditional rendering** on elements                                | Stage 3 consensus prompt                                               |
| **`display` elements** (one player's response shown to another)      | Stage 3                                                                |
| **Platform-coupled elements** (`survey` ⚠️ deprecated, `discussion`, `shared: true` open-response prompt) | Intro `Personality`, Stage 2                                           |
| **`qualtrics` element** (real iframe to an external survey)          | exit `Exit Survey`                                                     |

The platform-coupled elements render as skeleton placeholders in the viewer — they require a host that implements the corresponding `render*` slot. The `qualtrics` element is different: stagebook renders it directly as an iframe to the configured URL, so the viewer will attempt to load `example.qualtrics.com` (which will fail, since that's a placeholder URL) rather than showing a skeleton.

## How to read the file

Open `walkthrough.stagebook.yaml` in the viewer (or any editor) and scan top-to-bottom. Each stage, element, and template carries a `notes:` field explaining what it's demonstrating — the viewer surfaces these in the sidebar, and elements with notes get a small info-icon overlay you can click to focus that note.

The `notes:` fields are researcher documentation, not participant-facing content. Participant-facing copy lives in the `prompts/` directory as individual `*.prompt.md` files.

## Running it

From the viewer's landing page you can either click the **annotated-walkthrough** example card, or paste a GitHub URL to this repo's `walkthrough.stagebook.yaml` into the URL input and press Load. To run the dev viewer locally:

```
npm run dev -w stagebook-viewer
```

Once loaded, step through intro → game → exit from the sidebar, and switch between the two broadcast-generated treatments (`remote work policies`, `the four-day work week`) from the treatment picker.
