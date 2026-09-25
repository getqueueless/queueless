# DeepSeek features — model card

Covers `POST /admin/ask`, `POST /translate`, and the daily ops summary
(`POST /admin/summary/run`, `GET /admin/summary`). Separate from
`docs/api/model-card.md`, which covers the wait-time regression model
(`/predict`, `/admin/retrain`) — a different kind of model entirely
(supervised regression vs. an LLM API), with its own limits and risks.

## What it is

DeepSeek (`deepseek-chat`), accessed via its OpenAI-compatible chat
completions API. Three uses:

1. **Tool-calling** (`/admin/ask`): the model picks one of 8 pre-declared,
   read-only database functions and their parameters from an admin's
   natural-language question; the backend executes that function itself
   (never SQL the model writes) and asks the model a second time to phrase
   a short answer from the real result rows.
2. **Translation** (`/translate`, and automatically before sending a push
   to a patient whose saved language is Hindi or Punjabi): English text in,
   translated text out.
3. **Report generation** (the daily ops summary): given pre-aggregated
   counts, asked to write a short plain-English operations report.

## What it never sees

Every input DeepSeek receives for all three uses is either the admin's own
typed question, plain English text to translate, or the output of one of
`app/analytics.py`'s 8 whitelisted functions — every one of which returns
grouped aggregates (counts, averages, by hour/service/counter), never a
patient's name, a single patient's row, or any other row-level PII. This
is a property of what the whitelisted functions return, not a filter
applied afterward.

## Responsible-use guardrails

- **Labeled, not passed off as ground truth.** Every AI-touched response
  carries `"ai_generated": true` (or, for the daily summary, `ai_generated`
  reflects whether DeepSeek actually produced the report vs. the numeric
  fallback below).
- **The question is data, never instructions.** `/admin/ask`'s system
  prompt explicitly tells the model to treat the admin's question as the
  topic to analyze, not as commands to itself, and to ignore anything in it
  that reads like an instruction. This is defense in depth, not the actual
  security boundary — see the next point.
- **The real boundary doesn't depend on the model behaving.** Even if
  DeepSeek's response named a function outside the 8 allowed ones (whether
  from a successful injection, a hallucination, or a bug), `app/analytics.
  call_analytics` independently re-validates the function name and every
  parameter against the same whitelist before anything executes. Proven in
  `tests/test_ai_ask.py::test_non_whitelisted_function_never_executes` with
  an injection-shaped prompt.
- **Bounded cost and latency.** Every call sets `max_tokens`
  (`deepseek_max_tokens`, default 400) and a client-level timeout
  (`deepseek_timeout_seconds`, default 20s) — one slow or verbose response
  can't hang a request or run away on cost.
- **The API key is never logged.** Read once from `Settings.deepseek_api_key`
  and handed straight to the SDK's constructor (`app/ai_client.py`); no
  function in this codebase accepts or returns the raw key string.
- **Graceful, not silent, failure.** `/admin/ask` and `/translate` return a
  clear degraded result (503 for ask; the original English text for
  translate) rather than a 500 when DeepSeek is unconfigured or errors. The
  daily summary still writes the real aggregate numbers with a plain,
  clearly-labeled fallback note (`"AI summary unavailable. Raw aggregates
  recorded below."`, `ai_generated: false`) rather than producing nothing.

## Known limits

- **Translation quality is not verified against a human reviewer** — this
  is a hackathon-scale integration, not a validated medical/clinical
  translation pipeline. A mistranslated push notification is possible;
  English is always the fallback on any failure, never a blank message.
- **The tool-calling model can still misinterpret an ambiguous question**
  (e.g. picking `peak_hours` when `busiest_counters` was meant) — this
  produces a wrong but *real* answer grounded in real data, not a
  fabricated number, since the executed function and its rows are always
  real. The response's `function`/`params`/`rows` fields let an admin
  verify what was actually queried.
- **Daily summary "slow counters" framing is approximate**: the given
  whitelist has `busiest_counters` (volume) but no direct per-counter
  average-service-time function, so the report's counter-workload
  commentary is based on volume and wait-time aggregates together, not a
  single clean "slowness" metric. A `counter_avg_service_time` analytics
  function would close this gap if the DB agent adds the whitelist above.
- **Not clinical, not a staffing authority.** The staffing "suggestion" in
  the daily summary is a plain-language observation from aggregate
  patterns, not a scheduling system or a directive — a human makes the
  actual staffing call.

## Logging

Every DeepSeek API call (both the tool-selection and answer-writing calls
in `/admin/ask`, translation, and the daily summary) goes through a single
`app/ai_client.py::timed_completion` wrapper, which logs `model` and
`latency_ms` on every call, success or failure (`structlog` event
`deepseek_call`, `status: "ok"|"error"`) — never the API key, never raw
prompt content. Callers additionally log their own failure context on top
of that (`deepseek_ask_request_failed`, `deepseek_ask_answer_request_
failed`, `translate_failed`, `daily_summary_ai_failed`) with non-PII
context such as the function name, target language, or org_id/day.
