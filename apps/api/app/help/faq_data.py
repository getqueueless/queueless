"""Static FAQ, loaded once at import time -- English only, written from real
documented behaviour (docs/JUDGE_NOTES.md, docs/PAYMENTS.md, the real
migrations), not invented. English only for now, not per-entry translated:
the /help/ask endpoint still answers in the asker's own language (system
prompt instruction in app/routes/help.py), it just doesn't need a
pre-translated FAQ to do that.
"""

import json
from pathlib import Path

FAQ_PATH = Path(__file__).resolve().parent / "faq.json"

with open(FAQ_PATH) as _f:
    FAQ: list[dict] = json.load(_f)


def keyword_match(question: str, limit: int = 3) -> list[dict]:
    """Non-AI fallback: score each FAQ entry by shared words with the
    question, return the top matches. No DeepSeek call, no dependency on
    it being configured or reachable -- this must work with zero external
    services."""
    question_words = set(question.lower().split())
    scored = []
    for entry in FAQ:
        entry_words = set((entry["question"] + " " + entry["answer"]).lower().split())
        overlap = len(question_words & entry_words)
        if overlap > 0:
            scored.append((overlap, entry))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [entry for _, entry in scored[:limit]]
