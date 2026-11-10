$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$sessionPath = Join-Path $PSScriptRoot '.cache\session.json'
$active = $false
$expectedVersion = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'package.json') -Raw | ConvertFrom-Json).version
if (Test-Path -LiteralPath $sessionPath) {
    try {
        $editorSession = Get-Content -LiteralPath $sessionPath -Raw | ConvertFrom-Json
        $editorUri = [Uri]$editorSession.url
        $editorToken = $editorUri.Fragment.TrimStart('#')
        $health = Invoke-RestMethod -Uri ($editorUri.GetLeftPart([UriPartial]::Authority) + '/api/health') -Headers @{ Authorization = "Bearer $editorToken" } -TimeoutSec 2
        if ($health.ok -and $health.version -eq $expectedVersion) {
            $candidates = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe")
            $editorBrowser = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
            if ($editorBrowser) {
                Start-Process -FilePath $editorBrowser -ArgumentList @("--app=$($editorSession.url)", ('--user-data-dir="' + (Join-Path $PSScriptRoot '.cache\browser') + '"'))
                $active = $true
            }
        }
    } catch { $active = $false }
}
if (-not $active) {
    $nodeExe = (Get-Command node.exe).Source
    $logFolder = Join-Path $PSScriptRoot '.cache'
    New-Item -ItemType Directory -Path $logFolder -Force | Out-Null
    $bootId = [Guid]::NewGuid().ToString('N')
    Start-Process -FilePath $nodeExe -ArgumentList @('"server.js"', '--desktop') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logFolder ('startup-' + $bootId + '.out.log')) -RedirectStandardError (Join-Path $logFolder ('startup-' + $bootId + '.err.log'))
}
