<#
  Builds PilPod as an MSIX package for the Microsoft Store.

  The Store signs MSIX packages itself, so the .msix this makes is unsigned
  on purpose: upload it in Partner Center, do not install it by double-click.

  Run from the app folder:
      powershell -ExecutionPolicy Bypass -File scripts\msix\build-msix.ps1
  Add -SkipBuild to reuse the existing src-tauri\target\release\pilpod.exe.

  Needs: the Windows SDK (for makeappx.exe).
      winget install Microsoft.WindowsSDK.10.0.26100
#>
param([switch]$SkipBuild)

$ErrorActionPreference = 'Stop'
$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir  = Resolve-Path (Join-Path $here '..\..')
$tauri   = Join-Path $appDir 'src-tauri'
$release = Join-Path $tauri 'target\release'
$outDir  = Join-Path $tauri 'target\msix'
$layout  = Join-Path $outDir 'layout'

# --- Identity from Partner Center -------------------------------------------
$id = Get-Content (Join-Path $here 'identity.json') -Raw | ConvertFrom-Json
foreach ($k in 'packageName','publisher','publisherDisplayName','displayName') {
  if (-not $id.$k -or $id.$k -like 'PASTE*') {
    throw "identity.json: '$k' is not filled in. Copy it from Partner Center > Product identity."
  }
}
if ($id.publisher -notlike 'CN=*') { throw "identity.json: 'publisher' must start with CN=" }

# --- Version: tauri.conf.json 2.0.0 -> MSIX 2.0.0.0 (Store needs the 4th part = 0)
$conf = Get-Content (Join-Path $tauri 'tauri.conf.json') -Raw | ConvertFrom-Json
$parts = $conf.version.Split('.')
while ($parts.Count -lt 3) { $parts += '0' }
$msixVersion = "$($parts[0]).$($parts[1]).$($parts[2]).0"
Write-Host "PilPod $($conf.version) -> MSIX $msixVersion"

# --- makeappx ----------------------------------------------------------------
$makeappx = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\makeappx.exe" -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $makeappx) {
  throw "makeappx.exe not found. Install the Windows SDK:  winget install Microsoft.WindowsSDK.10.0.26100"
}

# --- Build the app exe (no installer needed) ---------------------------------
if (-not $SkipBuild) {
  Push-Location $appDir
  try { npm run tauri build -- --no-bundle; if ($LASTEXITCODE) { throw "tauri build failed" } }
  finally { Pop-Location }
}
$exe = Join-Path $release 'pilpod.exe'
if (-not (Test-Path $exe)) { throw "Not found: $exe" }

# --- Layout ------------------------------------------------------------------
if (Test-Path $layout) { Remove-Item $layout -Recurse -Force }
New-Item -ItemType Directory -Path $layout, "$layout\Assets" | Out-Null

Copy-Item $exe $layout
# Same resources as tauri.conf.json "bundle.resources", next to the exe
# (Tauri's resource_dir on Windows is the exe's folder).
Copy-Item (Join-Path $tauri 'wallpapers') $layout -Recurse
New-Item -ItemType Directory -Path "$layout\icons" | Out-Null
Copy-Item (Join-Path $tauri 'icons\browsers') "$layout\icons" -Recurse

# Tile / logo assets from the existing Tauri icon set.
$icons = Join-Path $tauri 'icons'
Copy-Item "$icons\StoreLogo.png"          "$layout\Assets\StoreLogo.png"
Copy-Item "$icons\Square150x150Logo.png"  "$layout\Assets\Square150x150Logo.png"
Copy-Item "$icons\Square44x44Logo.png"    "$layout\Assets\Square44x44Logo.png"

# --- Manifest ----------------------------------------------------------------
function Esc([string]$s) { [System.Security.SecurityElement]::Escape($s) }
$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap rescap">

  <Identity Name="$(Esc $id.packageName)"
            Publisher="$(Esc $id.publisher)"
            Version="$msixVersion"
            ProcessorArchitecture="x64" />

  <Properties>
    <DisplayName>$(Esc $id.displayName)</DisplayName>
    <PublisherDisplayName>$(Esc $id.publisherDisplayName)</PublisherDisplayName>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>

  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>

  <Resources>
    <Resource Language="en-us" />
  </Resources>

  <Applications>
    <Application Id="PilPod" Executable="pilpod.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="PilPod"
        Description="$(Esc $conf.productName) - browser media dashboard"
        BackgroundColor="transparent"
        Square150x150Logo="Assets\Square150x150Logo.png"
        Square44x44Logo="Assets\Square44x44Logo.png" />
    </Application>
  </Applications>

  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
"@
[System.IO.File]::WriteAllText((Join-Path $layout 'AppxManifest.xml'), $manifest, (New-Object System.Text.UTF8Encoding $false))

# --- Pack --------------------------------------------------------------------
$msix = Join-Path $outDir "PilPod_${msixVersion}_x64.msix"
if (Test-Path $msix) { Remove-Item $msix -Force }
& $makeappx.FullName pack /d $layout /p $msix /o
if ($LASTEXITCODE) { throw "makeappx failed" }

Write-Host ""
Write-Host "Done: $msix" -ForegroundColor Green
Write-Host "Upload this file in Partner Center > Packages. Next release: bump the version in tauri.conf.json first."
