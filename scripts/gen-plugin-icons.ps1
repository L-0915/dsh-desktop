# Generates icon variants for the plugin's built-in icon set:
#   whale.ico  — teal/cyan whale-tone variant
#   dark.ico   — dark slate variant
# Both reuse the master drawing routine (rounded tile + "D" + wave).
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot '..\packages\dsh-desktop\assets\icons'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

function New-IconVariant([string]$name, [System.Drawing.Color]$c1, [System.Drawing.Color]$c2, [System.Drawing.Color]$wave) {
  $size = 256
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $radius = 45
  $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $radius * 2
  $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
  $path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
  $path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
  $path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, 45.0)
  $g.FillPath($brush, $path)
  $font = New-Object System.Drawing.Font('Segoe UI', 108, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $g.DrawString('D', $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF(0, -8, $size, $size)), $sf)
  $pen = New-Object System.Drawing.Pen($wave, 7)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pts = @(
    (New-Object System.Drawing.PointF(52, 175)),
    (New-Object System.Drawing.PointF(85, 160)),
    (New-Object System.Drawing.PointF(118, 175)),
    (New-Object System.Drawing.PointF(150, 160)),
    (New-Object System.Drawing.PointF(183, 175)),
    (New-Object System.Drawing.PointF(215, 160))
  )
  $g.DrawCurve($pen, $pts)
  $g.Dispose()

  # PNG bytes
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $png = $ms.ToArray()
  $bmp.Dispose()

  # ICO wrap (PNG-in-ICO, single 256 entry)
  $ico = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter($ico)
  $bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]1)
  $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([byte]0)
  $bw.Write([uint16]1); $bw.Write([uint16]32)
  $bw.Write([uint32]$png.Length); $bw.Write([uint32]22)
  $bw.Write($png); $bw.Flush()
  $path = Join-Path $outDir $name
  [System.IO.File]::WriteAllBytes($path, $ico.ToArray())
  Write-Output "wrote $name"
}

New-IconVariant 'whale.ico' ([System.Drawing.Color]::FromArgb(255, 13, 148, 136)) ([System.Drawing.Color]::FromArgb(255, 8, 51, 68)) ([System.Drawing.Color]::FromArgb(255, 153, 246, 228))
New-IconVariant 'dark.ico' ([System.Drawing.Color]::FromArgb(255, 71, 85, 105)) ([System.Drawing.Color]::FromArgb(255, 15, 23, 42)) ([System.Drawing.Color]::FromArgb(255, 148, 163, 184))

# Also seed the default built-in icon from the shell icon set.
Copy-Item (Join-Path $PSScriptRoot '..\apps\shell\src-tauri\icons\icon.ico') (Join-Path $outDir 'icon.ico') -Force
Write-Output '---'
Get-ChildItem $outDir -File | Select-Object Name, Length | Format-Table -AutoSize
