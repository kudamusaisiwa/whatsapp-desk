# Contributing to Desk AI for WhatsApp Web

Use Node.js 22.12 or later. Install dependencies with `npm ci`, make focused changes, and run `npm run check` before opening a pull request. Describe the behavior changed and how you checked it.

Use fictional chats, documents and invalid placeholder credentials in tests. Never commit real API keys, customer conversations, browser profiles, business records or screenshots containing private information. Run Gitleaks against your changes before publishing. See SECURITY.md for private security reports.

Preserve the review and automatic-send safeguards. Provider work must keep credentials in the trusted extension worker, out of page/panel state, logs and release artifacts. Add synthetic tests for request formatting, model discovery, capability failures, provider-specific errors and per-task routing. Do not claim provider or speech-to-text support until its adapter is implemented and verified. Live browser validation should use your own account and synthetic data; explain manual checks and remaining limitations in your pull request.

Contributions are licensed under the MIT License in LICENSE. Keep third-party copyright and license notices when adding dependencies or assets.
