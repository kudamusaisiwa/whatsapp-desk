# WhatsApp Desk

An open-source Chrome extension that puts business knowledge, AI reply drafts and follow-ups beside WhatsApp Web. Built by **Kudakwashe Musasiwa**, the initial author. Licensed under the [MIT License](LICENSE).

Bring your own **OpenAI API key** and business information. No API key, customer data or business knowledge is supplied. Automatic drafting and sending are off by default.

## Install — no coding needed

1. Download **WhatsApp-Desk.zip** from the [latest release](https://github.com/kudamusaisiwa/whatsapp-desk/releases/latest).
2. Extract it and keep the **WhatsApp-Desk** folder somewhere permanent.
3. In desktop Chrome, open `chrome://extensions` and turn on **Developer mode**.
4. Click **Load unpacked** and choose the extracted folder containing `manifest.json`.
5. Open or refresh [WhatsApp Web](https://web.whatsapp.com). WhatsApp Desk appears on the right.
6. Open **Settings**, enter your own OpenAI API key, and choose **Save key & connect**. Select a compatible model available to your project.
7. Set your business name and reply style, then add approved documents or notes in **Knowledge**.
8. Open an individual chat and choose **Draft a reply**. Review the draft in WhatsApp before sending.

Keep Developer mode enabled and keep the installed folder. Chrome 120 or later is required. Managed work browsers may require administrator approval. This is a manual installation with manual updates, rather than a Chrome Web Store listing.

The ZIP includes a [visual setup guide](sharing/START-HERE.html) and [plain-text instructions](sharing/START-HERE.txt) covering setup, troubleshooting and updates. Chrome documents this installation flow in its [official extension guide](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world).

## What it does

- **Business knowledge:** add PDF, DOCX, TXT, Markdown, CSV or JSON files, or write notes. Text extraction happens locally. Scanned PDFs need OCR first. Maximum 10 MB and 300,000 extracted characters per document; 2 million characters across the library.
- **AI replies:** grounded drafts use relevant business excerpts and up to 35 recent visible messages. Models must support Responses and structured output; picture understanding also requires image input.
- **Pictures and screenshots:** include up to six loaded images per draft, resized to a maximum 2048 px edge. Receipts can be read and compared with approved payment details; images cannot independently verify payment or authenticity. Unclear or mismatched images require review.
- **Client workspace:** local notes, stages, human takeover controls and a follow-up queue with review reminders and optional automatic sending.
- **Response timer:** a countdown based on the latest observed incoming message. It is a workflow aid, not a connection to the WhatsApp Business Platform.
- **Optional automation:** draft when messages arrive, automatically send eligible replies, and watch the newest visible inbox rows across chats. These controls start off. Review flags, human typing/takeover, changed conversations and uncertain sends pause automation.

## Privacy and keys

The key is entered at runtime and saved in `chrome.storage.local`, restricted to trusted extension contexts. It is not synced, returned in panel state or passed to the WhatsApp webpage. The extension sends it to OpenAI as the authentication header. Local storage is not independently encrypted; someone with access to the browser profile or extension developer tools may retrieve it. **Settings → Remove saved key** clears it.

AI drafting sends relevant business knowledge, recent visible chat messages and included pictures directly to `api.openai.com`. Requests use `store: false`; OpenAI's API data policies still apply. There is no hosted application backend, analytics or remotely loaded JavaScript. Knowledge, notes and follow-ups belong to this browser profile. Removing the extension clears its local data.

Only OpenAI keys are supported currently. API usage is charged to the key owner's account, [separately from a ChatGPT subscription](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform). Never put a real key in source code, screenshots, issues or shared files.

## Practical limits

Chrome must be running, the computer awake, and WhatsApp signed in for timely automation. Reminders recover when the browser resumes. The inbox monitor watches the newest rendered rows without scrolling or changing filters; keep the All inbox at the top for coverage. It does not retrieve the complete account history or monitor Archived chats. Groups and human-takeover chats are excluded from automatic replies.

The assistant reads visible page elements. WhatsApp interface changes can require updates. Photos must be loaded in the chat. Voice notes, videos and document attachments from conversations are not read. Existing human text is preserved, and automatic sends require a known open response window and an unchanged conversation. Scheduled automatic follow-ups require their exact chat open.

The current automated checks use simulated extension and WhatsApp fixtures. They do not establish live compatibility with every Chrome or WhatsApp version. This is an independent project, not an official Meta/WhatsApp product.

## Development

Use Node.js 22.12 or later.

```sh
npm ci
npm run check
```

Load the generated `dist/` folder through Chrome's **Load unpacked** button. For a fictional design preview:

```sh
npm run dev -- --port 4187
```

Open `http://127.0.0.1:4187`. The preview cannot save a real API key, call OpenAI or send WhatsApp messages.

`npm run check` runs TypeScript, unit/integration tests and the production build. Tests cover local key isolation, fresh-install defaults, knowledge retrieval, image/receipt handling, chat identity, composer insertion, inbox monitoring, reply timing and automatic-send safeguards.

## Build a shareable ZIP

Install [Gitleaks](https://github.com/gitleaks/gitleaks), plus the `zip` and `unzip` command-line utilities, then run:

```sh
npm run check
npm run package:share
```

The packaging command builds from source, includes installation guides, the MIT license and third-party license notices, permits only expected extension files, scans the built folder and ZIP for secrets, tests ZIP integrity and writes a SHA-256 checksum. It stops if scanning fails or an unexpected file is present. No browser profile, local configuration, `.env`, Git history, customer records or source tree is packaged.

Outputs:

- `releases/WhatsApp-Desk.zip` — share this file.
- `releases/WhatsApp-Desk.zip.sha256` — integrity checksum.
- `releases/WhatsApp-Desk-audit.json` — scan summary and file inventory.

Automated secret scanning reduces risk; it cannot prove that every possible credential is absent. Review your own changes before publishing. CI scans repository history and runs the checks on pushes and pull requests.

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security concerns using [SECURITY.md](SECURITY.md).

Copyright (c) 2026 **Kudakwashe Musasiwa**, initial author. The [MIT License](LICENSE) permits use, modification and redistribution while retaining its copyright and permission notice. Dependencies and fonts retain their own licenses; release ZIPs include their notices in `THIRD-PARTY-NOTICES.txt`.
