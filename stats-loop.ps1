# stats-loop.ps1 — persistent helper for the iPad Dock.
# Spawned ONCE by main.js; loops forever emitting one compact JSON line every 2s:
#   { ts, net: {name, rx, tx}, media: {title, artist, status} }
# net rx/tx are cumulative byte totals (main.js computes rates from deltas).
# Replaces the old design that spawned new powershell/WMI processes on every poll.
$ErrorActionPreference = 'SilentlyContinue'

# --- one-time WinRT media session setup ---
$mediaOk = $true
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
  [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
  $mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
  $propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
} catch { $mediaOk = $false }

function Await($op, $resultType) {
  $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}

$badIface = 'zerotier|loopback|bluetooth|virtual|vmware|hyper|vethernet|tap|tun|spacedesk|parsec|duet|displaylink|wintun'

while ($true) {
  $out = @{ ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }

  # network: cumulative totals for the busiest real adapter
  try {
    $sel = Get-NetAdapterStatistics |
      Where-Object { ($_.Name + ' ' + $_.InterfaceDescription) -notmatch $badIface } |
      Sort-Object { $_.ReceivedBytes + $_.SentBytes } -Descending |
      Select-Object -First 1
    if ($sel) { $out.net = @{ name = $sel.Name; rx = [long]$sel.ReceivedBytes; tx = [long]$sel.SentBytes } }
  } catch {}

  # now-playing media (in-process WinRT — no new processes)
  if ($mediaOk) {
    try {
      $mgr = Await ($mgrType::RequestAsync()) $mgrType
      $sess = $mgr.GetCurrentSession()
      if ($sess) {
        $props = Await ($sess.TryGetMediaPropertiesAsync()) $propsType
        $info = $sess.GetPlaybackInfo()
        if ($props.Title) {
          $out.media = @{ title = $props.Title; artist = $props.Artist; status = [int]$info.PlaybackStatus }
        }
      }
    } catch {}
  }

  ($out | ConvertTo-Json -Compress -Depth 4)
  [Console]::Out.Flush()
  Start-Sleep -Seconds 2
}
