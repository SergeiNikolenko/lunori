---
name: install-lunori
description: Install or update Lunori web translation on macOS in Arc or Chrome, including its local ChatGPT companion, and diagnose missing toolbar or companion connections.
---

# Install Lunori

Source: https://github.com/SergeiNikolenko/lunori. Use an existing checkout when available; otherwise clone into a persistent user project directory. Read its README.md and host/install.mjs before installation. The compiled extension is included; npm installation is unnecessary for normal use.

## Browser installation

1. Confirm macOS, Node.js 22+, Arc or Chrome, and a compatible installed ChatGPT/Codex runtime. Sign-in must be completed by the user through the official provider flow. Never read or copy credential files.
2. Run `node host/install.mjs` from the repository root. This copies companion files into `~/Library/Application Support/Lunori/Companion` and registers native messaging for installed Chromium browsers.
3. In the requested browser, open `arc://extensions` or `chrome://extensions`. Turn on Developer mode, click Load unpacked, and select the checkout's `extension` folder. Keep that folder in place. No Chrome Web Store developer account or registration fee is needed.
4. On updates, match the installed extension by its ID and source path. The repository key produces ID `acncafgdheahmohldoadjlohcjdinjon`. Reload that extension instead of creating duplicates. If it points at a different folder, remove that specific old installation and load the new folder. Do not remove another translation extension unless the user identifies it.
5. Open a normal HTTPS article, invoke Lunori from the browser's Extensions menu, choose the target and an available model, and translate. Confirm real translated text, preserved links, and Show original restoration. A successful installer or model list alone does not prove browser integration.
6. Hide recovery: the popup's Show toolbar command; Alt+Shift+H on an activated page; or Undo immediately after hiding. Alt+Shift+T translates/restores the current page.

## Troubleshooting

If native messaging fails, rerun the installer after Node moves. Confirm the extension ID matches the native host allowed origin. The optional installer argument is an actual installed extension ID, not a guessed value. Do not hand-edit browser Preferences or Secure Preferences.

If browser UI automation cannot access the extension page, report the exact remaining browser action; do not claim installation. Do not silently restart the user's browser or modify unrelated profiles.

Model availability comes from the signed-in account. Fast is optional and can consume more shared usage. Never expose a user's local account as a public translation endpoint.

## Optional local assistant plugin

The repository contains `plugins/lunori`. Only install it if requested, using the host's plugin-creator flow and a personal marketplace. Public OpenAI store submission is not required. The browser extension is independent of the assistant plugin.

## Uninstall

Remove Lunori through the browser's Extensions page, then run `node host/uninstall.mjs`. This preserves sign-in. Remove separately linked account files only when explicitly requested; never delete the main ChatGPT profile.
