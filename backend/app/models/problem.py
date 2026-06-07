"""
models/problem.py
Pydantic models for problems, examples, and constraints.
These are the canonical data shapes shared across the application.
"""

from pydantic import BaseModel, Field
from typing import Optional


class ProblemExample(BaseModel):
    input: str
    output: str
    explanation: Optional[str] = None


class Problem(BaseModel):
    id: int
    leetcode_id: int = Field(alias="leetcodeId")
    title: str
    difficulty: str                        # "Easy" | "Medium" | "Hard"
    tags: list[str] = []
    patterns: list[str] = []
    time_complexity: Optional[str] = Field(None, alias="timeComplexity")
    space_complexity: Optional[str] = Field(None, alias="spaceComplexity")
    statement: str
    examples: list[ProblemExample] = []
    constraints: list[str] = []
    starter_code: dict[str, str] = Field(default_factory=dict, alias="starterCode")

    model_config = {"populate_by_name": True}


class ProblemParseRequest(BaseModel):
    input: str = Field(..., description="LeetCode number, URL, or problem title")
