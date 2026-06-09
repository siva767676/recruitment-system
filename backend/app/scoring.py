"""Resume-vs-JD scoring engine.

Combines structured matching (skills / experience / education / keywords) with
semantic similarity. Semantic similarity uses Sentence-Transformers embeddings
when available; if the model can't be loaded (e.g. no torch wheel on this Python
version), it transparently falls back to a Jaccard keyword overlap so the whole
system still runs end-to-end without the heavy ML dependency.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Dict, List

from .config import REVIEW_THRESHOLD, WEIGHTS
from .parser import (extract_keywords, highest_education_rank,
                     normalize_for_matching)

_model = None
_model_failed = False


def _get_model():
    global _model, _model_failed
    if _model is not None or _model_failed:
        return _model
    try:
        from sentence_transformers import SentenceTransformer

        from .config import EMBEDDING_MODEL
        _model = SentenceTransformer(EMBEDDING_MODEL)
    except Exception:  # noqa: BLE001 -> degrade gracefully
        _model_failed = True
        _model = None
    return _model


def embeddings_available() -> bool:
    return _get_model() is not None


@lru_cache(maxsize=512)
def _embed(text: str):
    model = _get_model()
    if model is None:
        return None
    vec = model.encode(text or " ", normalize_embeddings=True)
    return tuple(float(x) for x in vec)


def _keyword_jaccard(a: str, b: str) -> float:
    sa, sb = set(extract_keywords(a, 60)), set(extract_keywords(b, 60))
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def semantic_similarity(text_a: str, text_b: str) -> float:
    """Cosine similarity in [0,1]; falls back to keyword Jaccard without embeddings."""
    va, vb = _embed(text_a[:5000]), _embed(text_b[:5000])
    if va is None or vb is None:
        return round(_keyword_jaccard(text_a, text_b), 4)
    import numpy as np
    sim = float(np.dot(np.array(va), np.array(vb)))
    return max(0.0, min(1.0, (sim + 1) / 2 if sim < 0 else sim))


def skill_score(resume_skills: List[str], jd: dict) -> Dict:
    required = set(jd.get("required_skills", []))
    preferred = set(jd.get("preferred_skills", []))
    have = set(resume_skills)
    if not required and not preferred:
        return {"score": 0.5, "matched": [], "missing": []}
    matched_req, matched_pref = required & have, preferred & have
    missing = sorted(required - have)
    req_ratio = len(matched_req) / len(required) if required else 1.0
    pref_ratio = len(matched_pref) / len(preferred) if preferred else 0.0
    score = 0.8 * req_ratio + 0.2 * pref_ratio if preferred else req_ratio
    return {"score": round(score, 4),
            "matched": sorted(matched_req | matched_pref), "missing": missing}


def experience_score(resume_years: float, jd_years: float) -> float:
    if jd_years <= 0:
        return 0.75
    ratio = resume_years / jd_years
    if ratio >= 1.0:
        return min(1.0, 0.9 + 0.1 * min(ratio - 1, 1))
    return round(max(0.0, ratio), 4)


def education_score(resume_edu: List[str], jd_edu: List[str]) -> float:
    jd_rank, res_rank = highest_education_rank(jd_edu), highest_education_rank(resume_edu)
    if jd_rank == 0:
        return 0.75
    if res_rank == 0:
        return 0.3
    return 1.0 if res_rank >= jd_rank else round(res_rank / jd_rank, 4)


def keyword_score(resume_kw: List[str], jd_kw: List[str]) -> float:
    jd_set = set(jd_kw)
    if not jd_set:
        return 0.5
    return round(len(set(resume_kw) & jd_set) / len(jd_set), 4)


def score_resume(resume_parsed: dict, resume_text: str, jd_parsed: dict, jd_text: str) -> dict:
    sk = skill_score(resume_parsed["skills"], jd_parsed)
    exp = experience_score(resume_parsed["experience_years"], jd_parsed["experience_years"])
    edu = education_score(resume_parsed["education"], jd_parsed["education"])
    kw = keyword_score(resume_parsed["keywords"], jd_parsed["keywords"])
    semantic = semantic_similarity(resume_text, jd_text)
    keyword_component = 0.5 * kw + 0.5 * semantic

    overall = (WEIGHTS["skill"] * sk["score"] + WEIGHTS["experience"] * exp
               + WEIGHTS["education"] * edu + WEIGHTS["keyword"] * keyword_component)
    overall_pct = round(overall * 100, 1)
    return {
        "overall_score": overall_pct,
        "skill_score": round(sk["score"] * 100, 1),
        "experience_score": round(exp * 100, 1),
        "education_score": round(edu * 100, 1),
        "keyword_score": round(keyword_component * 100, 1),
        "semantic_similarity": round(semantic * 100, 1),
        "matched_skills": sk["matched"],
        "missing_skills": sk["missing"],
        "resume_experience_years": resume_parsed["experience_years"],
        "jd_experience_years": jd_parsed["experience_years"],
        "embeddings_used": embeddings_available(),
    }
