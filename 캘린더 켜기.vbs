' Start the desk calendar from this folder without a console window (development run; uses this folder's Electron)
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
exe = dir & "\node_modules\electron\dist\electron.exe"
If Not fso.FileExists(exe) Then
  MsgBox "Electron is missing. Run 'npm install' in this folder first.", 48, "desk-calendar"
  WScript.Quit 1
End If
sh.Run """" & exe & """ """ & dir & """", 0, False
