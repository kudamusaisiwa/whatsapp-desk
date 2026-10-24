WhatsApp Desk is an open-source Chrome extension for WhatsApp Web, created by **Kudakwashe Musasiwa** and licensed under **MIT**.

## Download this file

**[Download WhatsApp-Desk.zip](https://github.com/kudamusaisiwa/whatsapp-desk/releases/download/v0.3.1/WhatsApp-Desk.zip)** — this is the ready-to-install extension.

In the **Assets** section below, choose **WhatsApp-Desk.zip**. GitHub also shows **Source code (zip)** and **Source code (tar.gz)**: those are developer downloads and cannot be loaded straight into Chrome.

## Install in Chrome — Mac and Windows

1. **Extract the ZIP.** On Mac, double-click it. On Windows, right-click → **Extract All** → **Extract**.
2. **Open the extracted folder** in Finder or File Explorer. Check that `manifest.json` is directly inside it. If there is another `WhatsApp-Desk` folder inside, open that inner folder.
3. Move that **WhatsApp-Desk** folder somewhere permanent, such as **Documents**. Keep it there: Chrome loads the extension from that folder.
4. Open Chrome, type **`chrome://extensions`** in its address bar and press **Enter**.
5. Turn on **Developer mode** at the top right.
6. Click **Load unpacked**. Select the **whole WhatsApp-Desk folder containing `manifest.json`**, then click **Select Folder** (Windows) or **Select** (Mac). Do not select the ZIP or `manifest.json` itself.
7. Check that a **WhatsApp Desk** card appears in Chrome’s extension list and its enable switch is on. Keep Developer mode enabled.
8. Open **[WhatsApp Web](https://web.whatsapp.com)** and sign in. If it was already open, refresh it. The WhatsApp Desk panel appears on the right.

The folder you select should look like this:

```text
WhatsApp-Desk/          ← select this folder in Load unpacked
    manifest.json      ← must be directly inside the selected folder
    background.js
    content.js
    panel.html
    START-HERE.html
    assets/
    icons/
```

**No coding, npm or terminal commands are needed for this ZIP.** Requires desktop Chrome 120 or later. A managed work browser may require approval from your IT administrator.

## If Chrome says “Manifest file is missing or unreadable”

Click **Cancel**, then **Load unpacked** again. Choose the folder that has `manifest.json` **directly inside it**, as shown above.

- If you selected the outer extraction folder, open it and choose the inner **WhatsApp-Desk** folder.
- If you downloaded **Source code (zip)**, use **[WhatsApp-Desk.zip](https://github.com/kudamusaisiwa/whatsapp-desk/releases/download/v0.3.1/WhatsApp-Desk.zip)** instead.
- If you deliberately built the developer source project, choose its **`dist`** folder. The project root (for example, `Documents/WhatsApp Desk`) cannot be loaded as an extension.

## Connect your key and business

1. Create your own key on the **[OpenAI API keys page](https://platform.openai.com/api-keys)** and set up API billing. API usage is charged separately from a ChatGPT subscription.
2. In WhatsApp Desk, open **Settings**, paste your key and click **Save key & connect**.
3. Select a model available to your project that supports Responses and structured output; images also require image input. Enter your business name, set the date order to match WhatsApp and click **Save workspace settings**.
4. In **Knowledge**, upload your approved business documents or write a note about your services, prices, hours and policies.
5. Open an individual conversation and choose **Draft a reply**. Review or edit it in the WhatsApp message box before sending.

The extension starts with **no key or business knowledge**. **Auto-send, Draft as messages arrive and Reply across all chats start off.**

The ZIP includes **START-HERE.html**, a visual guide you can double-click to open, and **START-HERE.txt** for plain-text instructions. These installation guides have been refreshed to explain folder selection and the missing-manifest error; the extension code remains v0.3.1.

## Included and privacy

AI reply drafts, local business knowledge, picture/screenshot understanding, client notes, follow-ups and optional automatic replies. Your key is stored locally in the extension; drafting sends relevant business/chat information and included images directly to OpenAI. See the [README](https://github.com/kudamusaisiwa/whatsapp-desk#privacy-and-keys) for storage details and practical limits.

Copyright (c) 2026 **Kudakwashe Musasiwa**, initial author. The ZIP includes the MIT license and third-party notices. This is an independent project, not an official Meta/WhatsApp product.

The extension code passed TypeScript and 90 automated tests. The refreshed package passes the production build, built-folder/ZIP secret scans and ZIP integrity checks. No secrets were detected. Live behavior on a recipient’s Chrome/WhatsApp installation still needs to be checked after setup. The matching SHA-256 checksum and scan summary are attached below.
