# fetch-binaries.ps1
# Downloads the latest yt-dlp.exe and ffmpeg.exe into src-tauri/binaries/
# Run once to bootstrap the dev environment: .\scripts\fetch-binaries.ps1

$ErrorActionPreference = "Stop"
$BinDir = Join-Path $PSScriptRoot "..\src-tauri\binaries"
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

# ── yt-dlp ────────────────────────────────────────────────────────────────────
$YtdlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
$YtdlpDst = Join-Path $BinDir "yt-dlp.exe"

Write-Host "Downloading yt-dlp..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $YtdlpUrl -OutFile $YtdlpDst -UseBasicParsing
$ytdlpVersion = & $YtdlpDst --version 2>&1
Write-Host "yt-dlp $ytdlpVersion installed at $YtdlpDst" -ForegroundColor Green

# ── FFmpeg ────────────────────────────────────────────────────────────────────
# Uses the gyan.dev essentials build (small static binary, Windows x64).
$FfmpegZipUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
$FfmpegZip    = Join-Path $env:TEMP "ffmpeg-essentials.zip"
$FfmpegExtDir = Join-Path $env:TEMP "ffmpeg-extract"
$FfmpegDst    = Join-Path $BinDir "ffmpeg.exe"

Write-Host "Downloading FFmpeg (essentials build)..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $FfmpegZipUrl -OutFile $FfmpegZip -UseBasicParsing

Write-Host "Extracting FFmpeg..."
if (Test-Path $FfmpegExtDir) { Remove-Item $FfmpegExtDir -Recurse -Force }
Expand-Archive -Path $FfmpegZip -DestinationPath $FfmpegExtDir

# The zip contains a single versioned folder; find ffmpeg.exe inside bin/.
$FfmpegExe = Get-ChildItem -Path $FfmpegExtDir -Filter "ffmpeg.exe" -Recurse |
             Select-Object -First 1
if (-not $FfmpegExe) { throw "ffmpeg.exe not found in extracted archive." }
Copy-Item $FfmpegExe.FullName -Destination $FfmpegDst -Force

# Cleanup
Remove-Item $FfmpegZip -Force
Remove-Item $FfmpegExtDir -Recurse -Force

$ffmpegVersion = & $FfmpegDst -version 2>&1 | Select-String "ffmpeg version"
Write-Host "FFmpeg installed at $FfmpegDst" -ForegroundColor Green
Write-Host $ffmpegVersion -ForegroundColor DarkGray

Write-Host "`nDone! Both binaries are in src-tauri/binaries/" -ForegroundColor Green
Write-Host "They are gitignored - run this script again after cloning." -ForegroundColor DarkGray
