# uBiF Web Extensions — Usage Stats

The stats page for **uBiF Web Extensions** (the NextGen Portal toolkit for uBreakiFix stores):
how often each tool is used and how much time that saves, by store and by day.

**Page:** https://ubifsaiyan.github.io/ubif-stats/

Only allowed Google accounts can see any numbers. This repo holds just the page and the database
rules; the data itself is in Firebase and is locked to those accounts.

## What the extension sends

Starting with version 1.4.4, the extension sends a small record each time a tool does something:

| Tool | Counted |
| --- | --- |
| Autocomplete Service | each run that reaches Checkout (service type, how long it took, where it started); each run that stops with an error (a fixed code such as `MODEL_NOT_IN_PORTAL`, and the step); other stops (stopped by the user, nothing to start, tab closed); each Verizon "Are you sure?" free-accessory box (what was missing, which button was pressed, and $15 the first time it shows for a sale) |
| Auto-Confirm Serial | every serial it confirms |
| IMEI Autofill | every Autofill IMEI click |
| GD Exception | GSPN tickets created, exception forms opened and filled, forms submitted |
| In-Stock Search | items added from the In stock box |
| Auto-Open Work Order | work orders it opened |
| (whole extension) | one check-in per day per browser profile, with which tools are switched on and which are off, each with its version |

Every record also has: the store number signed into the portal, a random ID for the browser
profile, a random ID shared by browsers on the same Chrome/Firefox account, the extension and tool
versions, the browser, whether it's a test copy, and when it happened.

**Never sent:** names, email addresses, customer details, work order contents, or web addresses.

On Firefox nothing is sent unless the person allows it (Firefox asks).

## Files

- `index.html`, `app.js`, `style.css`: the stats page (plain HTML/JS, Firebase loaded from Google's
  CDN). Hosted by GitHub Pages from the `main` branch.
- `firestore.rules`: the Firestore security rules. Records can only be added with the known fields
  and can't be changed; only allowed accounts can read them or change the page's settings.

## Setup notes (Firebase project `ubif-web-extensions-analytics`)

- **Firestore rules:** Firebase console → Firestore Database → Rules → paste `firestore.rules` →
  Publish. Do this again whenever the extension sends a new kind of record or detail field, or
  Firebase will refuse those records.
- **Sign-in:** Authentication → Sign-in method → Google enabled; Authentication → Settings →
  Authorized domains includes `ubifsaiyan.github.io`.
- **Allowed accounts:** `ubifsaiyan@gmail.com` and `robert.wilkins@ubreakifix.com` are built into
  the rules. Others can be added on the page ("Who can see this page"), which saves them to
  `config/admins`.
- **Seconds saved per action:** set on the page, saved to `config/settings`.
- Billing: Blaze (pay as you go). The free daily allowance (20,000 writes, 50,000 reads) still
  applies; beyond it, cost is a few cents per 100,000 records.

## How times work

Each record has `at` (the browser's clock when it happened), `ago` (how long it waited in the
browser's queue before sending) and `received` (Firebase's clock). The page uses
`received − ago` as the time it happened, so a wrong PC clock or an offline delay doesn't move it,
and shows everything in Central time (America/Chicago).

A long date range reads every record in it, so very long ranges with many stores can take a
little while to load.
