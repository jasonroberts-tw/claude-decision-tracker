#!/usr/bin/env pwsh
# Rebuilds the release branch, which Anthropic's plugin directory tracks, from
# plugin/ as committed at HEAD. The branch holds the plugin at its root,
# without what only development uses, so the directory scans only what people
# install, and a plugin at the root draws none of the holds a subfolder does.
#
#   ./release.ps1            # validate, test, commit to release and push it
#   ./release.ps1 -DryRun    # say what it would release, and change nothing
#
# .github/workflows/release.yml runs it on GitHub: by hand to release, and as a
# dry run on every push that touches the plugin.
param(
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$devOnly = 'tests', 'tsconfig.json'

function Invoke-Git {
    $output = git -C $PSScriptRoot @args
    if ($LASTEXITCODE -ne 0) { throw "git $args failed." }
    $output
}

if (Invoke-Git status --porcelain -- plugin) {
    throw 'plugin/ has uncommitted changes. Commit them first: the release is built from HEAD.'
}

$plugin = Join-Path $PSScriptRoot 'plugin'

claude plugin validate $plugin
if ($LASTEXITCODE -ne 0) { throw 'Plugin validation failed; nothing released.' }

claude plugin test $plugin
if ($LASTEXITCODE -ne 0) { throw 'Plugin tests failed; nothing released.' }

$entries = Invoke-Git ls-tree HEAD:plugin | Where-Object { ($_ -split "`t", 2)[1] -notin $devOnly }
$tree = $entries | git -C $PSScriptRoot mktree
if ($LASTEXITCODE -ne 0) { throw 'git mktree failed.' }

$version = ((Invoke-Git show HEAD:plugin/.claude-plugin/plugin.json) -join "`n" | ConvertFrom-Json).version

# A release builds on origin's release branch, when there is one. A failed
# fetch leaves no parent, and the push below then refuses rather than overwrite.
git -C $PSScriptRoot fetch --quiet origin release 2>$null
$parent = git -C $PSScriptRoot rev-parse --verify --quiet 'refs/remotes/origin/release^{commit}'

if ($parent) {
    if ((Invoke-Git rev-parse "$parent^{tree}") -eq $tree) {
        Write-Host 'origin/release already holds plugin/ as at HEAD; nothing to release.'
        return
    }

    $released = ((Invoke-Git show "${parent}:.claude-plugin/plugin.json") -join "`n" | ConvertFrom-Json).version
    if ($released -eq $version) {
        $problem = "origin/release is already version $version. Raise version in plugin/.claude-plugin/plugin.json and commit it first."
        if (-not $DryRun) { throw $problem }

        # A dry run only warns, so a push that isn't a release yet doesn't fail.
        if ($env:GITHUB_ACTIONS -eq 'true') { Write-Host "::warning::$problem" } else { Write-Warning $problem }
        return
    }
}

$source = Invoke-Git rev-parse --short HEAD
$message = "Release $version from $source"

if ($DryRun) {
    $names = ($entries | ForEach-Object { ($_ -split "`t", 2)[1] }) -join ', '
    Write-Host "Would push `"$message`" to origin/release, holding: $names"
    return
}

$commit = if ($parent) {
    Invoke-Git commit-tree $tree -p $parent -m $message
} else {
    Invoke-Git commit-tree $tree -m $message
}
Invoke-Git push --quiet origin "${commit}:refs/heads/release"

Write-Host "Pushed `"$message`" to origin/release."
