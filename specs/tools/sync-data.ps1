# Copies the WebXR game data into the Lens Studio project, so both versions run on the same data.
# The WebXR version (webxr/) is the source of truth: run this after its data changes, then
# reopen or refresh the project in Lens Studio.
#
#   powershell -File specs/tools/sync-data.ps1
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$src = Join-Path $repo 'webxr\data'
$assets = Join-Path $repo 'specs\MarsHomecoming\Assets'

$copies = @(
  @{ From = 'game-data.json'; To = 'Data' },
  @{ From = 'expansion.json'; To = 'Data' },
  @{ From = 'board.json'; To = 'Data' },
  @{ From = 'world.glb'; To = 'Models' }
)
foreach ($c in $copies) {
  $dest = Join-Path $assets $c.To
  New-Item -ItemType Directory -Force $dest | Out-Null
  Copy-Item (Join-Path $src $c.From) $dest -Force
  Write-Host "copied $($c.From) -> Assets/$($c.To)"
}

# The baked UVs keep three.js (FBX) orientation, which WebXR handles with texture.flipY = true.
# Lens Studio has no such flag, so the atlases are stored upside down in the Lens project.
Add-Type -AssemblyName System.Drawing
$dest = Join-Path $assets 'Textures'
New-Item -ItemType Directory -Force $dest | Out-Null
foreach ($name in 'spacebits_texture.png', 'spacebits_texture_1.png') {
  $img = [System.Drawing.Image]::FromFile((Join-Path $src "textures\$name"))
  $img.RotateFlip([System.Drawing.RotateFlipType]::RotateNoneFlipY)
  $img.Save((Join-Path $dest $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $img.Dispose()
  Write-Host "copied textures\$name (flipped) -> Assets/Textures"
}
