# Desktop Batch 3 plan (v0.3.0): models and a redesign
01 · Fix: Design turns failing on Gemini

What happened: a Design turn on Google Gemini (gemini-3.8-flash) showed "Error in file_edit: the arguments weren't valid JSON (unexpected end of JSON input)" and "there is no tool called ." and then ended with "Google Gemini: HTTP 400: Request contains an invalid argument."
Root cause, part 1: the stream reader glued tool calls together by index. Gemini's OpenAI layer sends each call whole in its own chunk, often every one with index 0 (two calls became "file_readfile_edit" with "{...}{...}" arguments), and sometimes sends arguments as a JSON object, which made the whole chunk fail to decode and get skipped silently, so the next fragment became a call with no name and half its arguments.
Root cause, part 2: those broken calls were saved into the chat as they were. Gemini has to turn every earlier call's arguments into an object and rejects a call with no name, so every request after that answered 400 INVALID_ARGUMENT, and the router had nothing else to try. Gemini 3's thought signatures (extra_content) were also dropped instead of being sent back.
Fix: a new stream reader (a new id, or a new name after complete arguments, starts a new call; index-less fragments join the last call; arguments may be a string or an object; extra_content is kept). A gatekeeper (from the phone app's ToolCalls.kt) resolves names (prefixes, case, small typos, glued names), repairs arguments (trailing commas, single quotes, cut-off JSON) and drops what can't be repaired, telling the model once to call again. Nothing with an empty name or unreadable arguments is ever saved. Before every request the history is cleaned (every call answered once, in order, no orphans, no empty turns), so chats saved by v0.2 heal too. If a provider still refuses the shape, Blaze retries once with the tool turns flattened to text. Gemini gets a scrubbed tool schema.
Tests in internal/llm reproduce each stream shape and the 400 loop against a fake server.

02 · Pollinations out of the agent loop

Pollinations can't call tools. It is never the default, never a chain entry (old configs that had it are filtered), and never used for a turn that sends tools, which is every Work action and every Design turn. Setup no longer offers it. If you allow it (Settings › Models › Routing), it can answer plain chat in Work when no other model is set up at all, and the answer is marked "chat only, no tools".
Any model the catalog marks as no-tools (Gemma on the Gemini API, DeepSeek R1 and so on), or one a provider says can't use tools, is skipped for tool turns and can't be made the default.

03 · Choose provider and model

The model chip opens a switcher: Auto (free routing), or any provider you have set up; expand one to pick any of its models (tools, vision, context and free-tier badges). /model works the same in two steps.
Settings › Models: Default model (Auto, or one model with a provider and model picker); "continue with the chain when the chosen model fails"; the Auto chain with live health per entry (average speed, ok count, resting countdown, last error, "no tools, skipped") that you can reorder, remove from, add to, or reset with "Use my free stack"; fastest-first; keyless fallback; a daily spend cap.
The chip shows which model answered each turn, and each answer ends with its route, time, and a note when a fallback answered.

04 · Ported from the phone app

Providers.kt: the provider list with key pages and quota pages, plus Cerebras and a custom OpenAI-compatible service.
ModelCatalog.kt: chat-only filtering, the provider's live list (Gemini's native list, /models elsewhere, OpenRouter's free tool models), and "Check my plan", which probes each model once and keeps the ones the key's plan allows. Blaze also ships a small built-in catalog per provider (tools, vision, context size, free tier).
FreeRouter.kt: fill-first chain, cooldowns after 429 / 5xx / auth errors, fastest healthy first, a quiet wait when the only free model is back within 25 seconds, learned "no tools" models, OpenRouter's best free tool models picked once a day.
KeyRing.kt: several keys per provider. A key that runs out on a model rests and the next key carries on with the same model.
Budget.kt: the token meter. Rate-limit headers and retry hints are remembered, and a model with no room for the request is skipped before calling it.
Usage.kt and Quota.kt: tokens and cost per model and day (Settings › Usage), and plan, balance and rate limits per provider.
PlainError.kt: provider errors become one sentence; the raw text stays behind Details.
Brains.kt: one-click OpenRouter sign-in (OAuth PKCE on a local callback), and a key pasted under the wrong provider is caught.
Left out on purpose: phone-only lanes (steps model, on-device fast lane), vision describing for photos (the desktop chat doesn't send images yet), Gemini thinking display, and the clipboard key catcher (pasting is easy on a desktop).

05 · Redesign

Sidebar: icon nav, quieter section labels, chats with dates, a keyboard hint on New chat (Ctrl N).
Top bar: segmented Work / Design, folder chip, and the model switcher.
Chat: compact one-line tool steps; the same error repeated folds into one line with ×N; older steps fold behind "N earlier steps"; the error card says what happened in one sentence with Retry, Switch model and Details; answers end with route and time, plus Copy and Retry.
Design: a real toolbar with a labelled Preview picker (always a file name or URL), device and theme as icon toggles, Select / Directions / Versions / Open; versions in a slim collapsible strip with small thumbnails; a draggable split between preview and chat.
Settings: a left sub-nav (Models, Providers & keys, Usage, Behaviour, Appearance, Memory, Skills, This computer, Updates).
Doctor, Jobs (one row per job with Log and Stop), Schedule, Project and Setup share one page layout. Light and dark both tuned.

06 · Compatibility

~/.blaze/config.json stays shared with Blaze CLI. New fields are optional, so v0.2 configs load as they are; an older CLI ignores them (but drops them if it rewrites the file). Extra keys live in the keychain next to the main key. Usage, model lists and router memory live in ~/.blaze/desktop/.
