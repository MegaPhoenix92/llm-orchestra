from __future__ import annotations

import copy
import inspect
import math
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from ..types import (
    CacheConfig,
    CacheEmbeddingFunction,
    CacheEmbeddingInput,
    CacheKeyFunction,
    CompletionRequest,
    CompletionResponse,
)

DEFAULT_SIMILARITY_THRESHOLD = 0.9
DEFAULT_TTL_SECONDS = 3600
DEFAULT_MAX_SIZE = 500
DEFAULT_EMBEDDING_DIM = 128


@dataclass
class CacheEntry:
    signature: str
    embedding: List[float]
    response: CompletionResponse
    created_at: float
    last_accessed: float


class SemanticCache:
    def __init__(self, config: CacheConfig) -> None:
        self.config = {
            "ttlSeconds": config.get("ttlSeconds", DEFAULT_TTL_SECONDS),
            "maxSize": config.get("maxSize", DEFAULT_MAX_SIZE),
            "similarityThreshold": config.get("similarityThreshold", DEFAULT_SIMILARITY_THRESHOLD),
        }
        self.embedder: CacheEmbeddingFunction = config.get("embeddingFunction") or default_embedder
        self.key_function: CacheKeyFunction = config.get("keyFunction") or default_key_function
        self.entries: List[CacheEntry] = []

    async def get(self, request: CompletionRequest) -> Optional[CompletionResponse]:
        signature = self.key_function(request)
        self._prune_expired()

        candidates = [entry for entry in self.entries if entry.signature == signature]
        if not candidates:
            return None

        embedding = await _maybe_await(
            self.embedder({"text": build_embedding_text(request), "request": request})
        )

        best_match: Optional[CacheEntry] = None
        best_score = self.config["similarityThreshold"]

        for entry in candidates:
            score = cosine_similarity(embedding, entry.embedding)
            if score >= best_score:
                best_score = score
                best_match = entry

        if not best_match:
            return None

        best_match.last_accessed = time.time()
        return copy.deepcopy(best_match.response)

    async def set(self, request: CompletionRequest, response: CompletionResponse) -> None:
        signature = self.key_function(request)
        embedding = await _maybe_await(
            self.embedder({"text": build_embedding_text(request), "request": request})
        )

        now = time.time()
        entry = CacheEntry(
            signature=signature,
            embedding=embedding,
            response=copy.deepcopy(response),
            created_at=now,
            last_accessed=now,
        )

        self.entries.append(entry)
        self._prune_expired()
        self._prune_overflow()

    def clear(self) -> None:
        self.entries = []

    def _prune_expired(self) -> None:
        now = time.time()
        max_age = self.config["ttlSeconds"]
        self.entries = [
            entry for entry in self.entries if (now - entry.created_at) <= max_age
        ]

    def _prune_overflow(self) -> None:
        max_size = self.config["maxSize"]
        if len(self.entries) <= max_size:
            return
        self.entries.sort(key=lambda entry: entry.last_accessed, reverse=True)
        self.entries = self.entries[:max_size]


async def _maybe_await(value):
    if inspect.isawaitable(value):
        return await value
    return value


def default_key_function(request: CompletionRequest) -> str:
    return stable_stringify(
        {
            "model": request.get("model"),
            "temperature": request.get("temperature"),
            "maxTokens": request.get("maxTokens"),
            "topP": request.get("topP"),
            "stop": request.get("stop"),
            "toolChoice": request.get("toolChoice"),
            "tools": request.get("tools"),
        }
    )


async def default_embedder(input_data: CacheEmbeddingInput) -> List[float]:
    tokens = tokenize(input_data.get("text", ""))
    if not tokens:
        return [0.0] * DEFAULT_EMBEDDING_DIM

    vector = [0.0] * DEFAULT_EMBEDDING_DIM
    for token in tokens:
        index = hash_token(token) % DEFAULT_EMBEDDING_DIM
        vector[index] += 1.0

    return normalize_vector(vector)


def build_embedding_text(request: CompletionRequest) -> str:
    segments: List[str] = []
    for message in request.get("messages", []):
        role = message.get("role", "")
        name = f":{message.get('name')}" if message.get("name") else ""
        tool_id = f":{message.get('toolCallId')}" if message.get("toolCallId") else ""
        content = message.get("content", "")
        segments.append(f"{role}{name}{tool_id}:{content}")
    return "\n".join(segments)


def cosine_similarity(a: List[float], b: List[float]) -> float:
    if len(a) != len(b) or not a:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def normalize_vector(vector: List[float]) -> List[float]:
    norm = math.sqrt(sum(x * x for x in vector))
    if norm == 0:
        return vector
    return [x / norm for x in vector]


def tokenize(text: str) -> List[str]:
    return [token for token in text.lower().split() if token]


def hash_token(token: str) -> int:
    hash_value = 2166136261
    for char in token:
        hash_value ^= ord(char)
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    return hash_value


def stable_stringify(value: Any) -> str:
    if value is None or isinstance(value, (str, int, float, bool)):
        return repr(value)
    if isinstance(value, list):
        return "[" + ",".join(stable_stringify(item) for item in value) + "]"
    if isinstance(value, dict):
        items = sorted(value.items(), key=lambda item: item[0])
        return "{" + ",".join(f"{repr(k)}:{stable_stringify(v)}" for k, v in items) + "}"
    return repr(value)
