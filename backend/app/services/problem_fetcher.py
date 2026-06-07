"""
services/problem_fetcher.py
Fetch any LeetCode problem using:
  Step 1 — REST: GET /api/problems/all/  → number → slug mapping
  Step 2 — GraphQL: POST /graphql        → full problem data

No AI needed. No authentication required.
Works for all ~3000 free LeetCode problems.
"""

import re
import logging
import httpx
from typing import Optional

from ..models.problem import Problem

logger = logging.getLogger(__name__)

LEETCODE_BASE    = "https://leetcode.com"
LEETCODE_GRAPHQL = "https://leetcode.com/graphql"
PROBLEMS_LIST_URL = "https://leetcode.com/api/problems/all/"

GRAPHQL_QUERY = """
query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionFrontendId
    title
    titleSlug
    content
    difficulty
    topicTags { name }
    exampleTestcases
    hints
    isPaidOnly
  }
}
"""

# ── In-memory caches ──────────────────────────────────────────────
_SLUG_FROM_NUMBER: dict[int, str] = {}   # number  → slug
_PROBLEM_CACHE:    dict[str, Problem] = {}   # slug → Problem
_PROBLEMS_LIST_LOADED: bool = False

# ── HTTP headers ──────────────────────────────────────────────────
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "Referer": "https://leetcode.com",
}


# ── Step 1: slug lookup ───────────────────────────────────────────

async def _ensure_problems_list() -> None:
    """
    Fetch /api/problems/all/ once and populate _SLUG_FROM_NUMBER.
    Subsequent calls are instant (cache hit).
    """
    global _PROBLEMS_LIST_LOADED
    if _PROBLEMS_LIST_LOADED:
        return

    logger.info("Fetching LeetCode problems list (one-time)…")
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        resp = await client.get(PROBLEMS_LIST_URL, headers=_HEADERS)
        resp.raise_for_status()
        data = resp.json()

    for item in data.get("stat_status_pairs", []):
        stat = item.get("stat", {})
        num  = stat.get("frontend_question_id")
        slug = stat.get("question__title_slug")
        if num and slug:
            _SLUG_FROM_NUMBER[int(num)] = slug

    _PROBLEMS_LIST_LOADED = True
    logger.info("Loaded %d problems into slug cache", len(_SLUG_FROM_NUMBER))


async def _slug_from_number(number: int) -> str:
    await _ensure_problems_list()
    slug = _SLUG_FROM_NUMBER.get(number)
    if not slug:
        raise ValueError(
            f"LeetCode problem #{number} not found. "
            "Check the number is correct (must be a valid free LeetCode problem)."
        )
    return slug


# ── Step 2: GraphQL fetch ─────────────────────────────────────────

async def _graphql_fetch(slug: str) -> dict:
    """POST to LeetCode GraphQL and return the question dict."""
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        resp = await client.post(
            LEETCODE_GRAPHQL,
            json={"query": GRAPHQL_QUERY, "variables": {"titleSlug": slug}},
            headers={**_HEADERS, "Content-Type": "application/json"},
        )
        resp.raise_for_status()
        data = resp.json()

    question = data.get("data", {}).get("question")
    if not question:
        raise ValueError(f"Problem '{slug}' returned no data from LeetCode.")
    if question.get("isPaidOnly"):
        raise ValueError(
            f"Problem '{slug}' is a LeetCode Premium problem. "
            "Use 'Paste Text' or 'Upload Image' mode to load it."
        )
    return question


# ── Public API ────────────────────────────────────────────────────

async def fetch_problem_by_number(number: int) -> Problem:
    """Fetch a LeetCode problem by its frontend problem number (e.g. 42)."""
    # Check problem cache first
    for p in _PROBLEM_CACHE.values():
        if p.leetcode_id == number:
            return p

    slug = await _slug_from_number(number)
    return await fetch_problem_by_slug(slug)


async def fetch_problem_by_slug(slug: str) -> Problem:
    """Fetch a LeetCode problem by its URL slug (e.g. 'trapping-rain-water')."""
    if slug in _PROBLEM_CACHE:
        return _PROBLEM_CACHE[slug]

    logger.info("Fetching LeetCode problem via GraphQL: %s", slug)
    raw = await _graphql_fetch(slug)
    problem = _build_problem(raw)
    _PROBLEM_CACHE[slug] = problem
    return problem


# ── Build Problem model from GraphQL response ──────────────────────

