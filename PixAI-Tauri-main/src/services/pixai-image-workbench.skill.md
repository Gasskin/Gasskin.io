---
name: pixai-image-workbench
description: Route image generation, image editing, prompt inspiration, prompt enrichment, gallery lookup, and image export through the local PixAI desktop workbench via PixAI Codex Bridge. Use when the user asks Codex to generate or edit images with PixAI, use the PixAI workbench, call PixAI Bridge, manage PixAI generated images, or avoid the default image-generation tool in favor of the local desktop app.
---

# PixAI Image Workbench

Use the running PixAI desktop app as Codex's image workbench through its local Codex Bridge.

## Bridge

- The client reads the current bridge URL from `bridge.json` in the installed skill directory.
- Override with PIXAI_CODEX_URL or --url for one-off manual connections.
- The PixAI desktop app must be running before using this skill.
- Make one bridge request at a time. Wait for a response before issuing the next generation, prompt, or gallery operation.
- Start every task with a health check:
  node "$CODEX_HOME/skills/pixai-image-workbench/scripts/pixai-codex.mjs" health

## Commands

Prefer the bundled client:

    node "$CODEX_HOME/skills/pixai-image-workbench/scripts/pixai-codex.mjs" health
    node "$CODEX_HOME/skills/pixai-image-workbench/scripts/pixai-codex.mjs" generate --prompt "a clean product photo" --ratio 1:1 --n 1
    node "$CODEX_HOME/skills/pixai-image-workbench/scripts/pixai-codex.mjs" inspire
    node "$CODEX_HOME/skills/pixai-image-workbench/scripts/pixai-codex.mjs" enrich --prompt "short prompt"
    node "$CODEX_HOME/skills/pixai-image-workbench/scripts/pixai-codex.mjs" history --limit 5
    node "$CODEX_HOME/skills/pixai-image-workbench/scripts/pixai-codex.mjs" image --id <historyId>
    node "$CODEX_HOME/skills/pixai-image-workbench/scripts/pixai-codex.mjs" reedit --id <historyId> --prompt "make it dusk"

If CODEX_HOME is unset, use the equivalent path under ~/.codex/skills/pixai-image-workbench/scripts/pixai-codex.mjs.

## Workflow

1. Run health. If it fails, tell the user to open PixAI desktop and keep the bridge enabled.
2. For text-to-image, call generate with --prompt, --ratio, --n, and optional --model, --quality, --size, --outputFormat, --background, or --moderation.
3. For image editing, use reedit --id <historyId> for an existing PixAI image, or generate --referenceImagePaths "C:\path\image.png" --prompt "..." for local references.
4. For prompt help, call inspire for a fresh prompt or enrich --prompt "..." to expand a draft.
5. Report the returned items[].id and items[].bridgeFileUrl so the image can be inspected or reused.
6. Use history, image, favorite, delete, or export when the user asks to manage generated images.

Do not use external image-generation tools for PixAI-routed tasks unless the bridge is unavailable and the user explicitly chooses a fallback.
