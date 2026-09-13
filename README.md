# Lunori

[Website](https://lunori-translate.vercel.app) · [Installation skill](skills/install-lunori/SKILL.md)

```sh
git clone https://github.com/SergeiNikolenko/lunori.git
cd lunori
node host/install.mjs
```

Then open `arc://extensions`, enable Developer mode, choose **Load unpacked**, and select this repository’s `extension` folder. Version 0.5.0.

Read the web in your language. Lunori translates web-page text with your ChatGPT account, preserving links, emphasis, and code. Its companion Codex plugin translates text directly from a conversation.

## Requirements

- macOS, Chrome or Arc, Node.js 22 or newer.
- A compatible ChatGPT or Codex desktop installation, or the Codex CLI on PATH.
- ChatGPT sign-in with access to a supported text model. Translation consumes the account's shared limits. Fast can use more. No API key is needed.

Windows, Linux, PDF/OCR, video subtitles, and input-field translation are not included in this release. This is an independent project, not an OpenAI or Vercel product.

## Browser installation

1. Extract the macOS download to a folder you intend to keep.
2. Install Node.js from https://nodejs.org if needed. Open ChatGPT/Codex and sign in with ChatGPT.
3. Open Terminal in the extracted folder and run `zsh Install.command` (or double-click Install.command).
4. Open `chrome://extensions` (Arc: `arc://extensions`), enable Developer mode, choose **Load unpacked**, and select the `extension` folder.
5. Pin Lunori, open a normal web page, and choose **Translate page**. Choose the translation language, model, and speed in the menu.

The companion is copied to `~/Library/Application Support/Lunori/Companion`. Keep the extension folder where it is after loading it. Install directly in developer mode. No store registration or fee is required.

When installing a future store build with a different extension ID, run `node host/install.mjs EXTENSION_ID` using the ID shown on chrome://extensions. This replaces the companion's allowed extension ID.

## Controls

- Click the translation icon to translate or restore the original.
- Hover to reveal the menu. Drag either toolbar button to reposition; drop near an edge to dock.
- Hide in the menu, or drag to the hide target. Use Undo immediately, **Alt+Shift+H** on an injected page, or the extension popup's **Show toolbar** to restore it.
- **Alt+Shift+T** starts translation/restores the original on the active page.
- Choose **Bilingual** or **Translation only**. Visible paragraphs translate in parallel; scrolling continues the translation.
- Models are read from your account. Fast is available only where supported.
- **Connect another account** opens official ChatGPT sign-in. It is optional if this computer is already signed in.

## Privacy

Text selected for translation is sent to OpenAI through the local runtime. Account credentials remain in the runtime's local credential storage; Lunori does not include them in tool results. A separately connected account is stored under `~/Library/Application Support/LunaTranslate/account` (the legacy folder name is retained for upgrades). Preferences are stored locally in the extension. Translation cache is bounded and kept in memory. No analytics or page-text backend is operated by Lunori. See PRIVACY.md.

## Remove

Remove the extension through the browser, then run `node host/uninstall.mjs` from this folder to remove native-host registration and the installed companion. This preserves your ChatGPT sign-in. To remove a separately connected Lunori account as well, delete the legacy Lunori account folder and account-source.json explicitly; do not delete your main ChatGPT/Codex profile.

## Development

`npm ci`, `npm run build`, `npm run typecheck`, `npm test`. `npm run preview` serves the local UI. `npm run smoke` performs a real translation and uses account limits. The release ZIP contains no Node dependencies: the companion itself uses Node's standard library.
