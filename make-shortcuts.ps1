# Regenerates icon.ico and creates Desktop + Startup shortcuts for iPad Dock.
# Run: powershell -ExecutionPolicy Bypass -File make-shortcuts.ps1
Add-Type -AssemblyName System.Drawing
$proj = Split-Path -Parent $MyInvocation.MyCommand.Path
$icoPath = Join-Path $proj "icon.ico"

function New-RoundRect($x,$y,$w,$h,$r){
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r*2
  $p.AddArc($x,$y,$d,$d,180,90)
  $p.AddArc($x+$w-$d,$y,$d,$d,270,90)
  $p.AddArc($x+$w-$d,$y+$h-$d,$d,$d,0,90)
  $p.AddArc($x,$y+$h-$d,$d,$d,90,90)
  $p.CloseFigure()
  return $p
}

$S = 256
$bmp = New-Object System.Drawing.Bitmap $S,$S
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

$bgPath = New-RoundRect 8 8 ($S-16) ($S-16) 46
$bg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255,14,15,22))
$g.FillPath($bg, $bgPath)
$border = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(60,255,255,255)), 3
$g.DrawPath($border, $bgPath)

$colors = @(
  [System.Drawing.Color]::FromArgb(255,79,140,255),
  [System.Drawing.Color]::FromArgb(255,56,211,159),
  [System.Drawing.Color]::FromArgb(255,255,179,64)
)
$margin = 34; $gap = 16
$innerW = $S - ($margin*2)
$tileW = [int](($innerW - ($gap*2)) / 3)
$tileH = 120
$ty = [int](($S - $tileH)/2) + 6
for ($i=0; $i -lt 3; $i++) {
  $tx = $margin + $i*($tileW+$gap)
  $tp = New-RoundRect $tx $ty $tileW $tileH 18
  $b = New-Object System.Drawing.SolidBrush $colors[$i]
  $g.FillPath($b, $tp); $b.Dispose(); $tp.Dispose()
}
$g.Dispose()

$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png)
$png = $ms.ToArray(); $ms.Dispose(); $bmp.Dispose()

$fs = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]1)
$bw.Write([Byte]0); $bw.Write([Byte]0); $bw.Write([Byte]0); $bw.Write([Byte]0)
$bw.Write([UInt16]1); $bw.Write([UInt16]32)
$bw.Write([UInt32]$png.Length); $bw.Write([UInt32]22)
$bw.Write($png)
$bw.Flush(); $fs.Close()
Write-Host "Icon created: $icoPath"

$vbs = Join-Path $proj "launch-hidden.vbs"
$ws  = New-Object -ComObject WScript.Shell
foreach ($loc in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Startup'))) {
  $lnkPath = Join-Path $loc "iPad Dock.lnk"
  $lnk = $ws.CreateShortcut($lnkPath)
  $lnk.TargetPath = "$env:WINDIR\System32\wscript.exe"
  $lnk.Arguments = '"' + $vbs + '"'
  $lnk.WorkingDirectory = $proj
  $lnk.IconLocation = $icoPath
  $lnk.Description = "iPad Dock - bottom-bar widget"
  $lnk.WindowStyle = 7
  $lnk.Save()
  Write-Host "Shortcut created: $lnkPath"
}
Write-Host "Done."
