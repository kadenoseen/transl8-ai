# VHS tape file for recording transl8-ai demo GIF
# Install: brew install vhs
# Record: cd demo && vhs demo.tape
#
# Requires: OPENAI_API_KEY in demo/.env

Output demo.gif

Set Shell "zsh"
Set Theme "Catppuccin Mocha"
Set FontSize 16
Set Width 900
Set Height 600
Set Padding 20
Set TypingSpeed 40ms

# Hidden setup — clean slate
Hide
Type "rm -f .transl8rc.json glossary.json"
Enter
Sleep 500ms
Type "clear"
Enter
Sleep 500ms
Show

# Scene 1: Initialize
Sleep 500ms
Type "transl8 init"
Enter
Sleep 3s

# Scene 2: List languages
Type "transl8 list-languages"
Enter
Sleep 4s

# Scene 3: Analyze translations
Type "transl8 analyze"
Enter
Sleep 4s

# Scene 4: Live translate (60 missing keys)
Type "transl8 translate de"
Enter
Sleep 20s
