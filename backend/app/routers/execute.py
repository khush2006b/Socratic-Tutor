"""
routers/execute.py
Code execution endpoint — proxies to Piston API for safe sandboxed execution.

Piston is a free, open-source code execution engine that supports 50+ languages.
No API key needed. Runs code in isolated containers.
https://github.com/engineer-man/piston

Supports: Python, JavaScript, Java, C++
"""

import asyncio
import logging
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["execute"])

PISTON_URL = "https://emkc.org/api/v2/piston/execute"

# Map our language names to Piston's language + version
LANGUAGE_MAP = {
    "python":     {"language": "python",     "version": "3.10.0"},
    "javascript": {"language": "javascript", "version": "18.15.0"},
    "java":       {"language": "java",       "version": "15.0.2"},
    "cpp":        {"language": "c++",        "version": "10.2.0"},
}


class ExecuteRequest(BaseModel):
    code: str
    language: str = "python"
    stdin: str = ""


class ExecuteResponse(BaseModel):
    stdout: str
    stderr: str
    exit_code: int
    language: str
    timed_out: bool = False


@router.post("/execute", response_model=ExecuteResponse)
async def execute_code(req: ExecuteRequest):
    """
    Execute code via Piston API.
    Returns stdout, stderr, and exit code.
    """
    lang_config = LANGUAGE_MAP.get(req.language)
    if not lang_config:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported language: {req.language}. Supported: {list(LANGUAGE_MAP.keys())}",
        )

    if not req.code.strip():
        return ExecuteResponse(
            stdout="", stderr="No code to execute.", exit_code=1,
            language=req.language,
        )

    # Build Piston request
    payload = {
        "language": lang_config["language"],
        "version": lang_config["version"],
        "files": [{"name": f"main.{_ext(req.language)}", "content": req.code}],
        "stdin": req.stdin,
        "compile_timeout": 10000,   # 10s compile
        "run_timeout": 10000,       # 10s run
        "compile_memory_limit": -1,
        "run_memory_limit": -1,
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(PISTON_URL, json=payload)
            resp.raise_for_status()
            data = resp.json()
    except httpx.TimeoutException:
        return ExecuteResponse(
            stdout="", stderr="Execution timed out (20s limit).", exit_code=124,
            language=req.language, timed_out=True,
        )
    except httpx.HTTPStatusError as exc:
        logger.warning("Piston API error: %s %s", exc.response.status_code, exc.response.text[:200])
        raise HTTPException(status_code=502, detail="Code execution service temporarily unavailable.")
    except Exception as exc:
        logger.warning("Piston request failed: %s", exc)
        raise HTTPException(status_code=502, detail="Code execution service temporarily unavailable.")

    # Extract run result (Piston returns { run: { stdout, stderr, code, signal } })
    run = data.get("run", {})
    compile_result = data.get("compile", {})

    stdout = run.get("stdout", "")
    stderr = run.get("stderr", "")
    exit_code = run.get("code", 0) if run.get("code") is not None else 0

    # If compilation failed, show compile errors
    if compile_result and compile_result.get("stderr"):
        stderr = compile_result["stderr"] + ("\n" + stderr if stderr else "")
        if compile_result.get("code") and compile_result["code"] != 0:
            exit_code = compile_result["code"]

    # Check for signal (e.g. SIGKILL from timeout)
    if run.get("signal") == "SIGKILL":
        stderr += "\nProcess killed — likely exceeded time or memory limit."
        exit_code = 137

    return ExecuteResponse(
        stdout=stdout.rstrip(),
        stderr=stderr.rstrip(),
        exit_code=exit_code,
        language=req.language,
        timed_out=run.get("signal") == "SIGKILL",
    )


def _ext(language: str) -> str:
    return {"python": "py", "javascript": "js", "java": "java", "cpp": "cpp"}.get(language, "txt")
