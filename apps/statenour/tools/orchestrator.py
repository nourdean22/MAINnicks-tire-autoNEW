#!/usr/bin/env python3
"""
NOUR OS Orchestrator - Core execution engine.
Manages task execution, state, logging, and system coordination.
"""

import json
import subprocess
import sys
import time
from datetime import datetime, UTC
from pathlib import Path
from typing import Any, Optional
import yaml

# Add lib to path
sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))
from logger import StructuredLogger


class Orchestrator:
    """Core orchestrator for NOUR OS task execution."""
    
    def __init__(self, config_path: str = "./config/orchestrator.yaml"):
        self.config_path = Path(config_path)
        self.config = self._load_config()
        self.root_dir = Path(self.config["paths"]["root"])
        self.logs_dir = self.root_dir / self.config["paths"]["logs"]
        
        # Initialize logger
        self.logger = StructuredLogger(str(self.logs_dir))
        
        # State file
        self.state_file = self.logs_dir / "state.json"
        self.state = self._load_state()
        
        self.logger.event("orchestrator_init", "Orchestrator initialized")
    
    def _load_config(self) -> dict:
        """Load YAML configuration."""
        if not self.config_path.exists():
            raise FileNotFoundError(f"Config not found: {self.config_path}")
        
        with open(self.config_path) as f:
            return yaml.safe_load(f)
    
    def _load_state(self) -> dict:
        """Load or initialize orchestrator state."""
        if self.state_file.exists():
            with open(self.state_file) as f:
                return json.load(f)
        
        return {
            "initialized_at": datetime.now(UTC).isoformat(),
            "tasks_executed": 0,
            "tasks_failed": 0,
            "last_execution": None
        }
    
    def _save_state(self) -> None:
        """Persist state to disk."""
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.state_file, "w") as f:
            json.dump(self.state, f, indent=2)
        self.logger.audit("state_saved", "orchestrator", {"file": str(self.state_file)})
    
    def execute_command(
        self,
        command: str,
        description: Optional[str] = None,
        dry_run: bool = False,
        timeout: Optional[int] = None
    ) -> dict:
        """Execute a shell command with logging."""
        
        if timeout is None:
            timeout = self.config["orchestrator"]["task_timeout_seconds"]
        
        result = {
            "command": command,
            "description": description,
            "dry_run": dry_run,
            "status": "pending",
            "output": None,
            "error": None,
            "duration_ms": 0,
            "executed_at": datetime.now(UTC).isoformat()
        }
        
        self.logger.event("command_queued", f"Command: {command}", {"description": description})
        
        if dry_run:
            result["status"] = "dry_run"
            self.logger.audit("command_dry_run", "orchestrator", result)
            return result
        
        try:
            start = time.time()
            process = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=timeout
            )
            duration_ms = int((time.time() - start) * 1000)
            
            result["status"] = "success" if process.returncode == 0 else "failure"
            result["output"] = process.stdout
            result["error"] = process.stderr if process.stderr else None
            result["duration_ms"] = duration_ms
            
            self.logger.command(command, result["status"], result["output"], duration_ms)
            
            if result["status"] == "success":
                self.state["tasks_executed"] += 1
            else:
                self.state["tasks_failed"] += 1
            
            self.state["last_execution"] = datetime.now(UTC).isoformat()
            self._save_state()
        
        except subprocess.TimeoutExpired:
            result["status"] = "timeout"
            result["error"] = f"Command timed out after {timeout}s"
            self.logger.error("timeout", result["error"])
            self.state["tasks_failed"] += 1
            self._save_state()
        
        except Exception as e:
            result["status"] = "error"
            result["error"] = str(e)
            self.logger.error("execution_error", str(e))
            self.state["tasks_failed"] += 1
            self._save_state()
        
        return result
    
    def get_status(self) -> dict:
        """Get orchestrator status and statistics."""
        return {
            "config": {
                "name": self.config["system"]["name"],
                "version": self.config["system"]["version"],
                "environment": self.config["system"]["environment"]
            },
            "state": self.state,
            "paths": {k: str(self.root_dir / v) for k, v in self.config["paths"].items()},
            "status": "healthy"
        }
    
    def get_audit_trail(self, limit: int = 20) -> list[dict]:
        """Get recent audit entries."""
        return self.logger.read_audit_trail(limit)


def main():
    """CLI entry point."""
    if len(sys.argv) < 2:
        print("Usage: orchestrator.py <command> [args...]")
        print("Commands:")
        print("  status          Show orchestrator status")
        print("  exec <cmd>      Execute a command")
        print("  exec-dry <cmd>  Dry run a command")
        print("  audit           Show audit trail")
        sys.exit(1)
    
    orch = Orchestrator()
    command = sys.argv[1]
    
    if command == "status":
        print(json.dumps(orch.get_status(), indent=2))
    
    elif command == "exec":
        if len(sys.argv) < 3:
            print("Usage: orchestrator.py exec <command>")
            sys.exit(1)
        cmd = " ".join(sys.argv[2:])
        result = orch.execute_command(cmd)
        print(json.dumps(result, indent=2))
    
    elif command == "exec-dry":
        if len(sys.argv) < 3:
            print("Usage: orchestrator.py exec-dry <command>")
            sys.exit(1)
        cmd = " ".join(sys.argv[2:])
        result = orch.execute_command(cmd, dry_run=True)
        print(json.dumps(result, indent=2))
    
    elif command == "audit":
        trail = orch.get_audit_trail(20)
        print(json.dumps(trail, indent=2))
    
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)


if __name__ == "__main__":
    main()
