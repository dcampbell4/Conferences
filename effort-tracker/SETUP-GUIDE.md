# Chapel Effort Tracker: setup guide

About 20 minutes, once. It's the same process as the Hall Pass, so it should feel familiar.

**How it works:** a Google Sheet in your Drive holds every entry. A small Google Apps Script program
attached to it runs the logging screen and the dashboard, and sends you emails. Only you can open it.

## How the tracker thinks

1. You log an entry: tap a student → tap one of the 5 rubric indicators (add a note if you like).
2. **3 entries within 21 days** (all indicators together) → the student reaches **Concern**. You get an
   email straight away listing the entries: *"Contact home: Ana Souza."*
3. You contact home and click **Contacted home** on the dashboard (add a note, e.g. "Emailed mother").
4. The tracker watches. **If 3 more entries happen within 21 days**, you get a second email:
   *"Still concerning after contact."* You decide: **Move to intervention** or **Back on track**.
5. **Back on track** starts the count again from zero.

Every school-day morning you also get one reminder email listing anyone still waiting on a call home
or a decision. If nobody is waiting, there's no email.

---

## Step 1: Make the Google Sheet

Go to [sheets.new](https://sheets.new) (signed in with your school account) and name it **Effort Tracker**.

## Step 2: Open the code editor

1. **Extensions → Apps Script**. Rename the project **Effort Tracker**.
2. **Gear icon (Project Settings)** → tick **"Show 'appsscript.json' manifest file in editor"**.
3. Click the **< > (Editor)** icon to go back.

## Step 3: Copy in the 5 files

The files are in the `effort-tracker/apps-script` folder of this project.

| File in this project | What to do in Apps Script |
| --- | --- |
| `appsscript.json` | Click it in the file list. Replace everything. |
| `Code.gs` | Click it. Replace everything. |
| `Common.html` | **+** next to Files → **HTML** → name it `Common` → delete the starter code → paste |
| `Log.html` | Same way, named `Log` |
| `Dashboard.html` | Same way, named `Dashboard` |

Save (Ctrl/Cmd + S).

## Step 4: Check Google Classroom is connected

Under **Services** on the left you should see **Classroom**. If not: **+** → **Google Classroom API** → **Add**.

## Step 5: Run the setup

1. Reload the Google Sheet. A menu called **Effort Tracker** appears (give it about 10 seconds).
2. **Effort Tracker → Set up this spreadsheet** → **Continue** → choose your account → **Allow**.
   (If you see "Google hasn't verified this app": **Advanced** → **Go to Effort Tracker**.)
   Google will ask permission to **send email as you**. That's for the alerts, which only go to you.
3. Click **Effort Tracker → Set up this spreadsheet** once more.

Your tabs: **Log, Follow-up, Settings, Rubric, Classes, Students, Enrollments**.

## Step 6: Publish the app

1. **Deploy → New deployment** → gear → **Web app**.
2. Execute as: **Me**. Who has access: **Only myself**.
3. **Deploy** → copy the **Web app URL**.

| Page | Link |
| --- | --- |
| Logging screen | your URL |
| Dashboard | your URL + `?page=dashboard` |

Bookmark both. If you'd like the C icon on the bookmarks, paste your icon link
(`https://i.postimg.cc/SNV3yFzG/favicon.png`) into **Browser tab icon (link)** in the Settings tab.

## Step 7: Bring in your classes

**Dashboard → Classes → Show my Google Classroom classes** → tick your classes → **Import selected classes**.

## Step 8: Before the new marking period

In the **Settings** tab, type the first day of the marking period next to **Marking period starts**,
for example `2026-11-03`. Only entries from that day on count. Do the same at the start of every
quarter: everyone starts fresh, and the old entries stay in the Log tab.

---

## Settings you can change

| Setting | Default |
| --- | --- |
| Entries for concern | `3` |
| Within (days) | `21` (three weeks) |
| Marking period starts | blank = count everything |
| Email me when a student reaches concern | `Yes` |
| Weekday reminder email | `Yes` |
| Reminder time (hour 0-23) | `7`. Run **Effort Tracker → Set up this spreadsheet** again after changing it |
| Send emails to | blank = you |

The **Rubric** tab holds the five indicators and their EXP / CON / INT wording. Edit it there; the
app picks up changes straight away.

## Using it on an iPad, or with students nearby

The logging screen shows small dots (entries toward concern) and status labels on the name buttons.
If students can see your screen, tap **Hide status** in the top bar and the screen shows names only.

## Updating the code later

Paste the new file, then **Deploy → Manage deployments → pencil → Version: New version → Deploy**.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| No **Effort Tracker** menu | Reload the Sheet and wait about 10 seconds |
| No emails | Check spam once. Check **Email me…** is `Yes` and **Send emails to** is right |
| Reminder at the wrong time | Change **Reminder time**, then run **Set up this spreadsheet** again |
| "Google Classroom is not connected yet" | Do step 4, then publish a new version |
| A student is counted from last quarter | Set **Marking period starts** in Settings |

## Sharing with a colleague

They make their own copy: **File → Make a copy** of your Sheet (the code comes along), delete your
entries from the Log and Follow-up tabs, then follow steps 5–8 with their own account. Their data
stays in their own Drive.
