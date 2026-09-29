#!/bin/sh
# Publiceert database.rules.json naar de Realtime Database van Firebase.
# Eenmalig vooraf: npx firebase-tools login (met een Google-account dat toegang heeft tot het project).
cd "$(dirname "$0")" && npx --yes firebase-tools@latest deploy --only database --project marzeille-474a9
