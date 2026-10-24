# Project working agreements

## User feedback screenshots

- `feedback/` is the user's fixed directory for screenshots reporting project problems.
- When asked to inspect the latest screenshot, enumerate image files and use filesystem modification time to select the newest. If several relevant images share that time, inspect all of them.
- Re-read images for each feedback request: the user may overwrite a file such as `image.png` with a new screenshot. Do not rely on an earlier view of the same filename.
- Preserve original feedback files. Do not delete, rename, or overwrite them. Write verification screenshots and comparison artifacts under `artifacts/`, separately from feedback.
- Inspect the screenshot and the relevant implementation before diagnosing or proposing a fix. Report the image path used.

## Change records

Save a concrete plan under `docs/plans/` before implementation and a factual, linked completion record under `docs/builds/` after verification, following the user's global working agreements. Preserve read-only requests.
