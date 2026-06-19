# Get / set / mute the Windows master volume via the CoreAudio API.
#   volume.ps1 get          -> prints current volume 0-100
#   volume.ps1 set 50       -> sets volume to 50, prints new value
#   volume.ps1 mute         -> toggles mute, prints "muted"/"unmuted"
param([string]$action = 'get', [int]$value = -1)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}
enum EDataFlow { eRender, eCapture, eAll }
enum ERole { eConsole, eMultimedia, eCommunications }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int NotImpl1();
  int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice endpoint);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
}
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int NotImpl1();
  int NotImpl2();
  int GetChannelCount(out int count);
  int SetMasterVolumeLevel(float level, Guid ctx);
  int SetMasterVolumeLevelScalar(float level, [MarshalAs(UnmanagedType.LPStruct)] Guid ctx);
  int GetMasterVolumeLevel(out float level);
  int GetMasterVolumeLevelScalar(out float level);
  int SetChannelVolumeLevel(uint ch, float level, Guid ctx);
  int SetChannelVolumeLevelScalar(uint ch, float level, Guid ctx);
  int GetChannelVolumeLevel(uint ch, out float level);
  int GetChannelVolumeLevelScalar(uint ch, out float level);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, [MarshalAs(UnmanagedType.LPStruct)] Guid ctx);
  int GetMute(out bool mute);
}
public class AudioMgr {
  static IAudioEndpointVolume GetVol() {
    var en = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
    IMMDevice dev; en.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out dev);
    object o; Guid iid = typeof(IAudioEndpointVolume).GUID; dev.Activate(ref iid, 23, IntPtr.Zero, out o);
    return (IAudioEndpointVolume)o;
  }
  public static int Get() { float v; GetVol().GetMasterVolumeLevelScalar(out v); return (int)Math.Round(v * 100); }
  public static void Set(int pct) { GetVol().SetMasterVolumeLevelScalar((float)(pct / 100.0), Guid.Empty); }
  public static bool ToggleMute() { var a = GetVol(); bool m; a.GetMute(out m); a.SetMute(!m, Guid.Empty); return !m; }
}
"@

switch ($action) {
  'set'  { if ($value -ge 0) { [AudioMgr]::Set($value) }; [AudioMgr]::Get() }
  'mute' { if ([AudioMgr]::ToggleMute()) { 'muted' } else { 'unmuted' } }
  default { [AudioMgr]::Get() }
}
