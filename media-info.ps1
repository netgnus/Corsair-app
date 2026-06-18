# Outputs the current Windows media session as JSON: {title, artist, status, app}
# status: 4 = Playing, 5 = Paused, others = stopped/closed/changing
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
  function Await($op, $resultType) {
    $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($op))
    $task.Wait(-1) | Out-Null
    $task.Result
  }
  [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
  $mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
  $mgr = Await ($mgrType::RequestAsync()) $mgrType
  $sess = $mgr.GetCurrentSession()
  if (-not $sess) { '{}'; return }
  $propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
  $props = Await ($sess.TryGetMediaPropertiesAsync()) $propsType
  $info = $sess.GetPlaybackInfo()
  $out = [ordered]@{
    title  = $props.Title
    artist = $props.Artist
    status = [int]$info.PlaybackStatus
    app    = $sess.SourceAppUserModelId
  }
  $out | ConvertTo-Json -Compress
} catch {
  '{}'
}
