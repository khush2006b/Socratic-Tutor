"""
routers/execute.py
Code execution endpoint — runs code locally in a sandboxed subprocess.

Uses subprocess.run in a thread pool (Windows-compatible).
Supports: Python, JavaScript, C++, Java
"""

import asyncio
import logging
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import traceback

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["execute"])

EXEC_TIMEOUT = 10
MAX_OUTPUT = 50_000
IS_WIN = platform.system() == "Windows"

LANGUAGE_CONFIG = {
    "python": {
        "command": [sys.executable, "-u"],
        "ext": ".py",
    },
    "javascript": {
        "command": ["node"],
        "ext": ".js",
    },
    "cpp": {
        "compile": ["g++", "-o"],
        "ext": ".cpp",
    },
    "java": {
        "compile": ["javac"],
        "run": ["java", "-cp"],
        "ext": ".java",
        "filename": "Main.java",
    },
}


def _safe_env(temp_dir: str) -> dict:
    """Build a restricted environment for subprocess execution."""
    env = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": temp_dir,
        "TEMP": temp_dir,
        "TMP": temp_dir,
        "LANG": "en_US.UTF-8",
    }
    if IS_WIN:
        env["SystemRoot"] = os.environ.get("SystemRoot", r"C:\Windows")
        env["SystemDrive"] = os.environ.get("SystemDrive", "C:")
        env["PATHEXT"] = os.environ.get("PATHEXT", ".COM;.EXE;.BAT;.CMD")
    return env


def _run_sync(cmd: list, cwd: str, env: dict, stdin_data: str = "") -> tuple:
    """
    Run a command synchronously with timeout.
    Returns (stdout, stderr, exit_code, timed_out).
    """
    try:
        result = subprocess.run(
            cmd,
            input=stdin_data,
            capture_output=True,
            text=True,
            timeout=EXEC_TIMEOUT,
            cwd=cwd,
            env=env,
        )
        return (
            result.stdout[:MAX_OUTPUT],
            result.stderr[:MAX_OUTPUT],
            result.returncode,
            False,
        )
    except subprocess.TimeoutExpired:
        return ("", f"Execution timed out ({EXEC_TIMEOUT}s limit).", 124, True)
    except FileNotFoundError as exc:
        return ("", f"Command not found: {cmd[0]}. Is it installed and in PATH?", 127, False)


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
    """Execute code in a local sandboxed subprocess."""
    lang_config = LANGUAGE_CONFIG.get(req.language)
    if not lang_config:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported language: {req.language}. Supported: {list(LANGUAGE_CONFIG.keys())}",
        )

    if not req.code.strip():
        return ExecuteResponse(
            stdout="", stderr="No code to execute.", exit_code=1,
            language=req.language,
        )

    temp_dir = tempfile.mkdtemp()

    try:
        # Write code to temp file
        filename = lang_config.get("filename", f"code{lang_config['ext']}")
        temp_path = os.path.join(temp_dir, filename)
        with open(temp_path, "w", encoding="utf-8") as f:
            f.write(req.code)

        env = _safe_env(temp_dir)

        # ── Compiled languages: compile first ─────────────────────
        if "compile" in lang_config:
            if req.language == "cpp":
                out_bin = os.path.join(temp_dir, "a.exe" if IS_WIN else "a.out")
                compile_cmd = lang_config["compile"] + [out_bin, temp_path]
                run_cmd = [out_bin]
            elif req.language == "java":
                compile_cmd = lang_config["compile"] + [temp_path]
                run_cmd = lang_config["run"] + [temp_dir, "Main"]
            else:
                raise HTTPException(status_code=400, detail=f"No handler for {req.language}")

            # Compile (in thread pool — Windows compatible)
            c_out, c_err, c_code, c_timeout = await asyncio.to_thread(
                _run_sync, compile_cmd, temp_dir, env,
            )
            if c_timeout or c_code != 0:
                return ExecuteResponse(
                    stdout=c_out.rstrip(), stderr=c_err.rstrip(),
                    exit_code=c_code, language=req.language, timed_out=c_timeout,
                )
            cmd = run_cmd
        else:
            # ── Interpreted languages ─────────────────────────────
            cmd = lang_config["command"] + [temp_path]

        # Run (in thread pool — Windows compatible)
        stdout, stderr, exit_code, timed_out = await asyncio.to_thread(
            _run_sync, cmd, temp_dir, env, req.stdin,
        )

        return ExecuteResponse(
            stdout=stdout.rstrip(),
            stderr=stderr.rstrip(),
            exit_code=exit_code,
            language=req.language,
            timed_out=timed_out,
        )

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Execution failed: %s\n%s", exc, traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Execution failed: {type(exc).__name__}: {exc}")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
