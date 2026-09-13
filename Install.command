#!/bin/zsh
set -e
cd -- "${0:A:h}"
if [[ -x /opt/homebrew/bin/node ]]; then
  /opt/homebrew/bin/node host/install.mjs
elif command -v node >/dev/null; then
  node host/install.mjs
else
  print 'Install Node.js 22 or newer: https://nodejs.org'
  exit 1
fi
print '\nCompanion ready. Follow the extension installation steps in README.md.'
read '?Press Enter to close…'
