# Multi-provider release plan and implementation inventory

This document describes the provider-routing release and its verification
gates. Provider model support varies by API and by the selected model; the
application must not infer capabilities from a provider name alone.

## Provider and capability matrix

The release supports credentials and model discovery for OpenAI, OpenRouter,
Kimi (Moonshot), DeepSeek, Anthropic, Google Gemini and xAI Grok. Model IDs may
also be entered directly. Capability checks and endpoint adapters determine
whether a selected model can perform each task.

| Capability | Provider/model requirement | Release behavior |
| --- | --- | --- |
| Text reply and general assistant | Text generation plus the reply output contract | Independently routed provider/model setting |
| Image and receipt understanding | Text generation and image input | Reject or clearly report incompatible model/provider selections |
| Polish | Text generation | Independently routed provider/model setting |
| Call summary | Text generation; transcript and supplied names are the task input | Independently routed provider/model setting |
| Dictation STT | Audio transcription endpoint and supported audio format | OpenAI, OpenRouter and Gemini supported; other adapters are not supported |
| Call transcription | Audio transcription endpoint and supported audio format | OpenAI, OpenRouter and Gemini supported; other adapters are not supported |
| Image generation | Not included | No generation route or UI claim |
| Text-to-speech | Not included | No TTS route or UI claim |

The provider catalog is an availability hint, not a capability guarantee. A
custom model ID follows the same validation and error path as a listed model.
Changing one task's provider/model must not silently change another task's
saved route.

## Architecture inventory

The multi-provider boundary belongs in the extension's trusted background
worker. The panel should send task intent and input through the existing
extension message bridge; it must not receive provider secrets or make direct
credentialed requests from page-facing code.

| Area | Responsibility |
| --- | --- |
| Settings and persisted types | Store provider/model choices per task and provider credentials locally; retain safe fresh-install defaults |
| Background request router | Resolve each task's saved route, validate capability, call the adapter and normalize errors/results |
| Provider adapters | Own each provider's API URL, authentication header, request schema, model-list parsing and response parsing |
| Transcription adapters | Convert supported audio/task inputs to each backend contract; retry/failure must preserve recoverable user audio where applicable |
| Message bridge | Return only non-secret status, catalog and result data to the panel |
| Manifest and build | Permit only the required provider API hosts and package no credentials or local state |
| Privacy and release docs | Name all upstreams conditionally, document data sent for each task, local key limitations and unsupported features |

Do not persist credentials inside general settings, send them in
content-script/page-facing messages, return them through `GET_STATE`, write
them to logs, or include them in a release artifact. The only key-bearing
message should be the trusted Settings-to-worker key-save request. Keep only
the minimum required provider hosts in the manifest and extension-page
connect policy.

## Migration and compatibility

1. Preserve the existing OpenAI setup and fresh-install behavior while
   introducing provider-specific credential records.
2. Migrate the current single-provider model choice to its equivalent task
   routes without discarding a user's key, workspace, local business library,
   notes or follow-ups.
3. Add independent route settings for text replies/general assistant, image
   understanding, polish, call summaries, dictation STT and call transcription.
4. Keep provider discovery, exact custom model IDs and capability validation
   explicit. Do not silently substitute a different provider or model after an
   error.
5. Keep sending safeguards: draft review remains the default, optional human
   insertion does not send, and paid Web Store builds do not enable automatic
   sending.
6. Update permissions, privacy statements, onboarding instructions and
   packaged release documentation together with implementation changes.

Existing provider settings that cannot be mapped unambiguously should be
preserved and surfaced for the user to resolve. No data migration may overwrite
local workspace content.

## Verification and release gates

- Unit tests cover each adapter's request authentication, request body,
  response parsing, model discovery and normalized failures using synthetic
  fixtures only.
- Routing tests prove each task uses its own saved provider/model and that a
  missing or unsupported capability fails clearly without silent fallback.
- Storage/bridge tests prove credentials are excluded from page messages,
  panel state, logs and licensing requests; fresh-install defaults and legacy
  OpenAI settings are covered.
- Image tests cover model capability rejection and preserve receipt safeguards:
  an image alone never establishes bank settlement or authenticity.
- Transcription tests cover OpenAI, OpenRouter and Gemini adapters, audio format limits,
  retries and failure recovery; do not claim other STT providers until an
  adapter and evidence exist.
- Build/package checks inspect the extension manifest, host permissions and
  ZIP inventory, then scan artifacts for secrets. No API or subscription keys
  may be bundled.
- Manual acceptance uses owner-controlled test accounts and synthetic chats.
  Record source/build checks separately from provider acceptance and any live
  WhatsApp verification. Never present fixtures as live provider proof.
- Review the README, guides, store listing, privacy policy and landing page as
  one release set. The paid Web Store variant must keep automatic sending
  disabled.

Sign in with ChatGPT and ChatGPT plan usage are outside this release. The
official open-source token-sharing flow needs a trusted local callback host,
PKCE/state/nonce validation, ID-token and scope checks, and protected token
storage. This browser extension cannot bind the documented `127.0.0.1` listener
by itself; no extension redirect compatibility is documented. Do not ship a
subscription sign-in button until a reviewed native companion or other
officially supported host implements and verifies the full flow. Do not bundle
provider API keys, ChatGPT credentials or subscription tokens.
