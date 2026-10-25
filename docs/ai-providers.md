# AI providers and model routing

Desk AI for WhatsApp Web supports bring-your-own credentials for OpenAI,
OpenRouter, Kimi (Moonshot), DeepSeek, Anthropic, Google Gemini and xAI Grok.
No provider credentials or usage credits are included. Provider API usage is
billed by the provider or account owner under that provider's terms; it is
separate from a ChatGPT subscription.

## Choose a provider for each task

Settings keep independent provider and model choices for each task. This lets
you use a fast model for polishing, for example, while keeping a different
model for conversation drafts or audio transcription. Model lists are fetched
from the selected provider/account when available. You can also enter an exact
model ID; the provider must still support the task's required input and output
format.

| Task | What is sent | Compatibility |
| --- | --- | --- |
| Text replies and general assistant | Relevant business excerpts, visible conversation context, and your request | A provider model that supports the configured structured reply format |
| Image and receipt understanding | The selected conversation context plus images you include | A model with image input; receipt interpretation cannot prove payment or authenticity |
| Text polish | Only the operator text selected for polishing | A text model |
| Call summaries | The transcript, configured business name, and participant/speaker names | A text model |
| Dictation transcription | The recording you explicitly choose to transcribe | OpenAI, OpenRouter and Google Gemini adapters are available; other provider adapters are not supported |
| Call recording transcription | The audio you explicitly record and stop, with any names used as transcription hints | OpenAI, OpenRouter and Google Gemini adapters are available; other provider adapters are not supported |

Model availability and capabilities depend on the provider, account, region,
model ID and current provider API. A model appearing in a catalog does not
guarantee every capability. If a model lacks the capability a task needs,
choose a compatible model or provider. Desk AI does not generate images or
speech audio (TTS).

## Credentials and data flow

Enter provider credentials in Settings. The extension keeps them in
`chrome.storage.local` and sends them from its trusted extension worker to the
chosen provider. Credentials are not included in messages sent to the WhatsApp
page, extension panel state, product website, licensing service or release
packages. The local browser profile is not independently encrypted, so anyone
with access to the profile or extension developer tools may be able to retrieve
credentials. Remove saved credentials from Settings when they are no longer
needed.

The selected provider receives only the content required by the task you run.
For drafting this can include relevant business excerpts, visible chat content
and included images. Dictation and call transcription send audio only after you
start those actions; call summaries send the transcript and the names you
provide. Polishing sends only the selected operator text. Provider data
retention and privacy terms apply to those requests. Review the provider's
current documentation and terms before sending customer information.

Automatic replies and automatic sends remain off in the open-source release by
default. Review generated text before sending. The paid Chrome Web Store build
keeps automatic sends disabled.

## ChatGPT plan usage is a separate future integration

The current provider settings use API credentials. OpenAI API billing is
separate from a ChatGPT plan. Sign in with ChatGPT's documented open-source
token-sharing flow can authorize eligible local tools to make Responses API
requests using a user's ChatGPT plan, but Desk AI does not ship that sign-in or
subscription-usage integration today.

The official flow requires a local HTTP callback listener on `127.0.0.1`,
fresh PKCE, `state` and OIDC `nonce`, ID-token validation, scope checks and
protected token storage. A Chrome extension cannot itself bind a local HTTP
listener, and an extension identity redirect is not documented as a compatible
callback. A future implementation would need a trusted native companion (or
another officially supported host) to own sign-in, callback validation and
token storage. Until that exists, do not treat an API key as ChatGPT plan
access or promise a ready-to-use ChatGPT button. Any native companion must keep
credentials out of the web page and send inference through OpenAI's public
Responses API according to its current requirements: account-scoped model
discovery, `store: false`, `stream: true`, and success only after
`response.completed`. No subscription-based speech-to-text endpoint is
established here.

Official references:

- [Sign in with ChatGPT for open-source apps](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)
- [Sign in and callback flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [OpenAI API and ChatGPT billing are separate](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform)

## Provider API references

- [OpenRouter chat completions](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request) and [transcription](https://openrouter.ai/blog/tutorials/transcription-on-openrouter/)
- [Kimi API and model capabilities](https://www.kimi.ai/help/kimi-api/api-overview)
- [DeepSeek image input](https://api-docs.deepseek.com/guides/vision/)
- [Anthropic Messages API](https://docs.anthropic.com/en/api/messages)
- [Gemini audio](https://ai.google.dev/gemini-api/docs/audio) and [Gemini 3.8 Flash inputs](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)
- [xAI chat completions](https://docs.x.ai/developers/rest-api-reference/inference/chat-completions)
