' Runs the FPS monitor (node fps-monitor.js) with no console window.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
' window style 0 = hidden; True = wait for node to exit (keeps the scheduled task alive
' so Task Scheduler does not tear down the node process tree).
sh.Run "node """ & dir & "\fps-monitor.js""", 0, True
