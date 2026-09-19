# Canonical visual schema

Use this schema for the image-to-JSON step. Keep values short, concrete, and in Chinese unless the user requests another output language. Empty arrays and empty strings are valid when a detail is not visible.

```json
{
  "subject": {
    "type": "person | animal | object | environment | mixed",
    "count": 1,
    "identity": "visible identity or character, without guessing a real name",
    "gender": "visible presentation only",
    "age_range": "child | teen | young adult | adult | older adult | unknown",
    "features": ["visible facial or body features"],
    "hair": ["color, length, texture, styling"],
    "makeup": ["visible makeup or grooming"],
    "body": ["visible body type, posture constraints"]
  },
  "pose_expression": {
    "pose": "",
    "expression": "",
    "gaze": "",
    "gesture": ""
  },
  "wardrobe": {
    "garments": [],
    "colors": [],
    "materials": [],
    "accessories": []
  },
  "scene": {
    "location": "",
    "background": "",
    "props": [],
    "weather_or_time": ""
  },
  "lighting": {
    "type": "",
    "direction": "",
    "contrast": "",
    "color_temperature": "",
    "shadows": ""
  },
  "camera": {
    "shot": "close-up | medium | full-body | wide | macro",
    "angle": "",
    "lens": "",
    "depth_of_field": "",
    "film_stock": "",
    "motion": ""
  },
  "composition": {
    "framing": "",
    "aspect_ratio": "",
    "layout": "",
    "subject_position": ""
  },
  "style": {
    "medium": "photo | illustration | 3d | mixed",
    "aesthetic": "",
    "rendering": "",
    "era": ""
  },
  "colors": {
    "palette": [],
    "dominant": [],
    "accents": [],
    "contrast": ""
  },
  "mood": [],
  "text_elements": [
    {
      "text": "",
      "placement": "",
      "typography": ""
    }
  ],
  "constraints": ["must preserve", "must avoid"],
  "reference_image_roles": [
    "identity",
    "pose",
    "wardrobe",
    "composition",
    "lighting",
    "style"
  ],
  "search_terms_zh": ["curated retrieval terms in Chinese"],
  "search_terms_en": ["curated retrieval terms in English"],
  "uncertain": ["details that cannot be determined reliably"]
}
```

## Extraction rules

- Use visible evidence, not assumptions about gender, age, ethnicity, occupation, or identity.
- Keep `identity` as a description such as `年轻亚洲女性` or `白发女性角色`; do not assign a real person's name.
- `search_terms_zh` is important for retrieval. Put 5-12 high-signal terms there, combining subject, pose, wardrobe, scene, lighting, camera, and style.
- Put distinctive visual nouns in `search_terms_en`; do not translate every sentence.
- Preserve exact visible text in `text_elements`; do not invent text.
- If the image is an illustration or 3D render, set `style.medium` accordingly instead of forcing photographic language.
- `reference_image_roles` tells the final prompt which parts of the image should be treated as references. For example, use `identity` only when the user wants the same person and has the right to do so.
