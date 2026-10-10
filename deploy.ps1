#!/usr/bin/env pwsh
# Installs the plugin's runtime files into a folder Claude Code loads plugins
# from (one named in CLAUDE_CODE_PLUGIN_DIRS). Files there are overwritten, never
# deleted, so leftovers stay; they are inert, as hooks.json names its modules.
#
#   ./deploy.ps1 [-Destination <folder>]
param(
    [string]$Destination = (Join-Path $HOME '.claude-global/decision-tracker')
)

$ErrorActionPreference = 'Stop'

$plugin = Join-Path $PSScriptRoot 'plugin'

claude plugin validate $plugin
if ($LASTEXITCODE -ne 0) { throw 'Plugin validation failed; nothing deployed.' }

foreach ($path in '.claude-plugin/plugin.json', 'hooks', 'types') {
    $parent = Split-Path (Join-Path $Destination $path)
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    Copy-Item -Recurse -Force -Path (Join-Path $plugin $path) -Destination $parent
}

Write-Host "Deployed decision-tracker to $Destination"
