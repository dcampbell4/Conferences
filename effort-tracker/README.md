# Chapel Effort Tracker (Google Sheets version)

Log effort and behaviour concerns against the five-indicator rubric in two taps, and get told when it's
time to contact home.

- Tap a student → tap an indicator (optional note). Undo is one tap.
- **3 entries in 21 days** → *Concern*. You get an email to contact home.
- After **Contacted home**, 3 more entries in 21 days → an email suggesting intervention. You decide.
- Weekday morning reminder of anyone still waiting on you.
- Class lists from **Google Classroom**. Data in **your own Google Sheet**.
- A **Marking period starts** setting lets every quarter start fresh.
- A dashboard with *Needs attention*, all students, and a printable per-student rubric view for conferences.

**Set it up with [SETUP-GUIDE.md](SETUP-GUIDE.md).**

This replaces the older one-page tracker in `../behavior/`, which kept data only in the browser. That
version is unchanged.

## Testing on a computer (optional)

```bash
node effort-tracker/dev/test-logic.js   # the concern / follow-up rules (17 tests)
node effort-tracker/dev/server.js       # try it at http://localhost:8787/exec with made-up students
node effort-tracker/dev/e2e.js          # clicks through every screen (needs Playwright)
```
