---
name: drawbox-prompt-match
description: Match an uploaded reference image or structured visual description to DrawBox prompts, then adapt the best matches into an image-generation prompt. Use when a user wants photo-to-JSON analysis, prompt retrieval, or generation inspired by DrawBox.
metadata:
  short-description: Match photos to DrawBox prompts
---

# DrawBox Prompt Match

Use this skill to turn a reference image into a structured visual description, retrieve relevant prompts from the live DrawBox catalog, and synthesize a final image-generation prompt.

## Workflow

1. Inspect the uploaded image directly. Describe only visible details. Leave uncertain fields empty rather than inventing them.
2. Build the canonical visual JSON from `references/visual-schema.md`. Write it to a UTF-8 temporary JSON file before invoking the matcher.
3. Run the matcher from this skill's `scripts/` directory:

```powershell
node "<skill-dir>\scripts\match_drawbox.mjs" --input "$env:TEMP\drawbox-visual.json" --top 8
```

The matcher uses the live DrawBox Pages data by default. For local data use `--root C:\AI\1\drawbox`. It does not require GitHub authentication.

4. Review the returned candidates. Do not copy a prompt blindly: match the mechanics that fit the image, such as pose, gaze, framing, lighting, wardrobe, and rendering style. If the user asks to preserve the person, use the uploaded image for identity and use the matched prompt only for controllable visual treatment.
5. Produce the result in this order:
   - a short normalized visual summary;
   - the top 3 DrawBox matches with ID, title, category, score, and image URL;
   - a final image-generation prompt;
   - a negative prompt when useful;
   - any unresolved image constraints.
6. If the user explicitly asks to generate an image, load and follow the `imagegen` skill. Pass the final prompt and the reference image when the image tool supports reference input. Do not claim an image was generated unless the image tool actually returns one.

## Conflict rules

- Reference image wins for identity, pose, composition, camera distance, and visible wardrobe.
- DrawBox candidate wins for prompt technique, lighting language, rendering language, and optional styling when it does not contradict the reference.
- User instructions override both.
- Never fabricate a brand, text, face detail, logo, or scene element that is not visible or requested.

## Matcher options

```text
--input <file>       Read visual JSON from a file.
--root <path>        Use a local DrawBox checkout instead of live Pages data.
--base <url>         Override the remote DrawBox Pages base URL.
--top <n>            Number of matches to return (default 8).
--category <text>    Restrict matches to a category substring.
--min-score <n>      Drop matches below this score.
--refresh            Ignore the prompt-data cache.
--format <json|text> Output format (default json).
```

Read `references/matching-workflow.md` for scoring behavior and merge guidance.
