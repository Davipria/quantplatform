"""Local news sentiment: a Loughran-McDonald word-count score, no model, no network call.

The word lists (`lm_sentiment.json`, 401 positive / 2393 negative / 37 negation words) are the finance-tuned Loughran-McDonald
dictionary (Notre Dame, free for research use: https://sraf.nd.edu/loughranmcdonald-master-dictionary/), built from actual 10-K
wording rather than everyday English, via a commonly-redistributed derived word list (gist.github.com/sh-mukherjee). General
sentiment lexicons misclassify routine financial vocabulary (e.g. "tax", "liability", "cost" read as negative in everyday
English but are neutral filing language), which is why a finance-specific list is used here instead of e.g. VADER.
"""
import json
import re
from pathlib import Path

import data

_LEXICON = json.loads((Path(__file__).resolve().parent / "lm_sentiment.json").read_text(encoding="utf-8"))
POSITIVE = frozenset(_LEXICON["positive"])
NEGATIVE = frozenset(_LEXICON["negative"])
NEGATE = frozenset(_LEXICON["negate"])
NEGATION_WINDOW = 3  # words back to check for "not", "no longer", etc.


def score_text(text: str) -> dict:
    """{'label': 'positive'|'neutral'|'negative', 'score': net sentiment word share, 'positive': count, 'negative': count}."""
    words = re.findall(r"[a-z']+", text.lower())
    pos = neg = 0
    for i, w in enumerate(words):
        if w not in POSITIVE and w not in NEGATIVE:
            continue
        negated = any(p in NEGATE for p in words[max(0, i - NEGATION_WINDOW):i])
        is_positive = (w in POSITIVE) != negated  # flip polarity under negation
        if is_positive:
            pos += 1
        else:
            neg += 1
    label = "positive" if pos > neg else "negative" if neg > pos else "neutral"
    return {"label": label, "score": (pos - neg) / len(words) if words else 0.0, "positive": pos, "negative": neg}


def tag(articles: list[dict]) -> list[dict]:
    """Adds a `sentiment` field (see score_text) to each article, scored on its headline + summary."""
    for a in articles:
        text = a["headline"] + (". " + a["summary"] if a.get("summary") else "")
        a["sentiment"] = score_text(text)
    return articles


def news_sentiment(symbol: str, days: int = 14) -> dict:
    """Net sentiment over recent news, for a single-number summary (Rankings/Compare): (positive - negative) articles as a
    percentage of all articles considered. Reuses `data.company_news`, so it is the same feed and cache as the News tab."""
    articles = tag(data.company_news(symbol, days))
    if not articles:
        raise data.DataError(422, "No recent news")
    pos = sum(1 for a in articles if a["sentiment"]["label"] == "positive")
    neg = sum(1 for a in articles if a["sentiment"]["label"] == "negative")
    return {"score": (pos - neg) / len(articles) * 100, "positive": pos, "negative": neg, "count": len(articles)}
