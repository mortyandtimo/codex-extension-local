@echo off
rem Foreground launcher: keeps the window open so you can watch the log.
title codex-config-watcher
node "%~dp0watcher.mjs"
pause
