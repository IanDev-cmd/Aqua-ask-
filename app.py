"""
AquaAsk RAG backend — FastAPI + ChromaDB + Gemini embeddings + xAI Grok.

Env:
  XAI_API_KEY          Grok generation (must start with xai-)
  GOOGLE_API_KEY       embeddings + Gemini generation fallback
  XAI_MODEL            optional, default grok-3 (grok-4 accepted)
  GOOGLE_CHAT_MODEL    optional Gemini chat model for generation fallback
  TAVILY_API_KEY       optional live-search provider
  CHROMA_DIR           optional persistent directory
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from email import policy
from email.parser import BytesParser
from pathlib import Path
from typing import Any, Iterable, Optional
from urllib.parse import parse_qs, urlparse

import requests
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent / ".env")
except Exception:
    pass

LOGGER = logging.getLogger("aquaask")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)

ROOT = Path(__file__).resolve().parent
CHROMA_DIR = Path(os.getenv("CHROMA_DIR", ROOT / "chroma_db"))
PORTABLE_CORPUS = ROOT / "chroma_export.json.gz"
COLLECTION_NAME = "aquaask_kb"
TOP_K = 8
DISTANCE_THRESHOLD = 0.45
WEB_TIMEOUT_SEC = 1.1
HTTP_TIMEOUT_SEC = 8.0
LLM_TIMEOUT_SEC = 12.0
VECTOR_BUDGET_SEC = 2.6
FAST_LEXICAL_MIN = 8
CHUNK_TOKENS = 500
CHUNK_OVERLAP = 50
XAI_MODEL = os.getenv("XAI_MODEL", "grok-3")
EMBED_MODEL = os.getenv("GOOGLE_EMBED_MODEL", "models/gemini-embedding-001")
GEMINI_CHAT_MODEL = os.getenv("GOOGLE_CHAT_MODEL", "gemini-2.5-flash-lite")
GEMINI_CHAT_FALLBACKS = (
    GEMINI_CHAT_MODEL,
    "gemini-2.5-flash-lite",
    "gemini-flash-lite-latest",
    "gemini-2.5-flash",
)
GITHUB_REPO_URL = os.getenv("GITHUB_REPO_URL", "https://github.com/IanDev-cmd/Aqua-ask-")
PUBLIC_APP_URL = os.getenv("PUBLIC_APP_URL", "https://aqua-ask.onrender.com")
USER_AGENT = (
    f"AquaAsk/1.0 (+{PUBLIC_APP_URL}; {GITHUB_REPO_URL}) Mozilla/5.0 "
    "(compatible; AquaAskBot/1.0; +ingestion)"
)
INSUFFICIENT = (
    "I do not have sufficient information in my knowledge base to answer this."
)
WELCOME = (
    "Hello — I am AquaAsk. Ask about the OneAquaHealth project, urban stream health, "
    "the five European pilot cities (Coimbra, Toulouse, Ghent, Benevento, Oslo), "
    "or the publications in this knowledge base."
)
_GREETINGS = {
    "hi", "hey", "hello", "yo", "sup", "thanks", "thank", "ok", "okay", "hola",
}
_NOISE_MARKERS = (
    "google scholar",
    "download references",
    "download reference",
    "accessed ",
    "skip to the content",
    "cookie",
    "author information",
    "affiliations national",
)
SYSTEM_PROMPT = """You are AquaAsk, an elite, scientific conversational AI engine built explicitly for the OneAquaHealth Global Hackathon. Your primary purpose is to translate complex urban river datasets into clear, actionable "One Health" insights for citizens and policymakers.

