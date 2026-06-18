# Resolves Start-Menu shortcuts for a curated app list, extracts each icon to icons\*.png,
# and writes apps.json (used by the dock's App Launcher widget).
# Re-run this any time to refresh the launcher's app list / icons.
Add-Type -AssemblyName System.Drawing | Out-Null
$proj = Split-Path -Parent $MyInvocation.MyCommand.Path
$iconDir = Join-Path $proj 'icons'
New-Item -ItemType Directory -Path $iconDir -Force | Out-Null

# Curated apps to show in the launcher (display name -> match keyword in shortcut name).
$wanted = @(
  @{ name='Steam';        kw='Steam' },
  @{ name='Chrome';       kw='Google Chrome' },
  @{ name='Discord';      kw='Discord' },
  @{ name='Zoom';         kw='Zoom' },
  @{ name='Photoshop';    kw='Adobe Photoshop' },
  @{ name='VS Code';      kw='Visual Studio Code' },
  @{ name='Epic Games';   kw='Epic Games Launcher' },
  @{ name='Brave';        kw='Brave' },
  @{ name='Firefox';      kw='Firefox' },
  @{ name='VLC';          kw='VLC media player' },
  @{ name='Armoury Crate';kw='Armoury Crate' },
  @{ name='iCUE';         kw='iCUE' }
)

$startDirs = @(
  "$env:ProgramData\Microsoft\Windows\Start Menu\Programs",
  "$env:AppData\Microsoft\Windows\Start Menu\Programs"
)
$allLnks = foreach ($d in $startDirs) { if (Test-Path $d) { Get-ChildItem $d -Recurse -Filter *.lnk -ErrorAction SilentlyContinue } }
$ws = New-Object -ComObject WScript.Shell

function Save-Icon($srcPath, $outPng) {
  try {
    $ico = [System.Drawing.Icon]::ExtractAssociatedIcon($srcPath)
    if ($ico) { $bmp = $ico.ToBitmap(); $bmp.Save($outPng, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose(); return $true }
  } catch {}
  return $false
}

$result = @()
foreach ($w in $wanted) {
  $lnk = $allLnks | Where-Object { $_.BaseName -like "*$($w.kw)*" } | Sort-Object { $_.BaseName.Length } | Select-Object -First 1
  if (-not $lnk) { continue }
  $sc = $ws.CreateShortcut($lnk.FullName)
  $target = $sc.TargetPath
  $safe = ($w.name -replace '[^A-Za-z0-9]', '')
  $png = Join-Path $iconDir "$safe.png"
  $okIcon = $false
  if ($target -and (Test-Path $target)) { $okIcon = Save-Icon $target $png }
  if (-not $okIcon) { $okIcon = Save-Icon $lnk.FullName $png }
  $iconRel = $null
  if ($okIcon) { $iconRel = "icons/$safe.png" }
  $result += [ordered]@{
    name   = $w.name
    target = $lnk.FullName               # launch the .lnk (handles args/working dir)
    icon   = $iconRel
  }
}
$result | ConvertTo-Json -Compress | Out-File (Join-Path $proj 'apps.json') -Encoding utf8
Write-Host "Resolved $($result.Count) apps -> apps.json"
$result | ForEach-Object { Write-Host ("  {0,-14} icon={1}" -f $_.name, [bool]$_.icon) }
