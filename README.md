# OUTREACHER by RAWFIILE

Michael Clavier's working tools for RAWFIILE, alongside FRAME (invoices, quotes and contracts):

- **Outreach**: everyone contacted for photo and video work, their stage (To contact, Emailed, Followed up, Replied, Meeting, Won, Not now), and the one follow-up a week after the first email. "Write follow-up" opens a ready-written Gmail draft (short, no price, signed Michael Clavier) to check and send yourself. Paste a list of contacts, or import from the Notion Email Contacts database.
- **Call sheets**: date, call and wrap times, location with map, parking, transport and nearest A&E, a schedule, crew with tap-to-call numbers, kit, wardrobe and notes. Shared as a private link that works on any phone and prints cleanly to A4.
- **Briefs & moodboards**: objective, audience, deliverables, mood, colour palette, styling, locations, do and avoid, and a moodboard of photos, links and notes. Shared as a private link where the client can comment and sign the brief off. "Make call sheet" starts a call sheet from a brief.

## Autopilot

Autopilot finds London businesses that use photos and video, writes each one a short personal email in Michael's voice, sends it, follows up once in the same thread two weeks later if there is no reply, and stops as soon as someone replies.

- **Finding:** Brave web search for the targets set on the Autopilot page, page by page. Each site is read (home page and contact page) for an address on the business's own domain. Free webmail, privacy, jobs and accounts inboxes, platforms, directories and press are skipped. An optional Companies House check confirms a limited company.
- **Writing:** Claude judges the fit (0 to 10) and writes the email. Fixed rules then check every email: no price, no long dashes, no placeholders, the portfolio link, signed Michael Clavier, and an opt-out line ("reply 'no thanks'").
- **Approving:** in "Approve each email" mode new emails wait on the Autopilot page to be approved, edited or skipped. After two weeks the page suggests switching to Automatic. Follow-ups always send on their own.
- **Sending:** from a separate outreach mailbox (Gmail or Google Workspace) through the Gmail API, plain text with a List-Unsubscribe header, only on the chosen days and hours (UK time), spaced out through the day. A new mailbox warms up: 3 new emails a day in week one, 6 in week two, then the chosen limit.
- **Replies:** the inbox is checked every ten minutes. A reply moves the contact to Replied and cancels anything still queued. Opt-outs and bounces go on the do-not-contact list and are never emailed again. Out-of-office replies are ignored.
- **Scheduler:** Supabase pg_cron calls `/api/cron/tick` every ten minutes with `CRON_SECRET` (`supabase/scheduler.sql`). Each call does one small step for each account with Autopilot switched on.

UK rules: business-to-business cold email is allowed to corporate addresses when the sender is clear and every email offers an easy opt-out that is honoured. Each contact records where it was found.

## How it is built

Next.js on Vercel, with the **same Supabase project as FRAME**, so the same email and password work in both. Outreacher only uses its own `studio_*` tables and the `studio-moodboard` storage bucket. It never reads or changes FRAME's invoices, quotes, contracts or clients (it reads only the trading name from FRAME's settings for shared pages).

- Row level security: each signed-in account sees only its own rows. The browser talks to Supabase directly as the signed-in user, so the database, not the app, decides what is visible.
- Shared links: 32 random bytes made in the browser; only the SHA-256 hash is stored. A link opens one call sheet or brief through narrow database functions that return no internal ids and never the private notes. Making a new link switches the old one off.
- Moodboard images are shrunk in the browser (longest side 2000px) and stored at unguessable paths in a public bucket, so shared briefs load quickly. Only the owner can upload to or delete from their own folder.
- Comments through a brief link are capped per brief, so a leaked link cannot flood it.

## Setup

1. Supabase (the FRAME "invoice" project) > SQL Editor: run `supabase/migrations/20261023100001_studio.sql`. It only adds new things and can be run again safely.
2. Vercel: import this repo, add the variables from `.env.example`, deploy.
3. Autopilot: run `supabase/migrations/20261024000001_autopilot.sql`, then `supabase/scheduler.sql` with the real `CRON_SECRET`. Add the Autopilot variables from `.env.example` in Vercel. In Google Cloud, add `https://<this site>/api/mailbox/callback` as an authorised redirect URI on the OAuth client (publishing status "In production", or refresh tokens expire after 7 days). Then connect the outreach mailbox on the Autopilot page and switch Autopilot on.
4. Optional, Notion: create an internal integration, add `NOTION_TOKEN` in Vercel, and connect the integration to the Email Contacts database. "Import from Notion" then appears on the Outreach page; it adds new contacts, fills gaps in existing ones and only ever moves a stage forward. Marking someone as Replied here ticks "response" on their Notion row.

## Development

```
npm install
npm run dev        # http://localhost:3001
npm run lint       # type check
npm test           # unit tests
npm run test:db    # database tests: a throwaway Postgres on port 54322 with dev-harness/*.sql, FRAME's migrations and this migration loaded
```
