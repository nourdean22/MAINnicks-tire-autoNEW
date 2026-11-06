param([string]$ShortcutDirectory = [Environment]::GetFolderPath('Desktop'))

$ErrorActionPreference = 'Stop'

$scriptCheckout = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$worktreeRows = @(& git -C $scriptCheckout worktree list --porcelain 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $worktreeRows.Count) {
  throw 'Cannot find the monorepo worktrees for these shortcuts.'
}
$candidate = $null
$repoRoot = $null
foreach ($row in $worktreeRows) {
  if ($row -match '^worktree (.+)$') { $candidate = $Matches[1]; continue }
  if ($row -eq 'branch refs/heads/main' -and $candidate) {
    $repoRoot = (Resolve-Path -LiteralPath $candidate).Path
    break
  }
}
if (-not $repoRoot) {
  throw 'Create or sync a dedicated main checkout before installing durable coding shortcuts.'
}
$launcher = Join-Path $repoRoot 'tools\sovereign-dev\start-ai-playground-coding.cmd'
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
  throw 'The main checkout does not have the AI Playground coding launcher yet.'
}

$appCandidates = @(
  (Join-Path $env:ProgramFiles 'AI Playground\AI Playground.exe'),
  (Join-Path $env:LOCALAPPDATA 'Programs\AI Playground\AI Playground.exe')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }
$app = $appCandidates | Select-Object -First 1
if (-not $app) { throw 'AI Playground is not installed in a supported location.' }

if (-not (Test-Path -LiteralPath $ShortcutDirectory -PathType Container)) {
  throw 'The shortcut destination folder does not exist.'
}
$desktop = (Resolve-Path -LiteralPath $ShortcutDirectory).Path
$shell = New-Object -ComObject WScript.Shell

function Save-Shortcut([string]$name, [string]$target, [string]$arguments, [string]$workingDirectory, [string]$icon) {
  $shortcutPath = Join-Path $desktop ($name + '.lnk')
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $target
  $shortcut.Arguments = $arguments
  $shortcut.WorkingDirectory = $workingDirectory
  $shortcut.IconLocation = $icon
  $shortcut.Description = $name
  $shortcut.Save()
  return $shortcutPath
}

$cmd = Join-Path $env:SystemRoot 'System32\cmd.exe'
$codingArgs = '/k ""' + $launcher + '""'
$desktopArgs = '/k ""' + $launcher + '" --mcp desktop-commander"'
$browserArgs = '/k ""' + $launcher + '" --mcp browser"'

$created = @(
  (Save-Shortcut 'AI Playground Companion' $app '' (Split-Path -Parent $app) $app),
  (Save-Shortcut 'AI Playground Coding Companion' $cmd $codingArgs $repoRoot $cmd),
  (Save-Shortcut 'AI Playground Coding + Desktop Tools' $cmd $desktopArgs $repoRoot $cmd),
  (Save-Shortcut 'AI Playground Coding + Browser' $cmd $browserArgs $repoRoot $cmd)
)
$created | ForEach-Object { Write-Output $_ }