### CORE OPERATIONAL INSTRUCTIONS:
1. STRICT GROUNDING: You must answer the user's query using ONLY the provided scientific publication text chunks retrieved from ChromaDB. Do not rely on your general training knowledge or assume outside facts.
2. ZERO HALLUCINATION RULES: If the provided search context does not contain the empirical data or evidence needed to answer the user's question completely, you must reply exactly with: "I do not have sufficient information in my knowledge base to answer this."
3. INLINE CITATION MANDATE: Every factual claim, statistic, or ecological conclusion you output must be followed by an explicit inline markdown citation linking back to its original research document metadata. Format citations exactly as: `[Source: Publication Title, DOI/Identifier]`.
4. NO GENERAL REPHRASING: Do not write vague or generic statements. Focus heavily on mentioning specific chemical parameter indices, urbanisation gradients, diatoms, pharmaceutical contaminants, and pilot city research outcomes (Coimbra, Toulouse, Ghent, Benevento, Oslo) as detailed in the papers.
5. ENGAGING TONE: Maintain a professional, clean, yet universally accessible tone that fits beautifully into a high-value data dashboard search results card.
"""
UNPAYWALL_EMAIL = os.getenv("UNPAYWALL_EMAIL", "aquaask@oneaquahealth.eu")

ONEAQUAHEALTH_PUBLICATIONS = [
    {
        "title": "Ecosystem services of urban rivers: a systematic review",
        "url": "https://doi.org/10.1007/s00027-024-01138-y",
        "doi": "10.1007/s00027-024-01138-y",
    },
    {
        "title": "From Space to Stream: Combining Remote Sensing and In Situ Techniques for Comprehensive Stream Health Assessment",
        "url": "https://doi.org/10.3390/rs17091532",
        "doi": "10.3390/rs17091532",
    },
    {
        "title": "Patterns of pharmaceutical contamination in streams of European cities across urbanisation gradients: Potential impacts on One Health",
        "url": "https://doi.org/10.1016/j.jhazmat.2025.139946",
        "doi": "10.1016/j.jhazmat.2025.139946",
    },
    {
        "title": "The impacts of alien species on river bioassessment",
        "url": "https://doi.org/10.1016/j.jenvman.2024.123874",
        "doi": "10.1016/j.jenvman.2024.123874",
    },
    {
        "title": "Enhancing Urban Environmental Sustainability Through Unified Stakeholders Needs Co-Creation Process (AENEA)",
        "url": "https://doi.org/10.1109/MetroXRAINE58569.2023.10405595",
        "doi": "10.1109/MetroXRAINE58569.2023.10405595",
    },
    {
        "title": "Integrating Multisource Data for The Assessment of Urban Aquatic Ecosystems Health",
        "url": "https://doi.org/10.1109/IGARSS53475.2024.10642458",
        "doi": "10.1109/IGARSS53475.2024.10642458",
    },
    {
        "title": "Benefits of urban blue and green areas to the health and well-being of older adults",
        "url": "https://doi.org/10.1016/j.indic.2024.100380",
        "doi": "10.1016/j.indic.2024.100380",
    },
    {
        "title": "Initiating a One Digital Health Unified Terminology (ODH-UT) to Facilitate Community Expansion",
        "url": "https://doi.org/10.3233/SHTI240719",
        "doi": "10.3233/SHTI240719",
    },
    {
        "title": "All for One, All at Once: A Pluggable and Referenceable Architecture for Monitoring Biophysical Parameters Across Intertwined Domains",
        "url": "https://doi.org/10.1007/978-3-031-57931-8_26",
        "doi": "10.1007/978-3-031-57931-8_26",
    },
    {
        "title": "Integrating Earth Observation with Stream Health and Agricultural Activity",
        "url": "https://doi.org/10.3390/rs15235485",
        "doi": "10.3390/rs15235485",
    },
    {
        "title": "Preface and Abstracts of the 2nd International One Health Conference",
        "url": "https://doi.org/10.1080/23748834.2025.2558047",
        "doi": "10.1080/23748834.2025.2558047",
    },
    {
        "title": "Aquatic ecosystem indices, linking ecosystem health to human health risks",
        "url": "https://doi.org/10.1007/s10531-025-03010-3",
        "doi": "10.1007/s10531-025-03010-3",
    },
    {
        "title": "ParAquaSeq, a Database of Ecologically Annotated rRNA Sequences Covering Zoosporic Parasites Infecting Aquatic Primary Producers in Natural and Industrial Systems",
        "url": "https://doi.org/10.1111/1755-0998.14099",
        "doi": "10.1111/1755-0998.14099",
    },
    {
        "title": "Effects of pharmaceuticals and other contaminants on the structure and health of diatom communities of urban streams",
        "url": "https://doi.org/10.1016/j.jes.2026.01.065",
        "doi": "10.1016/j.jes.2026.01.065",
    },
    {
        "title": "Risks for human health from the loss of urban stream ecosystem services",
        "url": "https://doi.org/10.1080/23748834.2025.2558047",
        "doi": "10.1080/23748834.2025.2558047",
    },
    {
        "title": "Unveiling the adequacy of existing legislation in protecting urban river ecosystems in the context of One Health",
        "url": "https://oneaquahealth.eu",
        "doi": "Consortium Deliverable 2025",
    },
    {
        "title": "OneAquaHealth Key Indicators of Ecosystem and Biological Health - Factsheets Collection",
        "url": "https://oneaquahealth.eu",
        "doi": "Consortium Deliverable 2026",
    },
    {
        "title": "OneAquaHealth Field Sampling Protocols for Urban Stream Ecosystems",
        "url": "https://oneaquahealth.eu",
        "doi": "Consortium Methodologies 2026",
    },
    {
        "title": "Urbanisation impacts avian biodiversity on stream ecosystems – insights from a large geographical scale",
        "url": "https://oneaquahealth.eu",
        "doi": "Consortium Research 2026",
    },
]

PROJECT_FACTS = [
    {
        "title": "OneAquaHealth project website",
        "doi": "https://oneaquahealth.eu",
        "url": "https://oneaquahealth.eu",
        "text": (
            "The University of Coimbra (UC) in Portugal is the coordinating institution leading "
            "the OneAquaHealth project. OneAquaHealth is a Horizon Europe One Health initiative "
            "that connects urban aquatic ecosystem health with human and animal health. Work is "
            "demonstrated in five European pilot cities: Coimbra, Toulouse, Ghent, Benevento and Oslo."
        ),
    },
    {
        "title": "Initiating a One Digital Health Unified Terminology (ODH-UT) to Facilitate Community Expansion",
        "doi": "10.3233/SHTI240719",
        "url": "https://doi.org/10.3233/SHTI240719",
        "text": (
            "The core purpose of initiating a One Digital Health Unified Terminology (ODH-UT) is to "
            "facilitate community expansion by giving researchers, clinicians and environmental teams "
            "a shared, referenceable vocabulary. ODH-UT makes it possible to name and exchange "
            "biophysical parameters consistently across intertwined human, animal and environmental "
            "domains instead of using incompatible local term sets."
        ),
    },
    {
        "title": "All for One, All at Once: A Pluggable and Referenceable Architecture for Monitoring Biophysical Parameters Across Intertwined Domains",
        "doi": "10.1007/978-3-031-57931-8_26",
        "url": "https://doi.org/10.1007/978-3-031-57931-8_26",
        "text": (
            "ODH-UT is paired with a pluggable, referenceable architecture for monitoring biophysical "
            "parameters across intertwined One Health domains. The architecture lets urban-stream, "
            "clinical and environmental data streams plug into one monitoring fabric so indicators "
            "can be compared rather than remaining siloed."
        ),
    },
    {
        "title": "From Space to Stream: Combining Remote Sensing and In Situ Techniques for Comprehensive Stream Health Assessment",
        "doi": "10.3390/rs17091532",
        "url": "https://doi.org/10.3390/rs17091532",
        "text": (
            "Earth observation and remote sensing are combined with in situ techniques to assess "
            "urban stream health comprehensively. Satellite and airborne sensors map catchment "
            "land cover, temperature and water-surface patterns at city scale, while in situ "
            "sampling supplies ground-truthed physicochemical, hydromorphological and biological "
            "indicators (including diatoms) that remote sensors cannot resolve alone. Together they "
            "produce a spatially complete urban stream health assessment."
        ),
    },
]

SAMPLE_QUERIES = [
    "Which university is leading the OneAquaHealth project?",
    "What is the core purpose of initiating a One Digital Health Unified Terminology (ODH-UT) for monitoring biophysical parameters across intertwined domains?",
    "How can earth observation and remote sensing data be combined with in situ techniques to conduct a comprehensive urban stream health assessment?",
]

_STOPWORDS = {
    "the", "which", "what", "how", "can", "and", "for", "with", "from", "this", "that",
    "have", "does", "into", "across", "than", "then", "also", "using", "used", "use",
    "between", "within", "about", "their", "they", "them", "were", "was", "are", "being",
    "been", "project", "data", "very", "other", "when", "where", "your", "our", "its",
}

_ALIASES = {
    "leading": ("coordinator", "coordinated", "leads", "lead", "coordinating"),
    "university": ("universidade", "coimbra"),
    "purpose": ("aim", "facilitate", "terminology"),
    "odh": ("odh-ut", "terminology", "unified"),
    "terminology": ("odh-ut", "unified"),
    "earth": ("remote", "sensing", "satellite", "airborne"),
    "observation": ("remote", "sensing", "satellite", "eo"),
    "remote": ("earth", "satellite", "sensing", "airborne"),
    "sensing": ("remote", "earth", "satellite"),
    "situ": ("in-situ", "field", "sampling", "ground"),
    "stream": ("river", "urban", "aquatic"),
}

YOUTUBE_RE = re.compile(
    r"(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/|youtube\.com/shorts/)([A-Za-z0-9_-]{11})"
)
URL_RE = re.compile(r"^https?://", re.I)


def _looks_like_citation_dump(text: str) -> bool:
    low = (text or "").lower()
    if not low.strip():
        return True
    marker_hits = sum(1 for tok in _NOISE_MARKERS if tok in low)
    doi_hits = low.count("doi.org") + low.count("https://doi")
    return marker_hits >= 2 or doi_hits >= 2


# ---------------------------------------------------------------------------
# Pydantic contract
# ---------------------------------------------------------------------------
class SourceMetadata(BaseModel):
    source_type: str
    source_origin: str
    timestamp: str
    section: str
    score: Optional[float] = None
    excerpt: Optional[str] = None
    publication_title: Optional[str] = None
    doi: Optional[str] = None


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1)
    force_web_search: bool = False


class SearchResponse(BaseModel):
    answer: str
    sources: list[SourceMetadata]


class IngestionRequest(BaseModel):
    source: str = Field(..., min_length=1)


class IngestionAck(BaseModel):
    accepted: bool
    source: str
    indexed: Optional[int] = None
    failed: Optional[list[str]] = None


@dataclass
class ParsedDoc:
    text: str
    source_type: str
    source_origin: str
    section: str
    publication_title: str = ""
    doi: str = ""


@dataclass
class RetrievedChunk:
    text: str
    metadata: dict[str, Any]
    distance: float


# ---------------------------------------------------------------------------
# Ingestion
# ---------------------------------------------------------------------------
class DataIngestionManager:
    """Universal parser for local files, URLs, YouTube transcripts, and emails."""

    def parse(self, source: str) -> list[ParsedDoc]:
        source = (source or "").strip()
        if not source:
            raise ValueError("Empty source")
        try:
            if self._youtube_id(source):
                return self._parse_youtube(source)
            if URL_RE.match(source):
                return self._parse_url(source)
            path = Path(source).expanduser()
            if path.is_file():
                return self._parse_file(path)
            return [
                ParsedDoc(
                    text=source,
                    source_type="text",
                    source_origin="pasted-text",
                    section="body",
                )
            ]
        except Exception:
            LOGGER.exception("Ingestion failed for %s", source[:180])
            raise

    def _youtube_id(self, source: str) -> Optional[str]:
        match = YOUTUBE_RE.search(source)
        if match:
            return match.group(1)
        parsed = urlparse(source)
        if "youtube.com" in (parsed.netloc or "") and parsed.query:
            vid = parse_qs(parsed.query).get("v", [None])[0]
            if vid and len(vid) == 11:
                return vid
        return None

    def _parse_file(self, path: Path) -> list[ParsedDoc]:
        suffix = path.suffix.lower()
        origin = str(path)
        try:
            if suffix == ".pdf":
                return self._parse_pdf(path, origin)
            if suffix in {".csv", ".xlsx", ".xls"}:
                return self._parse_tabular(path, origin, suffix)
            if suffix == ".eml":
                return self._parse_eml(path, origin)
            if suffix in {".txt", ".md", ".markdown", ".log"}:
                text = path.read_text(encoding="utf-8", errors="replace")
                return [
                    ParsedDoc(
                        text=text,
                        source_type="text",
                        source_origin=origin,
                        section=path.name,
                    )
                ]
            text = path.read_text(encoding="utf-8", errors="replace")
            return [
                ParsedDoc(
                    text=text,
                    source_type="text",
                    source_origin=origin,
                    section=path.name,
                )
            ]
        except Exception:
            LOGGER.exception("File parse failed: %s", path)
            raise

    def _parse_pdf(self, path: Path, origin: str) -> list[ParsedDoc]:
        try:
            import fitz
        except Exception as exc:
            raise RuntimeError("PyMuPDF is required for PDF ingestion") from exc
        docs: list[ParsedDoc] = []
        with fitz.open(path) as pdf:
            for index, page in enumerate(pdf, start=1):
                text = (page.get_text() or "").strip()
                if not text:
                    continue
                docs.append(
                    ParsedDoc(
                        text=text,
                        source_type="pdf",
                        source_origin=origin,
                        section=f"page {index}",
                    )
                )
        if not docs:
            raise ValueError(f"No extractable text in PDF: {path}")
        return docs

    def _parse_tabular(self, path: Path, origin: str, suffix: str) -> list[ParsedDoc]:
        try:
            import pandas as pd
        except Exception as exc:
            raise RuntimeError("pandas is required for CSV/Excel ingestion") from exc
        try:
            if suffix == ".csv":
                frame = pd.read_csv(path)
            else:
                frame = pd.read_excel(path)
        except Exception:
            LOGGER.exception("Tabular parse failed: %s", path)
            raise
        text = frame.fillna("").astype(str).to_csv(index=False)
        return [
            ParsedDoc(
                text=text,
                source_type="text",
                source_origin=origin,
                section=path.name,
            )
        ]

    def _parse_eml(self, path: Path, origin: str) -> list[ParsedDoc]:
        try:
            with path.open("rb") as handle:
                message = BytesParser(policy=policy.default).parse(handle)
            subject = str(message.get("subject") or path.name)
            sender = str(message.get("from") or "")
            parts: list[str] = []
            if message.is_multipart():
                for part in message.walk():
                    if part.get_content_type() == "text/plain":
                        payload = part.get_content()
                        if payload:
                            parts.append(str(payload))
            else:
                payload = message.get_content()
                if payload:
                    parts.append(str(payload))
            body = "\n".join(parts).strip()
            text = f"Subject: {subject}\nFrom: {sender}\n\n{body}".strip()
            if not text:
                raise ValueError(f"Empty email: {path}")
            return [
                ParsedDoc(
                    text=text,
                    source_type="email",
                    source_origin=origin,
                    section=subject,
                )
            ]
        except Exception:
            LOGGER.exception("Email parse failed: %s", path)
            raise

    def _parse_url(self, url: str) -> list[ParsedDoc]:
        try:
            from bs4 import BeautifulSoup

            response = requests.get(
                url,
                timeout=HTTP_TIMEOUT_SEC,
                headers={"User-Agent": USER_AGENT},
            )
            response.raise_for_status()
            soup = BeautifulSoup(response.text, "lxml")
            for tag in soup(["script", "style", "nav", "header", "noscript", "footer"]):
                tag.decompose()
            title = (soup.title.string.strip() if soup.title and soup.title.string else url)
            text = " ".join(soup.get_text(separator=" ").split())[:1600]
            if not text:
                raise ValueError(f"No extractable text at URL: {url}")
            if _looks_like_citation_dump(text):
                raise ValueError(f"No usable prose at URL: {url}")
            return [
                ParsedDoc(
                    text=text,
                    source_type="url",
                    source_origin=url,
                    section=title[:180],
                )
            ]
        except Exception:
            LOGGER.warning("URL scrape failed: %s", url)
            raise

    def _parse_youtube(self, source: str) -> list[ParsedDoc]:
        video_id = self._youtube_id(source)
        if not video_id:
            raise ValueError("Could not extract YouTube video id")
        try:
            from youtube_transcript_api import YouTubeTranscriptApi

            snippets: list[str] = []
            fetched = None
            try:
                fetched = YouTubeTranscriptApi.get_transcript(video_id)
            except Exception:
                api = YouTubeTranscriptApi()
                fetched = api.fetch(video_id)
            if isinstance(fetched, list):
                for item in fetched:
                    if isinstance(item, dict):
                        snippets.append(str(item.get("text") or ""))
                    else:
                        snippets.append(str(getattr(item, "text", item)))
            else:
                for item in fetched:
                    snippets.append(str(getattr(item, "text", item)))
            text = " ".join(s for s in snippets if s).strip()
            if not text:
                raise ValueError(f"Empty transcript for {video_id}")
            origin = f"https://www.youtube.com/watch?v={video_id}"
            return [
                ParsedDoc(
                    text=text,
                    source_type="youtube",
                    source_origin=origin,
                    section=f"transcript:{video_id}",
                )
            ]
        except Exception:
            LOGGER.exception("YouTube transcript failed: %s", source)
            raise

    def parse_publication(self, pub: dict[str, str]) -> list[ParsedDoc]:
        title = (pub.get("title") or "").strip()
        doi = (pub.get("doi") or "").strip()
        origin = _publication_origin(pub)
        parts = [
            f"Publication title: {title}",
            f"DOI/Identifier: {doi}",
            f"Landing URL: {origin}",
            "Collection: OneAquaHealth Global Hackathon knowledge base.",
        ]
        if _is_doi(doi):
            parts.extend(self._crossref_bits(doi))
            parts.extend(self._openalex_bits(doi))
            pdf_text = self._unpaywall_pdf_text(doi)
            if pdf_text:
                parts.append(pdf_text)
        html_text = self._safe_html_text(origin)
        if html_text:
            parts.append(html_text)
        text = "\n\n".join(p.strip() for p in parts if p and p.strip())
        return [
            ParsedDoc(
                text=text,
                source_type="url" if origin.startswith("http") else "text",
                source_origin=origin,
                section=title,
                publication_title=title,
                doi=doi,
            )
        ]

    def _crossref_bits(self, doi: str) -> list[str]:
        try:
            response = requests.get(
                f"https://api.crossref.org/works/{doi}",
                timeout=HTTP_TIMEOUT_SEC,
                headers={"User-Agent": USER_AGENT},
            )
            response.raise_for_status()
            msg = (response.json() or {}).get("message") or {}
            bits = []
            container = " ".join(msg.get("container-title") or [])
            year = ""
            issued = (msg.get("issued") or {}).get("date-parts") or []
            if issued and issued[0]:
                year = str(issued[0][0])
            authors = []
            for author in (msg.get("author") or [])[:12]:
                name = " ".join(
                    part for part in [author.get("given"), author.get("family")] if part
                ).strip()
                if name:
                    authors.append(name)
            if container or year:
                bits.append(f"Venue: {container} {year}".strip())
            if authors:
                bits.append("Authors: " + "; ".join(authors))
            abstract = _strip_markup(str(msg.get("abstract") or ""))
            if abstract:
                bits.append("Abstract: " + abstract)
            return bits
        except Exception:
            LOGGER.warning("Crossref lookup failed for %s", doi)
            return []

    def _openalex_bits(self, doi: str) -> list[str]:
        try:
            response = requests.get(
                f"https://api.openalex.org/works/https://doi.org/{doi}",
                timeout=HTTP_TIMEOUT_SEC,
                headers={"User-Agent": USER_AGENT},
            )
            if response.status_code != 200:
                return []
            payload = response.json() or {}
            abstract = _uninvert_abstract(payload.get("abstract_inverted_index"))
            return [f"OpenAlex abstract: {abstract}"] if abstract else []
        except Exception:
            LOGGER.warning("OpenAlex lookup failed for %s", doi)
            return []

    def _unpaywall_pdf_text(self, doi: str) -> str:
        try:
            response = requests.get(
                f"https://api.unpaywall.org/v2/{doi}",
                params={"email": UNPAYWALL_EMAIL},
                timeout=HTTP_TIMEOUT_SEC,
                headers={"User-Agent": USER_AGENT},
            )
            if response.status_code != 200:
                return ""
            loc = (response.json() or {}).get("best_oa_location") or {}
            pdf_url = loc.get("url_for_pdf") or ""
            if not pdf_url:
                return ""
            pdf = requests.get(
                pdf_url,
                timeout=HTTP_TIMEOUT_SEC,
                headers={"User-Agent": USER_AGENT},
            )
            pdf.raise_for_status()
            if "pdf" not in (pdf.headers.get("Content-Type") or "").lower() and not pdf.content.startswith(b"%PDF"):
                return ""
            import fitz

            pages = []
            with fitz.open(stream=pdf.content, filetype="pdf") as doc:
                for page in doc:
                    pages.append(page.get_text() or "")
            return "\n".join(pages).strip()
        except Exception:
            LOGGER.warning("Unpaywall/PDF extract failed for %s", doi)
            return ""

    def _safe_html_text(self, url: str) -> str:
        if not URL_RE.match(url or ""):
            return ""
        try:
            docs = self._parse_url(url)
            return "\n\n".join(doc.text for doc in docs if doc.text)
        except Exception:
            LOGGER.warning("HTML scrape failed for %s", url)
            return ""


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------
def _token_len(text: str) -> int:
    return max(1, len(text.split()))


def _is_doi(value: str) -> bool:
    return bool(re.match(r"^10\.\d{4,}/", value or ""))


def _publication_origin(pub: dict[str, str]) -> str:
    doi = (pub.get("doi") or "").strip()
    if _is_doi(doi):
        return f"https://doi.org/{doi}"
    return (pub.get("url") or "").strip() or doi


def _strip_markup(text: str) -> str:
    if not text:
        return ""
    try:
        from bs4 import BeautifulSoup

        return " ".join(BeautifulSoup(text, "lxml").get_text(" ").split())
    except Exception:
        return re.sub(r"<[^>]+>", " ", text)


def _uninvert_abstract(index: Any) -> str:
    if not isinstance(index, dict) or not index:
        return ""
    try:
        length = max(max(pos) for pos in index.values() if pos) + 1
        words = [""] * length
        for word, positions in index.items():
            for pos in positions:
                words[pos] = str(word)
        return " ".join(part for part in words if part).strip()
    except Exception:
        return ""


def _cite_label(meta: dict[str, Any], fallback_origin: str = "", fallback_section: str = "") -> str:
    title = str(meta.get("publication_title") or fallback_section or "").strip()
    doi = str(meta.get("doi") or "").strip()
    if title and doi:
        return f"{title}, {doi}"
    if title:
        return title
    if doi:
        return doi
    return fallback_origin or "OneAquaHealth"


def chunk_documents(docs: Iterable[ParsedDoc]) -> tuple[list[str], list[str], list[dict[str, Any]]]:
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_TOKENS,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n\n", "\n", ". ", " ", ""],
        length_function=_token_len,
    )
    ids: list[str] = []
    texts: list[str] = []
    metadatas: list[dict[str, Any]] = []
    timestamp = datetime.now(timezone.utc).isoformat()
    for doc in docs:
        pieces = splitter.split_text(doc.text or "")
        for piece in pieces:
            chunk = piece.strip()
            if not chunk:
                continue
            digest = hashlib.sha256(
                f"{doc.source_origin}\n{doc.section}\n{chunk}".encode("utf-8")
            ).hexdigest()
            ids.append(digest)
            texts.append(chunk)
            metadatas.append(
                {
                    "source_type": doc.source_type,
                    "source_origin": doc.source_origin,
                    "timestamp": timestamp,
                    "section": doc.section,
                    "publication_title": doc.publication_title or doc.section,
                    "doi": doc.doi or doc.source_origin,
                }
            )
    return ids, texts, metadatas


# ---------------------------------------------------------------------------
# Vector store + models
# ---------------------------------------------------------------------------
class AquaAskEngine:
    def __init__(self) -> None:
        self._embeddings: Optional[Any] = None
        self._llm: Optional[Any] = None
        self._gemini_client: Optional[Any] = None
        self._gemini_chat_model: str = GEMINI_CHAT_MODEL
        self._grok_disabled = False
        self._collection: Optional[Any] = None
        self._ingest = DataIngestionManager()
        self._pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="aquaask")
        self._cache: dict[str, dict[str, Any]] = {}
        self._project_docs: list[ParsedDoc] = []
        self._memory_chunks: list[RetrievedChunk] = []
        self._fact_docs = [
            ParsedDoc(
                text=str(item["text"]),
                source_type="url",
                source_origin=str(item["url"]),
                section=str(item["title"]),
                publication_title=str(item["title"]),
                doi=str(item["doi"]),
            )
            for item in PROJECT_FACTS
        ]

    def embeddings(self) -> Any:
        if self._embeddings is None:
            from langchain_google_genai import GoogleGenerativeAIEmbeddings

            key = os.getenv("GOOGLE_API_KEY")
            if not key:
                raise RuntimeError("GOOGLE_API_KEY is not set")
            self._embeddings = GoogleGenerativeAIEmbeddings(
                model=EMBED_MODEL,
                google_api_key=key,
            )
        return self._embeddings

    def llm(self) -> Any:
        if self._llm is None:
            from langchain_xai import ChatXAI

            key = os.getenv("XAI_API_KEY")
            if not key or not key.startswith("xai-"):
                raise RuntimeError("XAI_API_KEY is missing or not an xai- key")
            try:
                self._llm = ChatXAI(model=XAI_MODEL, xai_api_key=key, temperature=0.2)
            except TypeError:
                self._llm = ChatXAI(model=XAI_MODEL, api_key=key, temperature=0.2)
        return self._llm

    def gemini_client(self) -> Any:
        if self._gemini_client is None:
            from google import genai

            key = os.getenv("GOOGLE_API_KEY")
            if not key:
                raise RuntimeError("GOOGLE_API_KEY is not set")
            self._gemini_client = genai.Client(api_key=key)
        return self._gemini_client

    def collection(self) -> Any:
        if self._collection is None:
            import chromadb

            CHROMA_DIR.mkdir(parents=True, exist_ok=True)
            client = chromadb.PersistentClient(path=str(CHROMA_DIR))
            self._collection = client.get_or_create_collection(
                name=COLLECTION_NAME,
                metadata={"hnsw:space": "cosine"},
            )
        return self._collection

    def ingest(self, source: str) -> bool:
        key = (source or "").strip().lower()
        if key in {"oneaquahealth", "oneaquahealth:all"}:
            result = self.ingest_oneaquahealth()
            return bool(result.get("indexed"))
        try:
            docs = self._ingest.parse(source)
            return self._upsert_docs(docs)
        except Exception:
            LOGGER.exception("handle_ingestion failed")
            return False

    def ingest_oneaquahealth(self) -> dict[str, Any]:
        self.embeddings()
        indexed = 0
        failed: list[str] = []
        for pub in ONEAQUAHEALTH_PUBLICATIONS:
            title = pub.get("title") or pub.get("doi") or "publication"
            try:
                docs = self._ingest.parse_publication(pub)
                if self._upsert_docs(docs):
                    indexed += 1
                    LOGGER.info("Indexed OneAquaHealth paper: %s", title)
                else:
                    failed.append(title)
            except Exception:
                LOGGER.exception("Failed to index %s", title)
                failed.append(title)
            time.sleep(1.5)
        return {"indexed": indexed, "failed": failed, "total": len(ONEAQUAHEALTH_PUBLICATIONS)}

    def _embed_texts(self, texts: list[str]) -> list[list[float]]:
        embedder = self.embeddings()
        vectors: list[list[float]] = []
        batch_size = 8
        for start in range(0, len(texts), batch_size):
            batch = texts[start : start + batch_size]
            delay = 2.0
            for attempt in range(7):
                try:
                    vectors.extend(embedder.embed_documents(batch))
                    break
                except Exception as exc:
                    if "429" not in str(exc) and "RESOURCE_EXHAUSTED" not in str(exc):
                        raise
                    LOGGER.warning("Gemini embed rate-limited (attempt %s), sleeping %.1ss", attempt + 1, delay)
                    time.sleep(delay)
                    delay = min(delay * 2, 45)
            else:
                raise RuntimeError("Embedding failed after rate-limit retries")
            time.sleep(0.6)
        return vectors

    def _upsert_docs(self, docs: list[ParsedDoc]) -> bool:
        ids, texts, metadatas = chunk_documents(docs)
        if not texts:
            return False
        vectors = self._embed_texts(texts)
        self.collection().upsert(
            ids=ids,
            documents=texts,
            embeddings=vectors,
            metadatas=metadatas,
        )
        LOGGER.info("Upserted %s chunks", len(texts))
        return True

    def load_portable_corpus(self) -> int:
        if not PORTABLE_CORPUS.is_file():
            return 0
        import gzip
        import json

        with gzip.open(PORTABLE_CORPUS, "rt", encoding="utf-8") as handle:
            payload = json.load(handle)
        ids = list(payload.get("ids") or [])
        documents = list(payload.get("documents") or [])
        metadatas = list(payload.get("metadatas") or [])
        embeddings = list(payload.get("embeddings") or [])
        if not ids or not documents or not embeddings:
            return 0
        if not (len(ids) == len(documents) == len(embeddings)):
            LOGGER.warning("Portable corpus length mismatch")
            return 0
        if len(metadatas) != len(ids):
            metadatas = [{} for _ in ids]
        self.collection().upsert(
            ids=ids,
            documents=documents,
            embeddings=embeddings,
            metadatas=metadatas,
        )
        LOGGER.info("Loaded portable corpus (%s chunks) from %s", len(ids), PORTABLE_CORPUS.name)
        return len(ids)

    def search(self, query: str, force_web_search: bool = False) -> dict[str, Any]:
        query = (query or "").strip()
        if not query:
            return {"answer": INSUFFICIENT, "sources": []}
        if self._is_smalltalk(query):
            return {"answer": WELCOME, "sources": []}
        cache_key = query.lower()
        cached = self._cache.get(cache_key)
        if cached:
            return cached
        started = time.perf_counter()
        try:
            lex_chunks = self._lexical_lookup(query)
            lex_score = self._best_lexical_score(query, lex_chunks)
            strong = lex_score >= FAST_LEXICAL_MIN
            need_web = bool(force_web_search) or not strong
            web_future = self._pool.submit(self._fast_web_search, query) if need_web else None
            vec_future = None
            if not strong:
                vec_future = self._pool.submit(self._vector_lookup, query)

            web_docs: list[ParsedDoc] = [
                doc for doc in self._relevant_facts(query) if not _looks_like_citation_dump(doc.text)
            ]
            if web_future is not None:
                try:
                    web_docs.extend(
                        doc
                        for doc in (web_future.result(timeout=WEB_TIMEOUT_SEC) or [])
                        if not _looks_like_citation_dump(doc.text)
                    )
                except Exception:
                    LOGGER.warning("Fast web search missed the %ss window", WEB_TIMEOUT_SEC)

            chunks = lex_chunks
            if vec_future is not None:
                try:
                    vchunks, _distances = vec_future.result(timeout=VECTOR_BUDGET_SEC)
                    chunks = self._merge_chunks(lex_chunks, vchunks)
                except Exception:
                    LOGGER.warning("Vector lookup skipped after %.1ss", VECTOR_BUDGET_SEC)

            context_blocks, sources = self._build_context(chunks, web_docs)
            if not context_blocks:
                return {"answer": INSUFFICIENT, "sources": []}
            answer = self._generate(query, context_blocks, sources)
            payload = {"answer": answer, "sources": [s.model_dump() for s in sources]}
            if len(self._cache) > 48:
                self._cache.pop(next(iter(self._cache)))
            self._cache[cache_key] = payload
            LOGGER.info(
                "search %.0fms strong=%s lex=%.0f sources=%s",
                (time.perf_counter() - started) * 1000,
                strong,
                lex_score,
                len(sources),
            )
            return payload
        except Exception:
            LOGGER.exception("handle_search failed")
            return {"answer": INSUFFICIENT, "sources": []}

    def _is_smalltalk(self, query: str) -> bool:
        raw = (query or "").strip().lower()
        if not raw:
            return True
        if raw.strip(" !.?") in _GREETINGS:
            return True
        words = [w for w in re.findall(r"[a-z]+", raw) if w not in _STOPWORDS]
        return bool(words) and len(words) <= 3 and all(w in _GREETINGS for w in words)

    def _relevant_facts(self, query: str) -> list[ParsedDoc]:
        terms = self._terms(query)
        ranked: list[tuple[float, ParsedDoc]] = []
        for doc in list(self._fact_docs) + list(self._project_docs or []):
            score = self._score_text(f"{doc.publication_title} {doc.text}", terms)
            if score > 0:
                ranked.append((score, doc))
        ranked.sort(key=lambda item: item[0], reverse=True)
        return [doc for _, doc in ranked[:4]]

    def _terms(self, query: str) -> list[str]:
        found = [w.lower() for w in re.findall(r"[A-Za-z][A-Za-z0-9-]{2,}", query)]
        terms: list[str] = []
        seen: set[str] = set()
        for word in found:
            if word in _STOPWORDS or word in seen:
                continue
            seen.add(word)
            terms.append(word)
            for alias in _ALIASES.get(word, ()):
                if alias not in seen:
                    seen.add(alias)
                    terms.append(alias)
        return terms

    def _score_text(self, text: str, terms: list[str]) -> float:
        low = (text or "").lower()
        if not low or not terms:
            return 0.0
        score = 0.0
        for term in terms:
            count = low.count(term)
            if count:
                score += 2.0 + min(count, 5)
        return score

    def _best_lexical_score(self, query: str, chunks: list[RetrievedChunk]) -> float:
        terms = self._terms(query)
        best = 0.0
        for doc in self._fact_docs:
            best = max(best, self._score_text(f"{doc.publication_title} {doc.text}", terms))
        for chunk in chunks:
            blob = f"{chunk.metadata.get('publication_title', '')} {chunk.text}"
            best = max(best, self._score_text(blob, terms))
        return best

    def _ensure_memory_index(self) -> None:
        if self._memory_chunks:
            return
        try:
            store = self.collection()
            if store.count() == 0:
                return
            data = store.get(include=["documents", "metadatas"])
            chunks: list[RetrievedChunk] = []
            for text, meta in zip(data.get("documents") or [], data.get("metadatas") or []):
                if not text:
                    continue
                chunks.append(RetrievedChunk(text=text, metadata=dict(meta or {}), distance=0.2))
            self._memory_chunks = chunks
            LOGGER.info("Lexical memory index ready (%s chunks)", len(chunks))
        except Exception:
            LOGGER.warning("Could not load lexical memory index")

    def _lexical_lookup(self, query: str, limit: int = 8) -> list[RetrievedChunk]:
        self._ensure_memory_index()
        terms = self._terms(query)
        if not terms:
            return []
        corpus: list[RetrievedChunk] = list(self._memory_chunks)
        for doc in list(self._fact_docs) + list(self._project_docs or []):
            corpus.append(
                RetrievedChunk(
                    text=doc.text,
                    metadata={
                        "source_type": doc.source_type,
                        "source_origin": doc.source_origin,
                        "section": doc.section,
                        "publication_title": doc.publication_title or doc.section,
                        "doi": doc.doi or "",
                    },
                    distance=0.08,
                )
            )
        ranked: list[tuple[float, RetrievedChunk]] = []
        for chunk in corpus:
            blob = f"{chunk.metadata.get('publication_title', '')} {chunk.text}"
            score = self._score_text(blob, terms)
            if score <= 0:
                continue
            ranked.append(
                (
                    score,
                    RetrievedChunk(
                        text=chunk.text,
                        metadata=chunk.metadata,
                        distance=max(0.01, 1.0 / (score + 1.0)),
                    ),
                )
            )
        ranked.sort(key=lambda item: item[0], reverse=True)
        return [item[1] for item in ranked[:limit]]

    def _merge_chunks(
        self, lexical: list[RetrievedChunk], semantic: list[RetrievedChunk]
    ) -> list[RetrievedChunk]:
        merged: list[RetrievedChunk] = []
        seen: set[str] = set()
        for chunk in lexical + semantic:
            key = (chunk.text or "")[:80]
            if not key or key in seen:
                continue
            seen.add(key)
            merged.append(chunk)
        return merged[:TOP_K]

    def _vector_lookup(self, query: str) -> tuple[list[RetrievedChunk], list[float]]:
        try:
            store = self.collection()
            if store.count() == 0:
                return [], []
            qvec = self.embeddings().embed_query(query)
            result = store.query(
                query_embeddings=[qvec],
                n_results=min(TOP_K, max(store.count(), 1)),
                include=["documents", "metadatas", "distances"],
            )
            documents = (result.get("documents") or [[]])[0]
            metadatas = (result.get("metadatas") or [[]])[0]
            distances = (result.get("distances") or [[]])[0]
            chunks: list[RetrievedChunk] = []
            dist_list: list[float] = []
            for text, meta, dist in zip(documents, metadatas, distances):
                if not text:
                    continue
                distance = float(dist)
                chunks.append(
                    RetrievedChunk(text=text, metadata=dict(meta or {}), distance=distance)
                )
                dist_list.append(distance)
            return chunks, dist_list
        except Exception:
            LOGGER.exception("Vector lookup failed")
            return [], []

    def _fast_web_search(self, query: str) -> list[ParsedDoc]:
        docs: list[ParsedDoc] = []
        seen: set[str] = set()

        def _keep(items: list[ParsedDoc]) -> None:
            for doc in items:
                key = f"{doc.source_origin}|{doc.text[:80]}"
                if key in seen or not (doc.text or "").strip():
                    continue
                seen.add(key)
                docs.append(doc)

        biased = f"{query} OneAquaHealth"
        with ThreadPoolExecutor(max_workers=3) as pool:
            futures = [
                pool.submit(self._ddg_instant, query),
                pool.submit(self._ddg_instant, biased),
                pool.submit(self._duckduckgo_search, biased),
            ]
            tavily_key = os.getenv("TAVILY_API_KEY") or ""
            if tavily_key:
                futures.append(pool.submit(self._tavily_search, biased, tavily_key))
            try:
                from concurrent.futures import as_completed

                for future in as_completed(futures, timeout=WEB_TIMEOUT_SEC):
                    try:
                        _keep(future.result() or [])
                    except Exception:
                        continue
            except Exception:
                for future in futures:
                    if future.done():
                        try:
                            _keep(future.result() or [])
                        except Exception:
                            pass
        return docs[:8]

    def _ddg_instant(self, query: str) -> list[ParsedDoc]:
        try:
            response = requests.get(
                "https://api.duckduckgo.com/",
                params={"q": query, "format": "json", "no_html": 1, "skip_disambig": 1, "no_redirect": 1},
                timeout=1.8,
                headers={"User-Agent": USER_AGENT},
            )
            response.raise_for_status()
            payload = response.json() or {}
            docs: list[ParsedDoc] = []
            heading = str(payload.get("Heading") or "DuckDuckGo")
            abstract = str(payload.get("AbstractText") or payload.get("Answer") or "").strip()
            url = str(payload.get("AbstractURL") or "https://duckduckgo.com")
            if abstract:
                docs.append(
                    ParsedDoc(
                        text=abstract,
                        source_type="url",
                        source_origin=url,
                        section=heading,
                        publication_title=heading,
                        doi="web",
                    )
                )
            for item in (payload.get("RelatedTopics") or [])[:3]:
                if not isinstance(item, dict):
                    continue
                text = str(item.get("Text") or "").strip()
                href = str(item.get("FirstURL") or url)
                if text:
                    docs.append(
                        ParsedDoc(
                            text=text,
                            source_type="url",
                            source_origin=href,
                            section=heading,
                            publication_title=heading,
                            doi="web",
                        )
                    )
            return docs
        except Exception:
            LOGGER.warning("DuckDuckGo instant answer failed")
            return []

    def _tavily_search(self, query: str, api_key: str) -> list[ParsedDoc]:
        try:
            response = requests.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": api_key,
                    "query": query,
                    "max_results": 5,
                    "search_depth": "basic",
                },
                timeout=WEB_TIMEOUT_SEC,
            )
            response.raise_for_status()
            payload = response.json()
            docs: list[ParsedDoc] = []
            for item in payload.get("results") or []:
                url = str(item.get("url") or "tavily")
                title = str(item.get("title") or url)
                body = str(item.get("content") or "").strip()
                if not body:
                    continue
                docs.append(
                    ParsedDoc(
                        text=f"{title}\n{body}",
                        source_type="url",
                        source_origin=url,
                        section=title[:180],
                    )
                )
            return docs
        except Exception:
            LOGGER.exception("Tavily search failed")
            return []

    def _duckduckgo_search(self, query: str) -> list[ParsedDoc]:
        try:
            try:
                from ddgs import DDGS
            except Exception:
                from duckduckgo_search import DDGS  # type: ignore
            client = DDGS()
            rows = []
            try:
                try:
                    rows = client.text(query, max_results=4, backend="duckduckgo") or []
                except TypeError:
                    rows = client.text(query, max_results=4) or []
            except Exception:
                LOGGER.warning("DuckDuckGo text search returned no rows")
                rows = []
            finally:
                close = getattr(client, "close", None)
                if callable(close):
                    close()
            docs: list[ParsedDoc] = []
            for item in rows:
                url = str(item.get("href") or item.get("url") or "duckduckgo")
                title = str(item.get("title") or url)
                body = str(item.get("body") or item.get("snippet") or "").strip()
                if not body:
                    continue
                docs.append(
                    ParsedDoc(
                        text=f"{title}\n{body}",
                        source_type="url",
                        source_origin=url,
                        section=title[:180],
                        publication_title=title[:180],
                        doi="web",
                    )
                )
            return docs
        except Exception:
            LOGGER.warning("DuckDuckGo search failed")
            return []

    def _build_context(
        self,
        chunks: list[RetrievedChunk],
        web_docs: list[ParsedDoc],
    ) -> tuple[list[str], list[SourceMetadata]]:
        blocks: list[str] = []
        sources: list[SourceMetadata] = []
        seen: set[str] = set()
        now = datetime.now(timezone.utc).isoformat()

        for chunk in chunks:
            origin = str(chunk.metadata.get("source_origin") or "knowledge-base")
            section = str(chunk.metadata.get("section") or "")
            if _looks_like_citation_dump(chunk.text):
                continue
            cite = _cite_label(chunk.metadata, origin, section)
            key = f"{cite}|{chunk.text[:80]}"
            if key in seen:
                continue
            seen.add(key)
            blocks.append(f"[Source: {cite}]\n{chunk.text}")
            sources.append(
                SourceMetadata(
                    source_type=str(chunk.metadata.get("source_type") or "text"),
                    source_origin=origin,
                    timestamp=str(chunk.metadata.get("timestamp") or now),
                    section=section,
                    score=round(float(chunk.distance), 4),
                    excerpt=chunk.text[:1200],
                    publication_title=(str(chunk.metadata.get("publication_title") or section) or None),
                    doi=(str(chunk.metadata.get("doi") or "") or None),
                )
            )

        for doc in web_docs:
            if _looks_like_citation_dump(doc.text):
                continue
            cite = _cite_label(
                {"publication_title": doc.publication_title or doc.section, "doi": doc.doi or doc.source_origin},
                doc.source_origin,
                doc.section,
            )
            key = f"{cite}|{doc.text[:80]}"
            if key in seen:
                continue
            seen.add(key)
            blocks.append(f"[Source: {cite}]\n{doc.text}")
            sources.append(
                SourceMetadata(
                    source_type=doc.source_type,
                    source_origin=doc.source_origin,
                    timestamp=now,
                    section=doc.section,
                    score=None,
                    excerpt=doc.text[:1200],
                    publication_title=doc.publication_title or doc.section,
                    doi=doc.doi or None,
                )
            )
        return blocks, sources

    def _extractive_answer(self, query: str, sources: list[SourceMetadata]) -> str:
        terms = self._terms(query)

        def clean(text: str) -> str:
            t = " ".join((text or "").split())
            t = t.replace("Skip to the content", " ").replace("Skip to content", " ")
            if "Abstract:" in t:
                t = t.split("Abstract:", 1)[1]
            for prefix in ("Publication title:", "DOI/Identifier:", "Landing URL:", "Collection:"):
                if t.startswith(prefix):
                    cut = t.find("Venue:")
                    t = t[cut:] if cut > 0 else ""
                    break
            return " ".join(t.split())

        def window(text: str) -> str:
            t = clean(text)
            if len(t) <= 520:
                return t
            low = t.lower()
            best_i, best_s = 0, -1
            for i in range(0, max(1, len(t) - 520), 60):
                chunk = low[i : i + 520]
                score = sum(chunk.count(term) for term in terms)
                if score > best_s:
                    best_s, best_i = score, i
            snippet = t[best_i : best_i + 520]
            if best_i > 0:
                dotted = snippet.find(". ")
                if 0 <= dotted < 90:
                    snippet = snippet[dotted + 2 :]
            return snippet.rsplit(" ", 1)[0] + "…"

        scored: list[tuple[float, SourceMetadata]] = []
        fact_titles = {str(item["title"]).lower() for item in PROJECT_FACTS}
        for src in sources:
            blob = f"{src.publication_title or ''} {src.excerpt or ''}"
            if _looks_like_citation_dump(blob):
                continue
            score = self._score_text(blob, terms)
            title = (src.publication_title or "").lower()
            if title in fact_titles or title == "oneaquahealth project website":
                score += 24
            if score > 0:
                scored.append((score, src))
        scored.sort(key=lambda item: item[0], reverse=True)
        bits: list[str] = []
        for _, src in scored[:2]:
            excerpt = window(src.excerpt or "")
            if len(excerpt) < 40:
                continue
            cite = _cite_label(
                {
                    "publication_title": src.publication_title or src.section,
                    "doi": src.doi or "",
                },
                src.source_origin,
                src.section,
            )
            bits.append(f"{excerpt} [Source: {cite}]")
        if not bits:
            return INSUFFICIENT
        return " ".join(bits)

    def _grok_generate(self, human: str) -> str:
        if self._grok_disabled:
            return ""
        key = os.getenv("XAI_API_KEY") or ""
        if not key.startswith("xai-"):
            self._grok_disabled = True
            return ""
        try:
            response = requests.post(
                "https://api.x.ai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": XAI_MODEL,
                    "temperature": 0.2,
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": human},
                    ],
                },
                timeout=4.5,
            )
            if response.status_code in {401, 403}:
                self._grok_disabled = True
                LOGGER.warning("Grok HTTP %s — using Gemini until restart", response.status_code)
                return ""
            if response.status_code >= 400:
                LOGGER.warning("Grok HTTP %s — falling back to Gemini", response.status_code)
                return ""
            payload = response.json() or {}
            choices = payload.get("choices") or []
            if not choices:
                return ""
            content = ((choices[0] or {}).get("message") or {}).get("content") or ""
            return str(content).strip()
        except Exception:
            LOGGER.warning("Grok generation failed")
            return ""

    def _gemini_generate(self, human: str) -> str:
        from google.genai import types

        seen: set[str] = set()
        config = types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            temperature=0.2,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        )
        for model in GEMINI_CHAT_FALLBACKS:
            if not model or model in seen:
                continue
            seen.add(model)
            try:
                def _call(chosen: str = model) -> str:
                    response = self.gemini_client().models.generate_content(
                        model=chosen.replace("models/", ""),
                        contents=human,
                        config=config,
                    )
                    return str(getattr(response, "text", "") or "").strip()

                future = self._pool.submit(_call)
                text = future.result(timeout=LLM_TIMEOUT_SEC) or ""
                if text:
                    if model != GEMINI_CHAT_MODEL:
                        LOGGER.info("Gemini generation succeeded with %s", model)
                    return text
            except FuturesTimeout:
                LOGGER.warning("Gemini (%s) timed out after %ss", model, LLM_TIMEOUT_SEC)
                return ""
            except Exception as exc:
                err = str(exc).lower()
                LOGGER.warning("Gemini (%s) generation failed", model)
                if any(tok in err for tok in ("404", "not found", "not supported", "unknown model", "invalid model")):
                    continue
                return ""
        return ""

    def _generate(self, query: str, context_blocks: list[str], sources: list[SourceMetadata]) -> str:
        fallback = self._extractive_answer(query, sources)
        packed = "\n\n".join(context_blocks)[:6000]
        human = (
            f"Question:\n{query}\n\n"
            "Retrieved OneAquaHealth publication chunks and fast web snippets:\n"
            f"{packed}\n\n"
            "Answer using this evidence. Cite every factual claim as "
            "[Source: Publication Title, DOI/Identifier]. Prefer publication chunks; "
            "use web snippets when they fill a gap about the OneAquaHealth project."
        )
        text = self._grok_generate(human)
        if text and text != INSUFFICIENT:
            return text
        if os.getenv("GOOGLE_API_KEY"):
            if not self._grok_disabled:
                LOGGER.warning("Grok unavailable or ungrounded — falling back to Gemini generation")
            text = self._gemini_generate(human)
            if text and text != INSUFFICIENT:
                return text
            if text == INSUFFICIENT:
                return fallback
            LOGGER.warning("Gemini generation unavailable — using extractive answer")
        return fallback


ENGINE = AquaAskEngine()


def handle_search(query_text: str, force_web_search: bool = False) -> dict:
    """Standalone bridge used by the API and direct module invocation."""
    return ENGINE.search(query_text, force_web_search=force_web_search)


def handle_ingestion(source_path_or_url: str) -> bool:
    """Standalone bridge used by the API and direct module invocation."""
    return ENGINE.ingest(source_path_or_url)


def _ingest_job(source: str) -> None:
    ok = handle_ingestion(source)
    LOGGER.info("Background ingest %s for %s", "ok" if ok else "failed", source[:160])


def _seed_oneaquahealth_job() -> None:
    try:
        count = ENGINE.collection().count()
        LOGGER.info("Chroma corpus size: %s chunks", count)
        if count == 0:
            loaded = ENGINE.load_portable_corpus()
            if loaded:
                LOGGER.info("OneAquaHealth portable corpus ready: %s chunks", loaded)
            else:
                result = ENGINE.ingest_oneaquahealth()
                LOGGER.info("OneAquaHealth seed complete: %s", result)
        ENGINE._ensure_memory_index()
        try:
            ENGINE._project_docs = []
            LOGGER.info("Using curated project facts (site scrape skipped)")
        except Exception:
            LOGGER.warning("Could not cache oneaquahealth.eu brief")
        try:
            ENGINE.gemini_client().models.generate_content(
                model=GEMINI_CHAT_MODEL.replace("models/", ""),
                contents="OK",
            )
            LOGGER.info("Gemini generation warmup complete")
        except Exception:
            LOGGER.warning("Gemini generation warmup skipped")
        try:
            key = os.getenv("XAI_API_KEY") or ""
            if key.startswith("xai-"):
                probe = requests.post(
                    "https://api.x.ai/v1/models",
                    headers={"Authorization": f"Bearer {key}"},
                    timeout=4.0,
                )
                if probe.status_code in {401, 403}:
                    ENGINE._grok_disabled = True
                    LOGGER.warning("Grok disabled for this process (HTTP %s)", probe.status_code)
        except Exception:
            LOGGER.warning("Grok warmup probe skipped")
    except Exception:
        LOGGER.exception("OneAquaHealth warmup failed")


@asynccontextmanager
async def lifespan(_: FastAPI):
    LOGGER.info("AquaAsk RAG API ready — seeding OneAquaHealth corpus in background")
    loop = asyncio.get_running_loop()
    loop.run_in_executor(None, _seed_oneaquahealth_job)
    yield


app = FastAPI(title="AquaAsk RAG", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/search", response_model=SearchResponse)
async def api_search(payload: SearchRequest) -> SearchResponse:
    try:
        result = await asyncio.to_thread(
            handle_search, payload.query, payload.force_web_search
        )
        return SearchResponse(**result)
    except Exception:
        LOGGER.exception("POST /api/search crashed")
        return SearchResponse(answer=INSUFFICIENT, sources=[])


@app.post("/api/ingest", response_model=IngestionAck)
async def api_ingest(payload: IngestionRequest, background_tasks: BackgroundTasks) -> IngestionAck:
    background_tasks.add_task(_ingest_job, payload.source)
    return IngestionAck(accepted=True, source=payload.source)


@app.post("/api/ingest/oneaquahealth", response_model=IngestionAck)
async def api_ingest_oneaquahealth(background_tasks: BackgroundTasks) -> IngestionAck:
    background_tasks.add_task(_seed_oneaquahealth_job)
    return IngestionAck(accepted=True, source="oneaquahealth", indexed=len(ONEAQUAHEALTH_PUBLICATIONS))


if (ROOT / "h2o-assets").is_dir():
    app.mount("/h2o-assets", StaticFiles(directory=str(ROOT / "h2o-assets")), name="h2o-assets")


@app.get("/health")
async def health():
    return {"ok": True, "service": "aquaask", "url": PUBLIC_APP_URL, "repo": GITHUB_REPO_URL}


@app.get("/")
@app.get("/aquaask.html")
async def root_page():
    page = ROOT / "aquaask.html"
    if page.is_file():
        return FileResponse(page)
    return {"service": "aquaask-rag", "docs": "/docs", "url": PUBLIC_APP_URL, "repo": GITHUB_REPO_URL}


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8001"))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=False)
