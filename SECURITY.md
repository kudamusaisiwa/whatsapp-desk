# Security

Do not post API keys, customer conversations, browser profiles or unredacted logs in public issues.

Use the repository's private vulnerability reporting feature under **Security → Advisories → Report a vulnerability** to report a security problem. Include the affected version, a minimal reproduction using synthetic data, the expected behavior and potential impact. If private reporting is unavailable, open a minimal public issue asking for a private reporting channel without disclosing exploit details or private data.

If an API key is exposed, revoke it in the provider's dashboard and replace it in Settings. Removing it from a file does not revoke the credential.

The extension stores owner-supplied provider API keys in local Chrome extension storage, restricted to trusted contexts. Keys are not independently encrypted, and access to the browser profile or extension developer tools can expose them. Requests send task-specific business/chat data, images or audio to the selected upstream provider as described in [README.md](README.md) and [docs/ai-providers.md](docs/ai-providers.md). The extension does not include provider keys or ChatGPT subscription tokens in release packages. It does not currently implement Sign in with ChatGPT.

The latest published release receives fixes on a best-effort basis. Automated checks use fixtures; report live compatibility problems with browser and WhatsApp versions, without customer data.
