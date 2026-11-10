$ErrorActionPreference = 'Stop'
$editorRoot = Split-Path -Parent $PSScriptRoot
$editorCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $editorCompiler)) { throw 'Falta el compilador de .NET Framework 4.' }
& $editorCompiler /nologo /target:winexe /reference:System.Windows.Forms.dll ('/out:' + (Join-Path $editorRoot 'Leo Video.exe')) (Join-Path $editorRoot 'launcher\LeoVideo.cs')
if ($LASTEXITCODE -ne 0) { throw 'No se pudo compilar el lanzador.' }
Write-Output 'Leo Video.exe generado. Mantenerlo junto a abrir.ps1 y el resto de la aplicación.'
