# Desk AI for WhatsApp Web v0.5.1

A customer-isolation patch release for the open-source extension.

## What changed

- Switching customers clears the assistant instruction, generated suggestion, dictated text, polish undo state, and transient assistant status.
- Late generation, polish, and transcription results from the previous customer are ignored; stale requests are rejected even if the user switches away and returns before they finish.
- Editing within the same customer is preserved across refreshes. Client notes, business knowledge, saved WhatsApp drafts, and call notes remain intact.

## Install or update

**[Download WhatsApp-Desk.zip](https://github.com/kudamusaisiwa/whatsapp-desk/releases/download/v0.5.1/WhatsApp-Desk.zip)** and unzip it. In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, then select **WhatsApp Desk/releases/WhatsApp-Desk** inside the download. If updating an existing installation, replace its extension files in the same folder and press **Reload** to retain that extension’s local workspace. Refresh WhatsApp Web.

In **Settings**, select a credential provider, save your own key, then configure each task’s provider and model under **AI tasks and models**. Refresh model choices for your account or enter the exact model ID. Save workspace settings before using a changed route. Upload approved business knowledge and review drafts before sending.

The ZIP includes visual and plain-text setup guides, the MIT license and third-party notices. GitHub’s Source code downloads are developer archives, not installable builds.

## Verification and limits

All **205 automated tests** pass, including customer-switch, stale async result, provider routing, storage, adapter, and UI checks. TypeScript, production builds, ZIP integrity checks, and built-folder/final-ZIP secret scans pass. Automated tests do not establish live behavior in a recipient’s Chrome/WhatsApp installation. No keys, browser profiles, customer conversations, or business knowledge are included.

SHA-256 checksums and a package audit inventory accompany the extension assets.

---

# Desk AI for WhatsApp Web v0.5.0 (previous release)

Choose the AI provider and model for each part of your desk. This MIT-licensed open-source release is by **Kudakwashe Musasiwa**.

## What changed

- Added OpenRouter, Kimi (Moonshot), DeepSeek, Anthropic, Google Gemini and xAI Grok alongside OpenAI.
- Added independent saved routes for assistant replies, picture/receipt understanding, text polish, call summaries, voice dictation and call transcription.
- Added separate local credentials and model discovery for each provider, with custom model IDs and clear errors for incompatible routes.
- Preserved existing OpenAI setup, business knowledge, client notes, follow-ups and human-send defaults. Models must support the selected task; provider access and usage charges apply.
- Updated setup guides, provider documentation, privacy disclosures and the public website.

Images means understanding pictures and receipts already in a chat. Image generation and text-to-speech are not included. A receipt image cannot establish bank settlement.

## Install or update

**[Download WhatsApp-Desk.zip](https://github.com/kudamusaisiwa/whatsapp-desk/releases/download/v0.5.0/WhatsApp-Desk.zip)** and unzip it. In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, then select **WhatsApp Desk/releases/WhatsApp-Desk** inside the download. If updating an existing installation, replace its extension files in the same folder and press **Reload** to retain that extension's local workspace. Refresh WhatsApp Web.

In **Settings**, select a credential provider, save your own key, then configure each task's provider and model under **AI tasks and models**. Refresh model choices for your account or enter the exact model ID. Save workspace settings before using a changed route. Upload approved business knowledge and review drafts before sending.

The ZIP includes visual and plain-text setup guides, the MIT license and third-party notices. GitHub's Source code downloads are developer archives, not installable builds.

## ChatGPT subscription assessment

OpenAI now documents ChatGPT plan usage for eligible local open-source apps. Desk AI does **not** yet include subscription sign-in: the documented flow requires a local callback listener and protected OAuth runtime, so a native companion is needed for this extension. API keys continue to use provider API billing. See [AI providers and ChatGPT feasibility](https://github.com/kudamusaisiwa/whatsapp-desk/blob/main/docs/ai-providers.md).

## Verification and limits

All **198 automated tests** pass, including adapter, routing, storage and UI checks. TypeScript, production builds, ZIP integrity checks and built-folder/final-ZIP secret scans also pass. Test fixtures do not establish live provider acceptance or behavior in a recipient's Chrome/WhatsApp installation. No keys, browser profiles, customer conversations or business knowledge are included.

The Web Store asset is packaged separately with automatic sending disabled. A GitHub release does not submit or publish a Chrome Web Store update.

SHA-256 checksums and package audit inventories accompany the extension assets. Report issues in the [public tracker](https://github.com/kudamusaisiwa/whatsapp-desk/issues).
