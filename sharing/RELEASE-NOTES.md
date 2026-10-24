WhatsApp Desk is an open-source Chrome extension for WhatsApp Web, created by **Kudakwashe Musasiwa** and licensed under **MIT**.

![WhatsApp Desk preview with a fictional customer conversation and reply assistant](https://raw.githubusercontent.com/kudamusaisiwa/whatsapp-desk/main/docs/images/whatsapp-desk-preview.png)

*WhatsApp Desk design preview with fictional sample data. No live customer chats or API key are shown.*

## Feature highlights

- **Live 24-hour response timer:** see hours, minutes and seconds remaining from the latest observed customer message, with clear open/closed status to help manage follow-ups.
- **WhatsApp Business setup by QR code:** keep using your existing WhatsApp Business account through WhatsApp Web. Scan its QR code from your phone; WhatsApp Desk needs no Meta Business Manager or WhatsApp Cloud API setup.
- **AI replies that know your business:** upload your services, prices, policies and FAQs, then draft answers grounded in your own documents.
- **Picture and receipt understanding:** read loaded photos, screenshots and proofs of payment in the context of the conversation, with human review for unclear details or mismatches.
- **Follow-ups and human takeover:** save client notes, schedule reminders and pause automation when a person needs to step in.
- **Your key, your control:** bring your own OpenAI key, review drafts before sending and enable automatic replies only when you are ready.

## Download this file

**[Download WhatsApp-Desk.zip](https://github.com/kudamusaisiwa/whatsapp-desk/releases/download/v0.3.2/WhatsApp-Desk.zip)** — this is the ready-to-install extension.

For Chrome Web Store submission, use **WhatsApp-Desk-WebStore.zip** from the
same release. It has `manifest.json` at the ZIP root, keeps automatic sending
off, and uses the deployed seven-day trial and one-time $9.99 hosted Stripe
Payment Link. Do not upload the manual-install ZIP to the Web Store.

In the **Assets** section below, choose **WhatsApp-Desk.zip**. GitHub also shows **Source code (zip)** and **Source code (tar.gz)**: those are developer downloads and cannot be loaded straight into Chrome.

## Install in Chrome

1. **Download WhatsApp-Desk.zip and unzip it.**
2. Keep the extracted **WhatsApp Desk** folder somewhere permanent, such as Documents.
3. Open **`chrome://extensions`** in Chrome and turn on **Developer mode**.
4. Click **Load unpacked** and select this folder inside the unzipped download:

   **`WhatsApp Desk/releases/WhatsApp-Desk`**

   Open **WhatsApp Desk** → **releases** → select **WhatsApp-Desk**.
5. Open or refresh **[WhatsApp Web](https://web.whatsapp.com)**. The assistant appears on the right.

On Mac, double-click the ZIP to unzip it. On Windows, right-click → **Extract All**. Keep Developer mode on and keep the extracted folder. No coding is needed.

**“Manifest file is missing or unreadable”?** Click **Cancel**, then **Load unpacked** again and select **`WhatsApp Desk/releases/WhatsApp-Desk`**.

Requires desktop Chrome 120 or later. A managed work browser may require IT approval.

### Link your WhatsApp Business account

Open [WhatsApp Web](https://web.whatsapp.com). On your phone, open **WhatsApp Business → Linked devices → Link a device**, then scan the QR code shown on your computer. After linking, the extension works beside your chats. See [WhatsApp’s official QR linking guide](https://faq.whatsapp.com/878854700132604/) for the phone-specific steps.

## Installation examples

These examples show Dia with the earlier MG Desk name. For Chrome, open `chrome://extensions` and use the **Developer mode** and **Load unpacked** controls shown below.

**1. Turn on Developer mode.**

![Enable Developer mode in the extensions page](https://raw.githubusercontent.com/kudamusaisiwa/whatsapp-desk/main/docs/images/enable-developer-mode.png)

**2. Click Load unpacked, then select `WhatsApp Desk/releases/WhatsApp-Desk`.**

![Click Load unpacked in the extensions page](https://raw.githubusercontent.com/kudamusaisiwa/whatsapp-desk/main/docs/images/load-unpacked.png)

### Earlier design example

The supplied screenshot below shows the earlier MG Desk name with fictional sample data.

![Earlier MG Desk design preview supplied as an example](https://raw.githubusercontent.com/kudamusaisiwa/whatsapp-desk/main/docs/images/mg-desk-preview-example.png)

## Connect your key and business

1. Create your own key on the **[OpenAI API keys page](https://platform.openai.com/api-keys)** and set up API billing. API usage is charged separately from a ChatGPT subscription.
2. In WhatsApp Desk, open **Settings**, paste your key and click **Save key & connect**.
3. Select a model available to your project that supports Responses and structured output; images also require image input. Enter your business name, set the date order to match WhatsApp and click **Save workspace settings**.
4. In **Knowledge**, upload your approved business documents or write a note about your services, prices, hours and policies.
5. Open an individual conversation and choose **Draft a reply**. Review or edit it in the WhatsApp message box before sending.

The extension starts with **no key or business knowledge**. **Auto-send, Draft as messages arrive and Reply across all chats start off.**

The extracted **WhatsApp Desk** folder includes **START-HERE.html** and **START-HERE.txt**. The ZIP layout and guides now use the exact folder path above; the extension code is v0.3.2.

## Included and privacy

AI reply drafts, local business knowledge, picture/screenshot understanding, client notes, follow-ups and optional automatic replies. Your key is stored locally in the extension; drafting sends relevant business/chat information and included images directly to OpenAI. See the [README](https://github.com/kudamusaisiwa/whatsapp-desk#privacy-and-keys) for storage details and practical limits.

Copyright (c) 2026 **Kudakwashe Musasiwa**, initial author. The ZIP includes the MIT license and third-party notices. This is an independent project, not an official Meta/WhatsApp product.

The extension code passed TypeScript and 90 automated tests. The refreshed package passes the production build, built-folder/ZIP secret scans and ZIP integrity checks. No secrets were detected. Live behavior on a recipient’s Chrome/WhatsApp installation still needs to be checked after setup. The matching SHA-256 checksum and scan summary are attached below.
