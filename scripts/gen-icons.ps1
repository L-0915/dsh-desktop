# Generates the full Tauri icon set into apps/shell/src-tauri/icons/
# using System.Drawing (Windows only): a 1024 master PNG, resized PNGs,
# a PNG-embedded ICO (Vista+), and a PNG-embedded ICNS.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot '..\apps\shell\src-tauri\icons'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

# --- draw the 1024 master: rounded deep-blue tile, white "D" + wave ---
$size = 1024
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

# rounded-rect path
$radius = 180
$rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$d = $radius * 2
$path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
$path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
$path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
$path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
$path.CloseFigure()

$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  $rect,
  [System.Drawing.Color]::FromArgb(255, 30, 58, 138),
  [System.Drawing.Color]::FromArgb(255, 12, 74, 110),
  45.0)
$g.FillPath($brush, $path)

# "D" glyph
$font = New-Object System.Drawing.Font('Segoe UI', 430, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$white = [System.Drawing.Brushes]::White
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$textRect = New-Object System.Drawing.RectangleF(0, -30, $size, $size)
$g.DrawString('D', $font, $white, $textRect, $sf)

# wave under the letter
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 125, 211, 252), 26)
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$pts = @(
  (New-Object System.Drawing.PointF(210, 700)),
  (New-Object System.Drawing.PointF(340, 640)),
  (New-Object System.Drawing.PointF(470, 700)),
  (New-Object System.Drawing.PointF(600, 640)),
  (New-Object System.Drawing.PointF(730, 700)),
  (New-Object System.Drawing.PointF(860, 640))
)
$g.DrawCurve($pen, $pts)

$g.Dispose()
$bmp.Save((Join-Path $outDir 'master.png'), [System.Drawing.Imaging.ImageFormat]::Png)

# --- resize to every needed size ---
$sizes = @(16, 32, 64, 128, 256, 512, 1024)
$pngs = @{}
foreach ($s in $sizes) {
  $small = New-Object System.Drawing.Bitmap($s, $s)
  $sg = [System.Drawing.Graphics]::FromImage($small)
  $sg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $sg.DrawImage($bmp, 0, 0, $s, $s)
  $sg.Dispose()
  $name = switch ($s) {
    32  { '32x32.png' }
    128 { '128x128.png' }
    256 { '128x128@2x.png' }
    default { "$s`x$s.png" }
  }
  $file = Join-Path $outDir $name
  $small.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngs[$s] = $file
  $small.Dispose()
}

# --- ICO: header + one 256x256 PNG entry (Vista+ supports PNG in ICO) ---
$png256 = [System.IO.File]::ReadAllBytes($pngs[256])
$ico = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ico)
$bw.Write([uint16]0)        # reserved
$bw.Write([uint16]1)        # type: icon
$bw.Write([uint16]1)        # count
$bw.Write([byte]0)          # width 256 -> 0
$bw.Write([byte]0)          # height 256 -> 0
$bw.Write([byte]0)          # palette
$bw.Write([byte]0)          # reserved
$bw.Write([uint16]1)        # planes
$bw.Write([uint16]32)       # bpp
$bw.Write([uint32]$png256.Length)
$bw.Write([uint32]22)       # offset: 6 + 16
$bw.Write($png256)
$bw.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $outDir 'icon.ico'), $ico.ToArray())

# --- ICNS: PNG-embedded chunks (icp4=16, icp5=32, icp6=64, ic07=128, ic08=256, ic09=512, ic10=1024) ---
function Add-IcnsChunk([System.IO.MemoryStream]$ms, [string]$type, [byte[]]$data) {
  $t = [System.Text.Encoding]::ASCII.GetBytes($type)
  $ms.Write($t, 0, 4)
  $len = 8 + $data.Length
  $ms.Write([System.BitConverter]::GetBytes([uint32]$len), 0, 4)
  $ms.Write($data, 0, $data.Length)
}
$icns = New-Object System.IO.MemoryStream
$icns.Write([System.Text.Encoding]::ASCII.GetBytes('icns'), 0, 4)
$sizePos = $icns.Position
$icns.Write([System.BitConverter]::GetBytes([uint32]0), 0, 4)  # patched later
$chunks = @(
  @('icp4', 16), @('icp5', 32), @('icp6', 64),
  @('ic07', 128), @('ic08', 256), @('ic09', 512), @('ic10', 1024)
)
foreach ($c in $chunks) {
  $data = [System.IO.File]::ReadAllBytes($pngs[$c[1]])
  Add-IcnsChunk $icns $c[0] $data
}
$total = $icns.Length
$icns.Position = $sizePos
$icns.Write([System.BitConverter]::GetBytes([uint32]$total), 0, 4)
[System.IO.File]::WriteAllBytes((Join-Path $outDir 'icon.icns'), $icns.ToArray())

$bmp.Dispose()
Write-Output 'icons generated:'
Get-ChildItem $outDir -File | Select-Object Name, Length | Format-Table -AutoSize
