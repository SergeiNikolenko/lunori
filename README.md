# Lunori

[Website](https://lunori-translate.vercel.app) · [MIT license](LICENSE) · [Installation skill](skills/install-lunori/SKILL.md)

Read the web in your language. Lunori translates web pages with your ChatGPT plan, preserving links, emphasis, and code. It includes an Arc/Chrome extension, a local macOS companion, and an optional assistant plugin. Version 0.6.0.

## Install

Requires macOS, Chrome or Arc, Node.js 22+, and an eligible ChatGPT Plus or Pro account with permission to use its plan in Lunori. No OpenAI API key or installed Codex runtime is required.

```sh
git clone https://github.com/SergeiNikolenko/lunori.git
cd lunori
node host/install.mjs
```

1. Open `chrome://extensions` (Arc: `arc://extensions`), enable Developer mode, choose **Load unpacked**, and select the repository's `extension` folder. Keep that folder in place.
2. Open Lunori → **ChatGPT account** → **Continue with ChatGPT**, then follow the sign-in link. Sign in and authorize ChatGPT plan usage on OpenAI's website.
3. Return to Lunori, choose an available model, and translate a normal HTTPS article. **Manage usage** opens ChatGPT's settings for app access and limits.

The companion is copied to `~/Library/Application Support/Lunori/Companion`. The release contains a bundled companion; users do not need `npm install`. Double-clicking `Install.command` is another way to run the installer. No Chrome Web Store registration or fee is needed.

## ChatGPT plan connection

Lunori implements [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source) using OAuth with PKCE and verified OpenID Connect identity. AI requests go directly from your Mac to the public Responses API with the permission you grant. This consumes your existing plan limits; it does not grant access to ChatGPT conversations. Standard speed is supported; model choices come from your connected account.

Local account records are protected with owner-only permissions in `~/Library/Application Support/Lunori/ChatGPT`. Tokens never go to extension storage or translation tool results. Refreshes are serialized across companion and plugin processes. Old ChatGPT/Codex sign-ins are not read, migrated, or removed.

Upgrading from 0.5: rerun the installer, reload Lunori on the browser's Extensions page, and connect once through the new flow. Your existing ChatGPT/Codex desktop sign-in stays intact. A successful sign-in or model list alone is not evidence of a completed translation.

## Controls

- Click the translation icon to translate or restore the original. Hover for the menu; drag either toolbar button to reposition it.
- Choose **Bilingual** or **Translation only**. Visible paragraphs translate in parallel; scrolling continues translation.
- **Alt+Shift+T** translates/restores the page. **Alt+Shift+H** restores a hidden toolbar on an activated page; the popup also has **Show toolbar**.
- **Connect another account** creates a separate ChatGPT connection for Lunori. **Manage usage** lets you review limits and disconnect access in ChatGPT settings.

Windows, Linux browser installation, PDF/OCR, video subtitles, and input-field translation are not included. This is an independent project, not an OpenAI or Vercel product.

## Privacy and removal

See [PRIVACY.md](PRIVACY.md). No Lunori translation server or analytics service is operated. Remove the browser extension, then run `node host/uninstall.mjs` to remove the companion. Uninstall preserves account records. Disconnect Lunori in ChatGPT settings and separately remove the Lunori/ChatGPT directory if you want to clear its local connection. Legacy LunaTranslate account folders are also preserved.

## Development and contributions

```sh
npm ci
npm run build
npm run typecheck
npm test
```

`npm run preview` serves a local UI preview. `npm run smoke` performs a real translation after sign-in and consumes plan usage. Authentication tests use isolated temporary profiles and fake HTTP responses; they also verify real JWT signatures with test keys.

The build bundles MIT-licensed `jose` and `proper-lockfile` dependencies into the companion and synchronizes the optional plugin. The OpenAI DevKit is not included. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for bundled dependencies. Report bugs or propose changes through GitHub issues and pull requests; never include tokens or private page text.

## License

Lunori's original code is released under the [MIT License](LICENSE). Third-party dependencies retain their licenses. OpenAI service terms, subscription eligibility, limits, and trademark rules apply separately. A paid or remotely hosted service using ChatGPT plan usage requires OpenAI's approval; the MIT license does not grant that service access.
