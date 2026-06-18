# Sends a global media key. Arg: next | prev | playpause
param([string]$key = 'playpause')
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MediaKey {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@
# VK codes: NEXT=0xB0, PREV=0xB1, PLAY/PAUSE=0xB3
$vk = switch ($key) { 'next' { 0xB0 } 'prev' { 0xB1 } 'playpause' { 0xB3 } default { 0xB3 } }
[MediaKey]::keybd_event([byte]$vk, 0, 0, [UIntPtr]::Zero)        # key down
[MediaKey]::keybd_event([byte]$vk, 0, 2, [UIntPtr]::Zero)        # key up (KEYEVENTF_KEYUP)