def _build_problem(q: dict) -> Problem:
    from ..data.problems import _STARTER_CODE

    lc_id      = int(q.get("questionFrontendId") or 0)
    topic_tags = [t["name"] for t in (q.get("topicTags") or [])]
    content    = q.get("content") or ""
    patterns   = _infer_patterns(topic_tags, content)

    # Extract examples from raw HTML (before converting to markdown)
    examples   = _extract_examples_html(content)

    # Convert content HTML -> markdown for statement + constraints
    content_md  = _html_to_md(content)
    constraints = _extract_constraints(content_md)
    statement   = _clean_statement(content_md)

    return Problem(
        id=lc_id,
        leetcodeId=lc_id,
        title=q.get("title", "Unknown"),
        difficulty=q.get("difficulty", "Medium"),
        tags=topic_tags or ["Algorithm"],
        patterns=patterns,
        statement=statement,
        examples=examples,
        constraints=constraints,
        timeComplexity="",
        spaceComplexity="",
        starterCode=_STARTER_CODE.get(lc_id, {}),
    )


# ── HTML → Markdown ───────────────────────────────────────────────

def _html_to_md(html: str) -> str:
    import html as html_mod
    text = html_mod.unescape(html)
    # Bold / italic / code
    text = re.sub(r"<strong[^>]*>(.*?)</strong>", r"**\1**", text, flags=re.S)
    text = re.sub(r"<b[^>]*>(.*?)</b>",           r"**\1**", text, flags=re.S)
    text = re.sub(r"<em[^>]*>(.*?)</em>",          r"*\1*",   text, flags=re.S)
    text = re.sub(r"<code[^>]*>(.*?)</code>",      r"`\1`",   text, flags=re.S)
    # Pre blocks
    text = re.sub(r"<pre[^>]*>(.*?)</pre>",
                  lambda m: "\n```\n" + m.group(1).strip() + "\n```\n",
                  text, flags=re.S)
    # Lists
    text = re.sub(r"<li[^>]*>(.*?)</li>",   r"- \1\n", text, flags=re.S)
    text = re.sub(r"<ul[^>]*>(.*?)</ul>",   r"\1",     text, flags=re.S)
    text = re.sub(r"<ol[^>]*>(.*?)</ol>",   r"\1",     text, flags=re.S)
    # Paragraphs / divs
    text = re.sub(r"<p[^>]*>(.*?)</p>",     r"\1\n\n", text, flags=re.S)
    text = re.sub(r"<div[^>]*>(.*?)</div>", r"\1\n",   text, flags=re.S)
    # Images (remove completely — LeetCode uses them for examples)
    text = re.sub(r"<img[^>]*/?>",          "",        text)
    # Strip remaining tags
    text = re.sub(r"<[^>]+>", "", text)
    # Clean up nbsp and excessive newlines
    text = text.replace("\xa0", " ").replace("&nbsp;", " ")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# ── DSA pattern inference ─────────────────────────────────────────

_TOPIC_TO_PATTERN = {
    "Array":                   "Array",
    "Hash Table":              "Hash Map",
    "Sliding Window":          "Sliding Window",
    "Two Pointers":            "Two Pointers",
    "Binary Search":           "Binary Search",
    "Dynamic Programming":     "Dynamic Programming",
    "Breadth-First Search":    "BFS",
    "Depth-First Search":      "DFS / Backtrack",
    "Backtracking":            "DFS / Backtrack",
    "Stack":                   "Stack",
    "Monotonic Stack":         "Stack",
    "Heap (Priority Queue)":   "Heap",
    "Tree":                    "Tree",
    "Binary Tree":             "Tree",
    "Binary Search Tree":      "Tree",
    "Graph":                   "Graph",
    "Linked List":             "Linked List",
    "Greedy":                  "Greedy",
    "Prefix Sum":              "Prefix Sum",
    "Trie":                    "Trie",
    "String":                  "String",
    "Bit Manipulation":        "Bit Manipulation",
    "Math":                    "Math",
    "Sorting":                 "Sorting",
    "Union Find":              "Union Find",
    "Divide and Conquer":      "Divide and Conquer",
    "Recursion":               "DFS / Backtrack",
    "Matrix":                  "Matrix",
    "Queue":                   "Queue",
    "Deque":                   "Deque",
    "Segment Tree":            "Segment Tree",
    "Counting":                "Hash Map",
    "Number Theory":           "Math",
    "Simulation":              "Simulation",
    "Enumeration":             "Brute Force",
}

