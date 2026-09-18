' Launches codex-config-watcher with no visible window.
' Drop a shortcut to this file into shell:startup for auto-start on login.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run "node """ & sh.CurrentDirectory & "\watcher.mjs""", 0, False
