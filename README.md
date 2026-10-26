# OUTREACHER by RAWFIILE

Michael Clavier's working tools for RAWFIILE, alongside FRAME (invoices, quotes and contracts):

- **Outreach**: everyone contacted for photo and video work, their stage (To contact, Emailed, Followed up, Replied, Meeting, Won, Not now), and the one follow-up a week after the first email. "Write follow-up" opens a ready-written Gmail draft (short, no price, signed Michael Clavier) to check and send yourself. Paste a list of contacts, or import from the Notion Email Contacts database.
- **Call sheets**: date, call and wrap times, location with map, parking, transport and nearest A&E, a schedule, crew with tap-to-call numbers, kit, wardrobe and notes. Shared as a private link that works on any phone and prints cleanly to A4.
- **Briefs & moodboards**: objective, audience, deliverables, mood, colour palette, styling, locations, do and avoid, and a moodboard of photos, links and notes. Shared as a private link where the client can comment and sign the brief off. "Make call sheet" starts a call sheet from a brief.

## Autopilot

Autopilot finds London businesses that use photos and video, writes each one a short personal email in Michael's voice, sends it from rawfiile@gmail.com, follows up once in the same thread two weeks later if there is no reply, and stops as soon as someone replies. At most 7 emails a day in total (5 new businesses a day by default).

It costs nothing extra: the work is done by a **Claude scheduled task** ("Outreacher autopilot") on weekdays at about 06:40 and 13:40, using Michael's existing Gmail and Supabase connections and Claude's own web search. No API keys and no paid services. The site only stores the settings, the approval queue and the history.

- **Finding (morning run):** web searches for the targets set on the Autopilot page. Each site is read for an address on the business's own domain. Free webmail, privacy, jobs and accounts inboxes, platforms, directories and press are skipped.
- **Writing:** fit judged 0 to 10; emails follow fixed rules: no price, no long dashes, no placeholders, the portfolio link, signed Michael Clavier, and an opt-out line ("reply 'no thanks'").
- **Approving:** in "Approve each email" mode new emails wait on the Autopilot page. After two weeks the page suggests switching to Automatic. Follow-ups send on their own.
- **Replies:** each run checks rawfiile@gmail.com. A reply moves the contact to Replied and cancels anything queued. Opt-outs and bounces go on the do-not-contact list for good. Out-of-office replies are ignored.

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
3. Autopilot: run `supabase/migrations/20261024000001_autopilot.sql`, then switch Autopilot on from its page. The Claude scheduled task does the rest.
4. Optional, Notion: create an internal integration, add `NOTION_TOKEN` in Vercel, and connect the integration to the Email Contacts database. "Import from Notion" then appears on the Outreach page; it adds new contacts, fills gaps in existing ones and only ever moves a stage forward. Marking someone as Replied here ticks "response" on their Notion row.

## Development

```
npm install
npm run dev        # http://localhost:3001
npm run lint       # type check
npm test           # unit tests
npm run test:db    # database tests: a throwaway Postgres on port 54322 with dev-harness/*.sql, FRAME's migrations and this migration loaded
```
