from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, Optional
from uuid import uuid4

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from dexter.agent import Agent
from dexter.utils.event_logger import EventLogger

logger = logging.getLogger(__name__)


class RunRequest(BaseModel):
    query: str
    max_steps: Optional[int] = None
    max_steps_per_task: Optional[int] = None


class RunResponse(BaseModel):
    run_id: str


class AgentSession:

    def __init__(self, loop: asyncio.AbstractEventLoop):
        self.loop = loop
        self.queue: asyncio.Queue[Dict[str, Any]] = asyncio.Queue()
        self.finished = asyncio.Event()
        self.error: Optional[str] = None

    def emit(self, payload: Dict[str, Any]) -> None:
        asyncio.run_coroutine_threadsafe(self.queue.put(payload), self.loop)

    async def stream(self):
        try:
            while True:
                payload = await self.queue.get()
                yield {
                    "data": json.dumps(payload, ensure_ascii=False),
                }
                if payload.get("type") in {"done", "error"}:
                    break
        finally:
            self.finished.set()


class DexterServer:
    def __init__(self):
        self.app = FastAPI(title="Dexter Server", version="0.1.0")
        self.sessions: Dict[str, AgentSession] = {}
        self._configure()

    def _configure(self) -> None:
        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

        @self.app.get("/health")
        async def health():
            return {"status": "ok"}

        @self.app.post("/api/run", response_model=RunResponse)
        async def run_agent(request: RunRequest, background_tasks: BackgroundTasks):
            loop = asyncio.get_running_loop()
            run_id = str(uuid4())
            session = AgentSession(loop)
            self.sessions[run_id] = session

            def emit(payload: Dict[str, Any]) -> None:
                session.emit(payload)

            def worker() -> None:
                logger.info("Starting Dexter run %s", run_id)
                try:
                    agent = Agent(
                        max_steps=request.max_steps or 20,
                        max_steps_per_task=request.max_steps_per_task or 5,
                        logger=EventLogger(emit),
                    )
                    answer = agent.run(request.query)
                    emit({"type": "done", "answer": answer})
                except Exception as exc:  # pragma: no cover - defensive logging
                    logger.exception("Dexter run %s failed", run_id)
                    emit({"type": "error", "message": str(exc)})
                finally:
                    session.finished.set()

            background_tasks.add_task(loop.run_in_executor, None, worker)
            return RunResponse(run_id=run_id)

        @self.app.get("/api/run/{run_id}/events")
        async def stream_events(run_id: str):
            session = self.sessions.get(run_id)
            if session is None:
                raise HTTPException(status_code=404, detail="Run not found")

            async def event_generator():
                async for event in session.stream():
                    yield event
                self.sessions.pop(run_id, None)

            return EventSourceResponse(event_generator())

    def get_app(self) -> FastAPI:
        return self.app


server = DexterServer()
app = server.get_app()


__all__ = ["app", "server"]
