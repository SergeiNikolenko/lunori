# Lunori for Codex

Translate text using your ChatGPT account. This plugin provides translate_text, list_models, account_status, connect_account, and cancel_sign_in over a local MCP server.

## Requirements

macOS, Node.js 22+ at /opt/homebrew/bin or /usr/local/bin, and an eligible ChatGPT Plus or Pro account. Use connect_account to authorize Lunori through Sign in with ChatGPT. Model availability and usage limits come from your account. No API key is needed.

## Install

Unzip this plugin. In Codex, ask the built-in plugin-creator skill to install the extracted lunori folder into your personal marketplace, preserving its MCP server and skill. The public OpenAI directory listing is not available: this local MCP architecture requires separate local-MCP support for public submission. Start a new task after installation so Codex discovers the tools and skill. The server launches with Node and a plugin-relative working directory; it has no npm dependencies.

Example: “Use Lunori to translate this paragraph into English.” Ask “Show my available translation models” to choose a model and speed.

The plugin translates supplied text. Install the separate browser extension to translate pages in place. No browser automation or page-reading permission is included in this plugin.

See PRIVACY.md. Text is sent to OpenAI directly through the public Responses API. Credentials are isolated under ~/Library/Application Support/Lunori/ChatGPT. Legacy accounts are preserved. Account status tools may return email and plan to the current conversation, but never credentials.

Website: https://lunori-translate.vercel.app

Lunori is MIT licensed. See LICENSE and THIRD_PARTY_NOTICES.md.
