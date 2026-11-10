$ErrorActionPreference = 'Stop'
$editorRoot = Split-Path -Parent $PSScriptRoot
$editorCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$buildFolder = Join-Path $editorRoot '.build'
New-Item -ItemType Directory -Path $buildFolder -Force | Out-Null
$payload = Join-Path $buildFolder ('app-' + [Guid]::NewGuid().ToString('N') + '.zip')
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($payload,[System.IO.Compression.ZipArchiveMode]::Create)
try {
    $names = @('server.js','package.json','abrir.ps1','Abrir editor.cmd','Leo Video.exe','README.md','PROYECTO.md','VALIDACION.md','core\project.js','core\media.js','core\captions.js','core\compositor.js','scripts\matte.py','ui\index.html','ui\style.css','ui\creative.css','ui\app.js','ui\creative.js')
    foreach($name in $names) {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,(Join-Path $editorRoot $name),$name.Replace('\','/'),[System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $zip.Dispose() }
$installer = Join-Path $editorRoot 'Instalar Leo Video.exe'
& $editorCompiler /nologo /target:winexe /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:Microsoft.CSharp.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll ('/resource:' + $payload + ',app.zip') ('/out:' + $installer) (Join-Path $editorRoot 'launcher\Installer.cs')
if ($LASTEXITCODE -ne 0) { throw 'No se pudo compilar el instalador.' }
Write-Output 'Instalar Leo Video.exe generado. No incluye los motores externos ni modelos.'
