<#
.SYNOPSIS
  Builds the Windows app and wraps it in an installer (Point-of-Sales-Setup-<versi>.exe).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File windows\installer\build.ps1

  Needs Flutter (C:\flutter or on PATH) and NSIS's makensis: on PATH, in Program Files,
  in $env:MAKENSIS, or the copy electron-builder caches for the old desktop app.
#>
param([switch]$SkipFlutterBuild)

$ErrorActionPreference = 'Stop'
$app = Resolve-Path (Join-Path $PSScriptRoot '..\..')

$version = (Select-String -Path (Join-Path $app 'pubspec.yaml') -Pattern '^version:\s*([0-9]+\.[0-9]+\.[0-9]+)').Matches[0].Groups[1].Value

$flutter = (Get-Command flutter -ErrorAction SilentlyContinue).Source
if (-not $flutter) { $flutter = 'C:\flutter\bin\flutter.bat' }

$makensis = @(
  $env:MAKENSIS,
  (Get-Command makensis -ErrorAction SilentlyContinue).Source,
  "${env:ProgramFiles(x86)}\NSIS\makensis.exe",
  "$env:ProgramFiles\NSIS\makensis.exe"
) + @(Get-ChildItem "$env:LOCALAPPDATA\electron-builder\Cache\nsis\*\makensis.exe" -ErrorAction SilentlyContinue | ForEach-Object FullName) |
  Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $makensis) { throw 'makensis tidak ditemukan. Pasang NSIS (https://nsis.sourceforge.io) atau isi $env:MAKENSIS.' }

Push-Location $app
try {
  if (-not $SkipFlutterBuild) {
    & $flutter build windows --release
    if ($LASTEXITCODE -ne 0) { throw 'flutter build windows gagal.' }
  }

  $source = Join-Path $app 'build\windows\x64\runner\Release'
  $outDir = Join-Path $app 'build\installer'
  New-Item -ItemType Directory -Force $outDir | Out-Null
  $out = Join-Path $outDir "Point-of-Sales-Setup-$version.exe"

  & $makensis /V2 "/DVERSION=$version" "/DSOURCE_DIR=$source" "/DOUT_FILE=$out" (Join-Path $PSScriptRoot 'point_of_sales.nsi')
  if ($LASTEXITCODE -ne 0) { throw 'makensis gagal.' }

  Write-Host "Installer: $out"
} finally {
  Pop-Location
}
