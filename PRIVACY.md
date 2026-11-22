# uBiF Web Extensions — Privacy Policy

Last updated: November 21, 2026

uBiF Web Extensions is a set of tools for uBreakiFix store staff. This policy explains what the
extension does with information.

## What stays on your computer

The extension reads the uBreakiFix NextGen Portal, eBay and Amazon pages you open so it can
improve them (for example, showing part names or warning about a listing). It saves your
settings, your eBay seller blacklist and cached part names in your browser's own storage. Your
settings may sync between your own computers through your Chrome or Firefox account. None of
this is sent to the developer or anyone else.

## Usage stats

To show how much time the tools save, the extension counts how often they are used and sends those
counts to the developer's Google Firebase database (project "uBiF Web Extensions Analytics"). Each
record contains only:

- which tool and what happened (for example "Autocomplete Service: reached Checkout", "Auto-Confirm
  Serial: confirmed", "IMEI Autofill: filled", "GD Exception: form submitted"), and for Autocomplete
  Service the type of service (for example "Verizon In-Person Device Refresh"), how long the run
  took, where it started, and a short code for why it stopped; for the Verizon free accessory
  reminder, what was missing, which button was pressed and the $15 reimbursement it may have saved;
- the uBreakiFix store number you're signed into in the portal;
- a random ID for this browser profile and a random ID shared by browsers signed into the same
  Chrome or Firefox account (not linked to your name or email);
- the extension and tool versions, the browser name and version, and whether it's a test copy;
- the date and time it happened.

Once a day each copy also sends a check-in with the same IDs, store number and versions, plus which
tools are switched on and which are switched off, each with its version number. **No names, email addresses, customer information, work order contents or web
addresses are sent.** The records can only be read by the developer's stats page, signed in with
an allowed Google account, and are used only to measure usage and time saved and to find problems.
They are never sold or shared for any other purpose.

On Firefox nothing is sent unless you allow "technical and interaction data" (Firefox asks when you
install, the toolbar menu asks once, and Settings → Usage stats can change it any time).

## What is sent, and only when you choose to

If you use the **Feedback** button and press **Send**, the extension sends what you typed (the
type of feedback, tool, subject, message, and the name and email address if you entered them),
together with the extension version, your browser and operating system, and which tools are
switched on. It is delivered by email to the developer (ubifsaiyan@gmail.com) through the
Web3Forms service (web3forms.com). It is used only to fix problems and consider feature
requests, and is never sold or shared for any other purpose.

If you choose "Open in Outlook" or "Open in Gmail" instead, the message is sent from your own
email account, and that service's privacy policy applies.

If you press **File GD Exception** on a work order, the extension reads that work order (GSPN
ticket number, IMEI, device model) and your portal login (your name and email, the store number and
store email) and types them into Samsung's exception request form on forms-prod.sprinklr.com — the
same form you would otherwise fill in by hand. You review the form and submit it yourself. That
information goes to Samsung only, when you press the button, and is kept in your browser's storage
only for the moment it takes to open the form. Once the form is filled in, the extension presses
Submit for you (you can switch this off in Settings), and when Samsung's confirmation appears it
adds that confirmation text (with Samsung's ticket number) to the work order's notes in the portal. **Create GSPN Ticket** asks the portal to create a
GSPN ticket for the work order, exactly as the portal's own link does; nothing leaves the portal.

## Contact

Questions about this policy: ubifsaiyan@gmail.com
