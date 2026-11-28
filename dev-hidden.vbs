' Huaqiang Agent - hidden dev launcher.
' Starts the dev .bat with no console window and appends output to a log file.
Option Explicit

Dim sh, fso, base, logDir, logFile, targetLog, bat, extra, i, q, cmd, code, f, probe

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

base = fso.GetParentFolderName(WScript.ScriptFullName)
logDir = base & "\logs"
If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)

' The dev bat file name is built from char codes so this script stays ASCII.
bat = base & "\" & ChrW(&H542F) & ChrW(&H52A8) & ChrW(&H5F00) & ChrW(&H53D1) & ChrW(&H7248) & ".bat"

extra = ""
For i = 0 To WScript.Arguments.Count - 1
  extra = extra & " " & WScript.Arguments(i)
Next

' A leftover dev server may still hold dev.log; in that case switch to a
' timestamped file so launching is never blocked by a stale handle.
targetLog = logDir & "\dev.log"
On Error Resume Next
Set probe = fso.OpenTextFile(targetLog, 8, True)
If Err.Number <> 0 Then
  Err.Clear
  targetLog = logDir & "\dev-" & Year(Now) & Right("0" & Month(Now), 2) & Right("0" & Day(Now), 2) & "-" & Right("0" & Hour(Now), 2) & Right("0" & Minute(Now), 2) & Right("0" & Second(Now), 2) & ".log"
Else
  probe.Close
End If
On Error GoTo 0

Set f = fso.OpenTextFile(logDir & "\launch.log", 8, True)
f.WriteLine "===== " & Now & "  log=" & targetLog & " ====="
f.Close

q = Chr(34)
cmd = "cmd.exe /c " & q & q & bat & q & " --hidden" & extra & " >> " & q & targetLog & q & " 2>&1" & q
code = sh.Run(cmd, 0, True)

If code <> 0 Then
  MsgBox "Huaqiang Agent dev server exited with code " & code & vbCrLf & vbCrLf & _
         "Log file: " & targetLog, vbExclamation, "Huaqiang Agent"
End If