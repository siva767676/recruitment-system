"""Parse structured fields (skills, experience, education, keywords) from text.

Ported from the md1 resume-screening engine. Used both for resume parsing and
for deriving a JD's skill requirements when an admin hasn't set them explicitly.
"""
from __future__ import annotations

import re
from typing import Dict, List

from .extractor import normalize_for_matching

SKILL_VOCAB: Dict[str, List[str]] = {
    "python": ["python"], "java": ["java"],
    "javascript": ["javascript", "js", "es6"], "typescript": ["typescript", "ts"],
    "c++": ["c++", "cpp"], "c#": ["c#", "c sharp"], "go": ["golang", "go lang"],
    "rust": ["rust"], "sql": ["sql"], "nosql": ["nosql"],
    "react": ["react", "reactjs", "react.js"], "angular": ["angular", "angularjs"],
    "vue": ["vue", "vuejs", "vue.js"], "node.js": ["node.js", "nodejs", "node"],
    "django": ["django"], "flask": ["flask"], "fastapi": ["fastapi"],
    "spring": ["spring", "spring boot", "springboot"], "html": ["html", "html5"],
    "css": ["css", "css3"], "tailwind": ["tailwind", "tailwindcss"],
    "docker": ["docker"], "kubernetes": ["kubernetes", "k8s"],
    "aws": ["aws", "amazon web services"], "azure": ["azure"],
    "gcp": ["gcp", "google cloud"], "terraform": ["terraform"], "ansible": ["ansible"],
    "jenkins": ["jenkins"], "ci/cd": ["ci/cd", "cicd", "ci cd"],
    "git": ["git", "github", "gitlab"], "linux": ["linux", "unix"],
    "postgresql": ["postgresql", "postgres"], "mysql": ["mysql"],
    "mongodb": ["mongodb", "mongo"], "redis": ["redis"], "kafka": ["kafka"],
    "spark": ["spark", "pyspark"], "hadoop": ["hadoop"], "airflow": ["airflow"],
    "tableau": ["tableau"], "power bi": ["power bi", "powerbi"],
    "excel": ["excel", "ms excel"], "pandas": ["pandas"], "numpy": ["numpy"],
    "scikit-learn": ["scikit-learn", "sklearn", "scikit learn"],
    "tensorflow": ["tensorflow"], "pytorch": ["pytorch"],
    "machine learning": ["machine learning", "ml"], "deep learning": ["deep learning"],
    "nlp": ["nlp", "natural language processing"],
    "data analysis": ["data analysis", "data analytics"],
    "statistics": ["statistics", "statistical"], "etl": ["etl"],
    "rest api": ["rest", "rest api", "restful"], "graphql": ["graphql"],
    "microservices": ["microservices", "microservice"], "agile": ["agile"],
    "scrum": ["scrum"], "jira": ["jira"],
    "project management": ["project management"],
    "stakeholder management": ["stakeholder management", "stakeholder"],
    "risk management": ["risk management"], "pmp": ["pmp"],
    "budgeting": ["budgeting", "budget"], "communication": ["communication"],
    "leadership": ["leadership"],
}

EDUCATION_PATTERNS = [
    (r"\bph\.?\s?d\b|\bdoctorate\b", "PhD"),
    (r"\bm\.?\s?tech\b|\bm\.?\s?sc\b|\bmaster'?s?\b|\bm\.?\s?b\.?a\b|\bm\.?\s?e\b", "Master's"),
    (r"\bb\.?\s?tech\b|\bb\.?\s?sc\b|\bbachelor'?s?\b|\bb\.?\s?e\b|\bb\.?\s?a\b", "Bachelor's"),
    (r"\bdiploma\b", "Diploma"),
]
EDU_RANK = {"Diploma": 1, "Bachelor's": 2, "Master's": 3, "PhD": 4}

CERT_PATTERN = re.compile(
    r"\b(certified|certificate|certification|aws certified|pmp|scrum master|csm|"
    r"oracle certified|microsoft certified|cissp|comptia)\b", re.IGNORECASE)


