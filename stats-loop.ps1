# stats-loop.ps1 — persistent helper for the iPad Dock.
# Spawned ONCE by main.js; loops forever emitting one compact JSON line every 2s:
#   { ts, net: {name, rx, tx}, media: {title, artist, status} }
# net rx/tx are cumulative byte totals (main.js computes rates from deltas).
#
# v1.2.0 hardening:
#   * WinRT waits are BOUNDED (1.5s) — a hung SMTC call can no longer freeze
#     the loop; media fails gracefully while network keeps flowing
#   * the media session manager is requested once and reused; it is re-requested
#     only after repeated failures, and media backs off for 60s if still broken
#   * network adapter selection follows the machine's DEFAULT ROUTE (the
#     interface actually carrying internet traffic), refreshed every ~20s,
#     with the busiest-real-adapter heuristic kept as a fallback
$ErrorActionPreference = 'SilentlyContinue'

# --- one-time WinRT media setup ---
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

# Bounded await: never blocks longer than $timeoutMs.
function Await($op, $resultType, $timeoutMs = 1500) {
  $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($op))
  if (-not $task.Wait($timeoutMs)) { throw 'winrt-timeout' }
  $task.Result
}

$badIface = 'zerotier|loopback|bluetooth|virtual|vmware|hyper|vethernet|tap|tun|spacedesk|parsec|duet|displaylink|wintun'

# media manager state: request once, reuse; recover on repeated failure
$mgr = $null
$mediaFails = 0
$mediaBackoffUntil = [DateTime]::MinValue

# network adapter state: resolved from the default route, refreshed periodically
$netAdapterName = $null
$netRefreshCounter = 0
function Resolve-ActiveAdapter {
  try {
    # The interface carrying the default route (lowest metric wins) is the one
    # actually serving internet traffic. Excluded-name check is a safety net.
    $route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
      Where-Object { $_.NextHop -ne '0.0.0.0' } |
      Sort-Object { $_.RouteMetric + $_.InterfaceMetric } |
      Select-Object -First 1
    if ($route) {
      $ad = Get-NetAdapter -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue
      if ($ad -and (($ad.Name + ' ' + $ad.InterfaceDescription) -notmatch $badIface)) { return $ad.Name }
    }
  } catch {}
  # Fallback: busiest real adapter (pre-v1.2 behaviour)
  try {
    $sel = Get-NetAdapterStatistics |
      Where-Object { ($_.Name + ' ' + $_.InterfaceDescription) -notmatch $badIface } |
      Sort-Object { $_.ReceivedBytes + $_.SentBytes } -Descending |
      Select-Object -First 1
    if ($sel) { return $sel.Name }
  } catch {}
  return $null
}

while ($true) {
  $out = @{ ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }

  # --- network: cumulative totals for the default-route adapter ---
  try {
    if (-not $netAdapterName -or ($netRefreshCounter % 10) -eq 0) {   # re-resolve every ~20s
      $resolved = Resolve-ActiveAdapter
      if ($resolved) { $netAdapterName = $resolved }
    }
    $netRefreshCounter++
    if ($netAdapterName) {
      $st = Get-NetAdapterStatistics -Name $netAdapterName -ErrorAction SilentlyContinue
      if ($st) {
        $out.net = @{ name = $st.Name; rx = [long]$st.ReceivedBytes; tx = [long]$st.SentBytes }
      } else {
        $netAdapterName = $null            # adapter went away; re-resolve next loop
      }
    }
  } catch {}

  # --- now-playing media (bounded, self-healing, never blocks the loop) ---
  if ($mediaOk -and [DateTime]::UtcNow -ge $mediaBackoffUntil) {
    try {
      if (-not $mgr) { $mgr = Await ($mgrType::RequestAsync()) $mgrType 2000 }
      $sess = $mgr.GetCurrentSession()
      if ($sess) {
        $props = Await ($sess.TryGetMediaPropertiesAsync()) $propsType
        $info = $sess.GetPlaybackInfo()
        if ($props.Title) {
          $out.media = @{ title = $props.Title; artist = $props.Artist; status = [int]$info.PlaybackStatus }
        }
      }
      $mediaFails = 0
    } catch {
      $mediaFails++
      $mgr = $null                          # re-request the manager next attempt
      if ($mediaFails -ge 3) {
        $mediaBackoffUntil = [DateTime]::UtcNow.AddSeconds(60)   # stop hammering a broken SMTC
        $mediaFails = 0
      }
    }
  }

  ($out | ConvertTo-Json -Compress -Depth 4)
  [Console]::Out.Flush()
  Start-Sleep -Seconds 2
}
