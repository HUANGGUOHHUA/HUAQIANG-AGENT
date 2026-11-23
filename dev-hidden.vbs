' Huaqiang Agent - hidden dev launcher.
' Starts the dev .bat with no console window and appends all output to logs\dev.log.
Option Explicit

Dim sh, fso, base, logDir, logFile, launchLog, bat, extra, i, q, cmd, code, f

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

base = fso.GetParentFolderName(WScript.ScriptFullName)
logDir = base & "\logs"
If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)
logFile = logDir & "\dev.log"
launchLog = logDir & "\launch.log"

' The dev bat file name is built from char codes so this script stays ASCII.
bat = base & "\" & ChrW(&H542F) & ChrW(&H52A8) & ChrW(&H5F00) & ChrW(&H53D1) & ChrW(&H7248) & ".bat"

extra = ""
For i = 0 To WScript.Arguments.Count - 1
  extra = extra & " " & WScript.Arguments(i)
Next

Set f = fso.OpenTextFile(launchLog, 8, True)
f.WriteLine "===== " & Now & " ====="
f.Close

q = Chr(34)
cmd = "cmd.exe /c " & q & q & bat & q & " --hidden" & extra & " >> " & q & logFile & q & " 2>&1" & q

code = sh.Run(cmd, 0, True)

If code <> 0 Then
  MsgBox "Huaqiang Agent dev server exited with code " & code & vbCrLf & vbCrLf & _
         "Log file: " & logFile, vbExclamation, "Huaqiang Agent"
End If