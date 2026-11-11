# OUTREACHER by RAWFIILE

One job: find businesses that could hire Michael Clavier (RAWFIILE) for photo and video work, email them from rawfiile@gmail.com, follow up once, and stop the moment anyone replies.

Three pages:

- **Today**: emails waiting for approval (read, edit, approve or skip), emails queued to send, and what happened (found, sent, replied, opted out, bounced).
- **Contacts**: everyone found or added, and their stage (To contact, Emailed, Followed up, Replied, Meeting, Won, Not now). Add someone by hand and Autopilot writes their first email on its next morning run.
- **Settings**: Autopilot on or off, Approve each email or Automatic, how many new businesses a day, when to follow up, search targets, the work emails may mention, and the do-not-contact list.

## How it works

The work is done by a **Claude scheduled task** ("Outreacher autopilot") on weekdays at about 06:40 and 13:40 London time, using Michael's Gmail, Google Drive and Supabase connections and Claude's own web search. No API keys and nothing that costs money. This site only holds the settings, the approval queue and the history.

- **Finding**: searches the targets in Settings, reads each business's own site for an address on its own domain, and judges fit 0 to 10. Webmail, privacy, jobs, accounts and customer-service inboxes are never used.
- **Writing**: the five line cold email method, in Michael's wording rules. No price, no attachments in the first email, website and IG lines, signed Michael Clavier, with an opt-out line.
- **Sending**: at most 7 emails a London day. In Approve mode nothing new sends until approved here; after two weeks the app suggests switching to Automatic.
- **Following up**: one follow-up in the same thread after the set number of days (14 by default), with the RAWFIILE one-pager from Drive attached.
- **Replies**: a reply moves the contact to Replied and cancels anything queued. Opt-outs and bounces go on the do-not-contact list for good. Out-of-office replies are ignored.

## Built with

Next.js on Vercel and the **same Supabase project as FRAME** (same sign-in). Outreacher only uses its own `outreach_*` tables. Row level security means each account sees only its own rows, and an email can only be edited in the app before it is sent.

## Setup

1. Supabase (the FRAME "invoice" project) > SQL Editor: run `supabase/migrations/20261111000001_fresh_start.sql`. It removes the old version's tables (call sheets, briefs, the old tracker), keeps the old Autopilot settings, and can be run again safely.
2. Vercel: add the variables from `.env.example` and deploy.
3. Switch Autopilot on in Settings.

## Development

```
npm install
npm run dev     # http://localhost:3001
npm run lint    # type check
npm test
```
