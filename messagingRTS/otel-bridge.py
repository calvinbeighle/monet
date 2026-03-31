#!/usr/bin/env python3
"""
Bridge: Claude Code stream-json -> OpenTelemetry spans -> Jaeger

Tails the loop's stream-json output and converts events into OTEL traces.
Each loop iteration becomes a root trace. Subagents, tool calls, and file
operations become child spans.

Usage:
    ./otel-bridge.py <stream-json-file>
    ./otel-bridge.py --tail <stream-json-file>   # follow mode (like tail -f)
"""

import json
import sys
import time
import os
from pathlib import Path

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.trace import StatusCode

COLLECTOR_ENDPOINT = os.environ.get(
    "OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:60012/v1/traces"
)

resource = Resource.create(
    {
        "service.name": "ralph-loop",
        "service.version": "1.0.0",
        "deployment.environment": "dev",
    }
)

provider = TracerProvider(resource=resource)
exporter = OTLPSpanExporter(endpoint=COLLECTOR_ENDPOINT)
provider.add_span_processor(BatchSpanProcessor(exporter, max_export_batch_size=64))
trace.set_tracer_provider(provider)

tracer = trace.get_tracer("ralph-loop", "1.0.0")


class LoopTracer:
    def __init__(self):
        self.iteration_span = None
        self.iteration_ctx = None
        self.iteration_token = None
        self.agent_spans = {}  # task_id -> (span, ctx, token)
        self.tool_spans = {}  # tool_use_id -> (span, ctx, token)
        self.total_input_tokens = 0
        self.total_output_tokens = 0
        self.tool_call_count = 0
        self.event_count = 0
        self.iteration_num = 0

    def start_iteration(self):
        self.iteration_num += 1
        self.total_input_tokens = 0
        self.total_output_tokens = 0
        self.tool_call_count = 0
        self.event_count = 0

        self.iteration_span = tracer.start_span(
            f"ralph-loop iteration {self.iteration_num}",
            attributes={
                "ralph.iteration": self.iteration_num,
                "ralph.mode": "build",
            },
        )
        self.iteration_ctx = trace.set_span_in_context(self.iteration_span)
        print(f"[otel-bridge] Started trace for iteration {self.iteration_num}")

    def end_iteration(self):
        if self.iteration_span:
            self.iteration_span.set_attribute(
                "ralph.total_input_tokens", self.total_input_tokens
            )
            self.iteration_span.set_attribute(
                "ralph.total_output_tokens", self.total_output_tokens
            )
            self.iteration_span.set_attribute(
                "ralph.total_tokens", self.total_input_tokens + self.total_output_tokens
            )
            self.iteration_span.set_attribute("ralph.tool_calls", self.tool_call_count)
            self.iteration_span.set_attribute(
                "ralph.events_processed", self.event_count
            )
            self.iteration_span.set_attribute(
                "ralph.subagents_spawned", len(self.agent_spans)
            )
            self.iteration_span.set_status(StatusCode.OK)
            self.iteration_span.end()
            print(
                f"[otel-bridge] Ended iteration {self.iteration_num}: "
                f"{self.total_input_tokens + self.total_output_tokens} tokens, "
                f"{self.tool_call_count} tool calls, "
                f"{len(self.agent_spans)} subagents"
            )
            self.agent_spans = {}
            self.tool_spans = {}

    def process_event(self, event):
        self.event_count += 1
        event_type = event.get("type")
        subtype = event.get("subtype")

        if not self.iteration_span:
            self.start_iteration()

        # Track tokens from assistant messages
        if event_type == "assistant":
            msg = event.get("message", {})
            usage = msg.get("usage", {})
            self.total_input_tokens += usage.get("input_tokens", 0)
            self.total_output_tokens += usage.get("output_tokens", 0)

            # Track tool calls
            parent_task = event.get("parent_tool_use_id")
            parent_ctx = self.iteration_ctx
            if parent_task:
                for tid, (s, ctx, tok) in self.agent_spans.items():
                    if not s.is_recording():
                        continue
                    parent_ctx = ctx
                    break

            for content in msg.get("content", []):
                if content.get("type") == "tool_use":
                    tool_name = content.get("name", "unknown")
                    tool_id = content.get("id", "")
                    self.tool_call_count += 1

                    span = tracer.start_span(
                        f"tool: {tool_name}",
                        context=parent_ctx,
                        attributes={
                            "tool.name": tool_name,
                            "tool.id": tool_id,
                            "ralph.parent_task": parent_task or "main",
                        },
                    )
                    ctx = trace.set_span_in_context(span)
                    self.tool_spans[tool_id] = (span, ctx, None)

                    # Extract useful attributes from tool input
                    tool_input = content.get("input", {})
                    if tool_name in ("Read", "Write", "Edit"):
                        fp = tool_input.get("file_path", "")
                        if fp:
                            span.set_attribute("file.path", fp)
                    elif tool_name == "Bash":
                        cmd = tool_input.get("command", "")
                        if cmd:
                            span.set_attribute("bash.command", cmd[:200])
                    elif tool_name == "Agent":
                        desc = tool_input.get("description", "")
                        span.set_attribute("agent.description", desc)
                        agent_type = tool_input.get("subagent_type", "general")
                        span.set_attribute("agent.type", agent_type)
                    elif tool_name in ("Grep", "Glob"):
                        pattern = tool_input.get("pattern", "")
                        span.set_attribute("search.pattern", pattern)

        # Subagent lifecycle
        elif event_type == "system":
            if subtype == "task_started":
                task_id = event.get("task_id", "")
                desc = event.get("description", "subagent")
                span = tracer.start_span(
                    f"subagent: {desc[:60]}",
                    context=self.iteration_ctx,
                    attributes={
                        "ralph.task_id": task_id,
                        "ralph.task_description": desc,
                    },
                )
                ctx = trace.set_span_in_context(span)
                self.agent_spans[task_id] = (span, ctx, None)

            elif subtype == "task_progress":
                task_id = event.get("task_id", "")
                if task_id in self.agent_spans:
                    span, ctx, tok = self.agent_spans[task_id]
                    usage = event.get("usage", {})
                    desc = event.get("description", "")
                    tool_name = event.get("last_tool_name", "")
                    if desc:
                        span.add_event(
                            "progress",
                            {
                                "description": desc[:200],
                                "tool": tool_name,
                                "total_tokens": usage.get("total_tokens", 0),
                                "tool_uses": usage.get("tool_uses", 0),
                                "duration_ms": usage.get("duration_ms", 0),
                            },
                        )

            elif subtype == "task_notification":
                task_id = event.get("task_id", "")
                if task_id in self.agent_spans:
                    span, ctx, tok = self.agent_spans[task_id]
                    status = event.get("status", "unknown")
                    span.set_attribute("ralph.task_status", status)
                    if status == "completed":
                        span.set_status(StatusCode.OK)
                    else:
                        span.set_status(StatusCode.ERROR, status)
                    span.end()

            elif subtype == "compact_boundary":
                if self.iteration_span:
                    self.iteration_span.add_event("context_compacted")

        # Tool results - end tool spans
        elif event_type == "result":
            # End any open tool spans
            for tool_id, (span, ctx, tok) in list(self.tool_spans.items()):
                if span.is_recording():
                    span.set_status(StatusCode.OK)
                    span.end()

        # User messages (tool results flow back as user messages)
        elif event_type == "user":
            pass


