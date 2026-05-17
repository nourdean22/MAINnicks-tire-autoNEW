"""
Structured logging system for NOUR OS.
Writes JSON logs to /logs, maintains audit trail, supports real-time feeds.
"""

import json
import os
from datetime import datetime, UTC
from pathlib import Path
from typing import Any, Optional


class StructuredLogger:
    """Structured logging with JSON output and audit trail."""
    
    def __init__(self, logs_dir: str = "./logs"):
        self.logs_dir = Path(logs_dir)
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        
        # Log files
        self.audit_log = self.logs_dir / "audit.jsonl"
        self.events_log = self.logs_dir / "events.jsonl"
        self.errors_log = self.logs_dir / "errors.jsonl"
    
    def _write_log(self, log_file: Path, entry: dict) -> None:
        """Write structured log entry to file."""
        entry["timestamp"] = datetime.now(UTC).isoformat()
        with open(log_file, "a") as f:
            f.write(json.dumps(entry) + "\n")
    
    def audit(self, action: str, actor: str, details: Optional[dict] = None) -> None:
        """Log an audit event (state changes, actions taken)."""
        entry = {
            "type": "audit",
            "action": action,
            "actor": actor,
            "details": details or {}
        }
        self._write_log(self.audit_log, entry)
    
    def event(self, event_type: str, message: str, data: Optional[dict] = None) -> None:
        """Log a system event."""
        entry = {
            "type": "event",
            "event_type": event_type,
            "message": message,
            "data": data or {}
        }
        self._write_log(self.events_log, entry)
    
    def error(self, error_type: str, message: str, traceback: Optional[str] = None) -> None:
        """Log an error."""
        entry = {
            "type": "error",
            "error_type": error_type,
            "message": message,
            "traceback": traceback
        }
        self._write_log(self.errors_log, entry)
    
    def command(self, cmd: str, status: str, output: Optional[str] = None, duration_ms: Optional[int] = None) -> None:
        """Log a command execution."""
        entry = {
            "type": "command",
            "command": cmd,
            "status": status,  # success, failure, timeout, etc.
            "output": output,
            "duration_ms": duration_ms
        }
        self._write_log(self.audit_log, entry)
    
    def read_audit_trail(self, limit: int = 50) -> list[dict]:
        """Read recent audit entries."""
        if not self.audit_log.exists():
            return []
        
        entries = []
        with open(self.audit_log, "r") as f:
            for line in f:
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
        
        return entries[-limit:]
