<#
.SYNOPSIS
  Builds posnet - the piece that lets phones reach the shop PC from outside the shop over
  Tailscale - and puts it where the app builds pick it up.

.DESCRIPTION
  dist\posnet.exe          copied next to the Windows app by its CMake install step
  mobile\android\app\src\main\jniLibs\<abi>\libposnet.so
                           packed into the APK; Android installs it as an executable

  Run it before `flutter build windows` / `flutter build apk`. windows\installer\build.ps1
  runs it by itself. Needs Go (winget install GoLang.Go).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File server\tailnet\build.ps1
#>
$ErrorActionPreference = 'Stop'

$go = (Get-Command go -ErrorAction SilentlyContinue).Source
if (-not $go) { $go = "$env:ProgramFiles\Go\bin\go.exe" }
if (-not (Test-Path $go)) { throw 'Go tidak ditemukan. Pasang dengan: winget install GoLang.Go' }

$jniLibs = Resolve-Path (Join-Path $PSScriptRoot '..\..\mobile\android\app\src\main') | ForEach-Object { Join-Path $_ 'jniLibs' }

# GOOS=linux, not android: a static binary needs no NDK, and androidbin makes it work on
# Android (see android_linux.go)
$targets = @(
  @{ GOOS = 'windows'; GOARCH = 'amd64'; GOARM = '';  Out = (Join-Path $PSScriptRoot 'dist\posnet.exe') },
  @{ GOOS = 'linux';   GOARCH = 'arm64'; GOARM = '';  Out = (Join-Path $jniLibs 'arm64-v8a\libposnet.so') },
  @{ GOOS = 'linux';   GOARCH = 'arm';   GOARM = '7'; Out = (Join-Path $jniLibs 'armeabi-v7a\libposnet.so') },
  @{ GOOS = 'linux';   GOARCH = 'amd64'; GOARM = '';  Out = (Join-Path $jniLibs 'x86_64\libposnet.so') }
)

Push-Location $PSScriptRoot
$saved = @{ GOOS = $env:GOOS; GOARCH = $env:GOARCH; GOARM = $env:GOARM; CGO_ENABLED = $env:CGO_ENABLED }
try {
  foreach ($t in $targets) {
    $env:GOOS = $t.GOOS; $env:GOARCH = $t.GOARCH; $env:GOARM = $t.GOARM; $env:CGO_ENABLED = '0'
    New-Item -ItemType Directory -Force (Split-Path $t.Out) | Out-Null
    & $go build -trimpath -ldflags='-s -w' -o $t.Out .
    if ($LASTEXITCODE -ne 0) { throw "go build $($t.GOOS)/$($t.GOARCH) gagal." }
    Write-Host "posnet: $($t.Out)"
  }
} finally {
  foreach ($k in $saved.Keys) { Set-Item "env:$k" $saved[$k] }
  Pop-Location
}
