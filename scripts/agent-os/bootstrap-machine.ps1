# Windows wrapper for bootstrap-machine.mjs: installs or refreshes the machine-local always-on pieces from this repo.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\agent-os\bootstrap-machine.ps1 [--check]
node "$PSScriptRoot\bootstrap-machine.mjs" @args
exit $LASTEXITCODE
