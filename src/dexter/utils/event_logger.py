from __future__ import annotations

import json
from contextlib import contextmanager
from typing import Any, Callable, Dict, List, Optional


EventPayload = Dict[str, Any]


class EventLogger:

    def __init__(self, emit: Callable[[EventPayload], None]):
        self.emit = emit
        self.log: List[str] = []

    def _log(self, msg: str):
        self.log.append(msg)
        self.emit({"type": "log", "message": msg})

    def log_header(self, msg: str):
        self.emit({"type": "header", "message": msg})

    def log_user_query(self, query: str):
        self.emit({"type": "user_query", "query": query})

    def log_task_list(self, tasks: List[Dict[str, Any]]):
        normalized = [
            {
                **task,
                "done": bool(task.get("done", False)),
            }
            for task in tasks
        ]
        self.emit({"type": "task_list", "tasks": normalized})

    def log_task_start(self, task_desc: str):
        self.emit({"type": "task_start", "task": task_desc})

    def log_task_done(self, task_desc: str):
        self.emit({"type": "task_done", "task": task_desc})

    def log_tool_run(self, tool: str, result: str = ""):
        payload: EventPayload = {"type": "tool_run", "tool": tool}
        if result:
            parsed: Optional[Any] = None
            try:
                parsed = json.loads(result)
            except Exception:
                parsed = None
            payload["result"] = parsed if parsed is not None else result
        self.emit(payload)

    def log_risky(self, tool: str, input_str: str):
        self.emit(
            {
                "type": "warning",
                "tool": tool,
                "input": input_str,
                "message": f"Risky action {tool}({input_str}) — auto-confirmed",
            }
        )

    def log_summary(self, summary: str):
        self.emit({"type": "answer", "answer": summary})

    @contextmanager
    def progress(self, message: str, success_message: str = ""):
        self.emit({"type": "progress", "status": "start", "message": message})
        try:
            yield
            completed = success_message or message.replace("...", " ✓")
            self.emit({"type": "progress", "status": "complete", "message": completed})
        except Exception as exc:
            self.emit(
                {
                    "type": "progress",
                    "status": "error",
                    "message": f"{message} failed: {exc}",
                }
            )
            raise