def tail_file(filepath, follow=False):
    """Read lines from file, optionally following new writes."""
    with open(filepath, "r") as f:
        while True:
            line = f.readline()
            if line:
                yield line
            elif follow:
                time.sleep(0.5)
            else:
                break


def main():
    args = sys.argv[1:]
    follow = False

    if "--tail" in args:
        follow = True
        args.remove("--tail")

    if not args:
        print("Usage: otel-bridge.py [--tail] <stream-json-file>")
        sys.exit(1)

    filepath = args[0]
    if not Path(filepath).exists():
        print(f"File not found: {filepath}")
        sys.exit(1)

    print(f"[otel-bridge] Reading from: {filepath}")
    print(f"[otel-bridge] Exporting to: {COLLECTOR_ENDPOINT}")
    print(f"[otel-bridge] Follow mode: {follow}")
    print(f"[otel-bridge] Jaeger UI: http://localhost:59982/jaeger/ui")
    print()

    lt = LoopTracer()

    try:
        for line in tail_file(filepath, follow=follow):
            line = line.strip()
            if not line:
                continue

            # Detect loop iteration boundary from the shell script output
            if "LOOP" in line and "====" in line:
                lt.end_iteration()
                lt.start_iteration()
                continue

            try:
                event = json.loads(line)
                lt.process_event(event)
            except json.JSONDecodeError:
                continue

    except KeyboardInterrupt:
        print("\n[otel-bridge] Shutting down...")
    finally:
        lt.end_iteration()
        provider.force_flush()
        provider.shutdown()
        print("[otel-bridge] Flushed and shut down.")


if __name__ == "__main__":
    main()
