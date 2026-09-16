German Flashcards — Green Primary Ready Build

This is the deploy-ready static site.

Files:
- index.html
- data.js

Included features:
- Green-dominant dark theme with brown secondary accents
- Mobile-friendly table view
- Flashcards
- German ↔ English front selection
- Strict German-only browser TTS when a German voice is available
- Favorites + Review Favorites
- Local progress via localStorage
- Optional Google sign-in with cloud progress sync through the existing Firebase project
- Known / Again review flow
- Per-word spaced repetition
- Due Today screen across all decks
- SRS intervals: 1, 3, 7, 14, 30, 60, 120 days
- Multiple Known clicks on the same day do not advance multiple SRS steps
- Again does not reset SRS stage

Deployment:
Upload index.html, data.js, cloud-sync.js, and cloud-sync-core.js to the root of the GitHub Pages repository.

Cloud progress is stored separately from the main words-list levels at:
artifacts/german-80-20-app/users/{uid}/progress/main
