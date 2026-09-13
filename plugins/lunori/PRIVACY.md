# Lunori privacy policy

Effective September 13, 2026. Publisher: Sergei Nikolenko.

Lunori translates text you choose to read. The browser extension accesses the active page after you invoke it. It extracts text paragraphs, replaces inline elements with formatting markers, and sends text to the native companion. While translation is active, visible and newly loaded paragraphs may also be translated. Password inputs, editable fields, scripts, and code blocks are excluded by the content extractor. Sensitive information can still appear in ordinary page text; choose pages accordingly.

The companion and the Codex plugin send requested text to OpenAI using your installed Codex runtime and ChatGPT account. OpenAI's account terms and data controls apply: https://openai.com/policies/privacy-policy/. The publisher does not receive or sell your page text, account credentials, or translation history. There is no Lunori translation server, advertising, or analytics service.

The extension stores language, mode, model, speed, theme, toolbar position and visibility in local extension storage. The background worker holds a bounded, in-memory translation cache. Text is not written to a Lunori translation-history database. The runtime uses ephemeral translation sessions; provider processing and the runtime's own operational data are governed separately.

Account status includes email and plan and is displayed locally. The plugin's account_status tool returns this status to the calling assistant and it may therefore appear in the conversation. Sign-in tokens are managed by the installed runtime. A separate account connection uses ~/Library/Application Support/LunaTranslate/account; the legacy name is retained for upgrades. No credentials are bundled with the software or returned by its tools.

The public website stores only a color-theme preference in localStorage. Downloads and page requests are served by Vercel, which processes normal hosting request data such as IP addresses and user agents under https://vercel.com/legal/privacy-policy. The website does not receive translation requests. The interactive landing-page example uses predefined text locally and sends nothing for translation.

Remove the extension to clear its local preferences. Stop or restore translation to remove rendered translations; memory caches are cleared when the background process exits. Run host/uninstall.mjs to remove the companion. It preserves sign-in deliberately; you can separately remove the dedicated account directory and account-source.json. For questions or a private support route, use the contact links on the publisher profile: https://github.com/SergeiNikolenko. Do not post account tokens or private page text in public support messages.
