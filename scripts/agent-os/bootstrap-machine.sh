#!/bin/sh
# Linux and cloud wrapper for bootstrap-machine.mjs: installs or refreshes the machine-local always-on pieces.
#   sh scripts/agent-os/bootstrap-machine.sh [--check]
exec node "$(dirname "$0")/bootstrap-machine.mjs" "$@"
