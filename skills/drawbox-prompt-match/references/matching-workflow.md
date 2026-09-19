# Matching and adaptation workflow

## Retrieval model

`scripts/match_drawbox.mjs` scores every modern DrawBox prompt against the canonical visual JSON. It combines:

- field-weighted lexical matching;
- Chinese word segmentation and CJK bigrams;
- English word tokens;
- inverse document frequency, so rare details matter more than generic words;
- exact phrase matches in title, category, and prompt text.

The result is a ranked list, not a semantic truth claim. Treat the score as a triage signal and read the returned prompt before using it.

## Suggested selection

Prefer a candidate when it agrees with the image on several independent dimensions, especially:

1. pose and gaze;
2. subject or scene type;
3. framing and camera distance;
4. wardrobe silhouette;
5. lighting and rendering style.

A title match alone is weak. A candidate with moderate lexical score but structurally correct pose and lighting is usually better than a high-scoring candidate that only repeats a category word.

If the top results are too generic, add specific terms to `search_terms_zh`, such as `窗边侧光`, `低角度仰拍`, `半身构图`, `黑色皮衣`, or `胶片颗粒`, and rerun with `--refresh` only when the DrawBox data itself may have changed.

## Adaptation

Use the reference image as the source of truth for:

- the visible person or character and their pose;
- composition, crop, camera height, and lens distance;
- visible clothing, props, background, and text.

Use the selected DrawBox prompt for:

- prompt structure and detail density;
- idiomatically useful lighting, camera, and rendering language;
- optional style or mood refinements requested by the user.

Write the final prompt as a coherent instruction, not as a list copied from three records. Keep a short source note with the selected DrawBox IDs so the result can be traced.

## Example invocation

Create a UTF-8 JSON file from the schema, then run the matcher from the active skill directory:

```powershell
node ".\skills\drawbox-prompt-match\scripts\match_drawbox.mjs" --input "$env:TEMP\drawbox-visual.json" --root "C:\AI\1\drawbox" --top 8
```

A representative visual JSON is included in `visual-schema.md`. The script accepts either a file with `--input` or JSON through standard input.
