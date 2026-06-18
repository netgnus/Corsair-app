# setup-fps.ps1 — registers the PresentMon FPS monitor as an elevated logon task,
# so the dock can show real game FPS without a UAC prompt every boot.
# Run once: right-click -> Run with PowerShell (it will self-elevate).

# --- self-elevate ---
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$pr = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $pr.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
  Write-Host "Requesting administrator rights..."
  Start-Process powershell "-ExecutionPolicy Bypass -NoProfile -File `"$PSCommandPath`"" -Verb RunAs
  exit
}

$proj = Split-Path -Parent $MyInvocation.MyCommand.Path
$vbs  = Join-Path $proj 'fps-launch.vbs'
$taskName = 'iPad Dock FPS Monitor'

$action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\wscript.exe" -Argument ('"' + $vbs + '"') -WorkingDirectory $proj
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId ("$env:USERDOMAIN\$env:USERNAME") -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -Hidden -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "Registered scheduled task: $taskName"

Start-ScheduledTask -TaskName $taskName
Write-Host "Started. The dock's System box will show FPS while a game is running."
Write-Host ""
Write-Host "To remove later:  Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
Start-Sleep -Seconds 2
