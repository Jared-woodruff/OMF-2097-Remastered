; The installer's hooks (tauri.conf.json bundle.windows.nsis.installerHooks). OMF Studio, the game's modding tool, is
; the game's own program started with --studio: setup asks whether to add its shortcuts (Start menu and desktop). The
; game can open it any time (EXTRAS > OMF STUDIO), so the question only decides the shortcuts. Quiet and passive
; installs add them.

!macro NSIS_HOOK_POSTINSTALL
  StrCpy $0 1
  ${IfNot} $PassiveMode = 1
  ${AndIfNot} ${Silent}
    MessageBox MB_YESNO|MB_ICONQUESTION "Also install OMF Studio, the mod tools?$\r$\n$\r$\nOMF Studio makes new robots, arenas and pilots for the game, pixel for pixel, and builds them into mods the game plays. It adds a Start menu shortcut and a desktop shortcut.$\r$\n$\r$\n(The game opens it too: EXTRAS > OMF STUDIO.)" /SD IDYES IDYES +2
    StrCpy $0 0
  ${EndIf}
  ${If} $0 = 1
    CreateShortcut "$SMPROGRAMS\OMF Studio.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--studio" "$INSTDIR\${MAINBINARYNAME}.exe" 0 SW_SHOWNORMAL "" "OMF Studio: the mod tools of One Must Fall 2097 Remastered"
    CreateShortcut "$DESKTOP\OMF Studio.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--studio" "$INSTDIR\${MAINBINARYNAME}.exe" 0 SW_SHOWNORMAL "" "OMF Studio: the mod tools of One Must Fall 2097 Remastered"
  ${Else}
    Delete "$SMPROGRAMS\OMF Studio.lnk"
    Delete "$DESKTOP\OMF Studio.lnk"
  ${EndIf}
!macroend

; (after the uninstall: one cancelled because the game is running keeps its Studio shortcuts)
!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$SMPROGRAMS\OMF Studio.lnk"
  Delete "$DESKTOP\OMF Studio.lnk"
!macroend