def extract_skills(text: str) -> List[str]:
    norm = normalize_for_matching(text)
    found = set()
    for canonical, aliases in SKILL_VOCAB.items():
        for alias in aliases:
            pattern = r"(?<![a-z0-9])" + re.escape(alias) + r"(?![a-z0-9])"
            if re.search(pattern, norm):
                found.add(canonical)
                break
    return sorted(found)


def extract_experience_years(text: str) -> float:
    norm = (text or "").lower()
    years = []
    for m in re.finditer(r"(\d{1,2})\s*\+?\s*(?:-\s*(\d{1,2}))?\s*(?:years?|yrs?)", norm):
        lo = int(m.group(1))
        hi = int(m.group(2)) if m.group(2) else lo
        years.append(max(lo, hi))
    return float(max(years)) if years else 0.0


def extract_education(text: str) -> List[str]:
    norm = (text or "").lower()
    out, seen = [], set()
    for pattern, label in EDUCATION_PATTERNS:
        if re.search(pattern, norm) and label not in seen:
            seen.add(label)
            out.append(label)
    return out


def highest_education_rank(levels: List[str]) -> int:
    return max((EDU_RANK.get(lv, 0) for lv in levels), default=0)


def extract_certifications(text: str) -> List[str]:
    return sorted({m.group(0).strip().title() for m in CERT_PATTERN.finditer(text or "")})


STOPWORDS = {
    "the", "and", "for", "with", "are", "was", "this", "that", "from", "have",
    "has", "will", "you", "your", "our", "their", "them", "they", "but", "not",
    "all", "can", "any", "may", "able", "use", "used", "using", "work", "working",
    "role", "team", "teams", "year", "years", "experience", "experiences", "skills",
    "skill", "knowledge", "ability", "responsibilities", "requirements", "required",
    "job", "description", "candidate", "candidates", "company", "include", "including",
    "etc", "across", "within", "strong", "good", "excellent", "plus", "must", "should",
    "who", "what", "when", "where", "well", "into", "out", "over", "more", "than",
    "such", "also", "per", "via", "new", "one", "two", "three", "high", "level",
}


def extract_keywords(text: str, top_n: int = 40) -> List[str]:
    norm = normalize_for_matching(text)
    tokens = re.findall(r"[a-z][a-z0-9+#.]{2,}", norm)
    freq: Dict[str, int] = {}
    for t in tokens:
        if t in STOPWORDS:
            continue
        freq[t] = freq.get(t, 0) + 1
    ranked = sorted(freq.items(), key=lambda kv: (-kv[1], kv[0]))
    return [w for w, _ in ranked[:top_n]]


def parse_resume(text: str) -> dict:
    return {
        "skills": extract_skills(text),
        "experience_years": extract_experience_years(text),
        "education": extract_education(text),
        "certifications": extract_certifications(text),
        "keywords": extract_keywords(text),
    }


def parse_jd(text: str, override_skills: List[str] | None = None,
             override_experience: float | None = None) -> dict:
    """Parse a JD. Admin-set skills/experience override the auto-extracted ones."""
    skills = extract_skills(text)
    lower = (text or "").lower()
    required, preferred = skills, []
    if "preferred" in lower or "nice to have" in lower:
        idx = lower.find("preferred")
        if idx == -1:
            idx = lower.find("nice to have")
        req_skills = extract_skills(text[:idx])
        pref_skills = [s for s in extract_skills(text[idx:]) if s not in req_skills]
        if req_skills:
            required, preferred = req_skills, pref_skills

    if override_skills:
        required = [s.lower() for s in override_skills]
        preferred = [s for s in preferred if s not in required]

    return {
        "required_skills": required,
        "preferred_skills": preferred,
        "all_skills": skills,
        "experience_years": override_experience if override_experience is not None
        else extract_experience_years(text),
        "education": extract_education(text),
        "keywords": extract_keywords(text),
    }