_CONTENT_HINTS = [
    (["sliding window", "window of size"],          "Sliding Window"),
    (["two pointer", "two-pointer", "left.*right"], "Two Pointers"),
    (["hash map", "hash table", "frequency"],       "Hash Map"),
    (["binary search"],                             "Binary Search"),
    (["dp", "dynamic programming", "memoiz"],       "Dynamic Programming"),
    (["bfs", "breadth-first", "level order"],       "BFS"),
    (["dfs", "depth-first", "backtrack"],           "DFS / Backtrack"),
    (["stack", "monotonic"],                        "Stack"),
    (["heap", "priority queue"],                    "Heap"),
    (["prefix sum", "prefix\["],                    "Prefix Sum"),
]


def _infer_patterns(topic_tags: list[str], content: str) -> list[str]:
    seen: set[str] = set()
    patterns: list[str] = []

    for tag in topic_tags:
        p = _TOPIC_TO_PATTERN.get(tag)
        if p and p not in seen:
            seen.add(p)
            patterns.append(p)

    if not patterns:
        low = content.lower()
        for keywords, p in _CONTENT_HINTS:
            if any(re.search(kw, low) for kw in keywords):
                if p not in seen:
                    seen.add(p)
                    patterns.append(p)
                if len(patterns) >= 3:
                    break

    return patterns or ["General"]


# ── Extract examples from LeetCode HTML ───────────────────────────

def _extract_examples_html(html: str) -> list[dict]:
    """
    Parse LeetCode examples from raw HTML.
    LeetCode puts examples in <pre> blocks like:
      <pre>
      <strong>Input:</strong> nums = [2,7,11,15], target = 9
      <strong>Output:</strong> [0,1]
      <strong>Explanation:</strong> Because nums[0] + nums[1] == 9, we return [0, 1].
      </pre>
    """
    import html as html_mod
    examples = []

    # Find all <pre> blocks
    pre_blocks = re.findall(r"<pre[^>]*>(.*?)</pre>", html, re.DOTALL | re.IGNORECASE)

    for block in pre_blocks:
        # Remove HTML tags except keep text
        text = re.sub(r"<[^>]+>", "", block)
        text = html_mod.unescape(text).strip()

        inp  = _extract_field(text, "Input")
        out  = _extract_field(text, "Output")
        expl = _extract_field(text, "Explanation")

        if inp and out:
            examples.append({
                "input":       inp.strip(),
                "output":      out.strip(),
                "explanation": expl.strip() if expl else "",
            })

    return examples[:4]


def _extract_field(text: str, field: str) -> str:
    """Extract a field value from a block of text like 'Input: ...\nOutput: ...'."""
    pattern = re.compile(
        rf"{field}:\s*(.*?)(?=\n(?:Input|Output|Explanation):|\Z)",
        re.DOTALL | re.IGNORECASE,
    )
    m = pattern.search(text)
    return m.group(1).strip() if m else ""


# ── Extract examples from markdown (fallback) ─────────────────────

def _extract_examples(md: str) -> list[dict]:
    """Fallback markdown-based example extractor (for AI-parsed text problems)."""
    examples = []
    pattern = re.compile(
        r"(?:Example\s*\d*\s*:?\s*\n+)"
        r"(?:```\s*)?"
        r"Input\s*:\s*(.*?)\n"
        r"Output\s*:\s*(.*?)(?:\n|$)"
        r"(?:Explanation\s*:\s*(.*?)(?=\n\n|\Z|Example))?",
        re.DOTALL | re.IGNORECASE,
    )
    for m in pattern.finditer(md):
        inp  = m.group(1).strip().strip("`").strip()
        out  = m.group(2).strip().strip("`").strip()
        expl = (m.group(3) or "").strip().strip("`").strip()
        if inp and out:
            examples.append({"input": inp, "output": out, "explanation": expl})
    return examples[:4]


def _extract_constraints(md: str) -> list[str]:
    # Match bold **Constraints:** or plain Constraints:
    m = re.search(r"\*\*Constraints:?\*\*\s*\n(.*?)(?=\n\*\*|\n#|\Z)", md, re.DOTALL)
    if not m:
        m = re.search(r"Constraints:?\s*\n(.*?)(?=\n\n|\n#|\Z)", md, re.DOTALL)
    if not m:
        return []

    lines = []
    for ln in m.group(1).splitlines():
        # Strip leading - * ` and trailing `
        cleaned = re.sub(r"^[\-\*\s`]+", "", ln).rstrip("`").strip()
        if cleaned and len(cleaned) > 1:
            lines.append(cleaned)
    return lines


def _clean_statement(md: str) -> str:
    # Cut at first "Example" or "Constraints" heading
    md = re.split(r"\n\*\*Example|\nExample\s*\d", md, maxsplit=1)[0]
    md = re.split(r"\n\*\*Constraints?|\nConstraints?:", md, maxsplit=1)[0]
    return md.strip()
