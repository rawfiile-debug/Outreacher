import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { env } from '@/lib/env';
import { classifyReply, firstNameOf, followUpEmail } from './compose';
import { chooseEmail, isSkippedDomain, domainOf } from './emails';
import { findCompany } from './companies-house';
import { accessToken, addressOf, buildMessage, inboxSince, sendMessage } from './gmail';
import { dailyLimit, inSendWindow, londonParts, minutesBetweenSends, nextSearch, type Settings } from './schedule';
import { webSearch } from './search';
import { readSite } from './site';
import { assessAndWrite } from './writer';

// One step of the autopilot for one account. The scheduler calls this every ten minutes; each step does a little:
// check the inbox, maybe send one email, maybe create due follow-ups, maybe find a few new businesses. Small steps
// keep each run well inside the server's time limit and spread sending naturally through the day.

type Ctx = { db: SupabaseClient; owner: string; s: Settings; now: Date; deadline: number; log: string[] };

const remaining = (c: Ctx) => c.deadline - Date.now();

async function activity(c: Ctx, kind: string, message: string, contactId?: string | null) {
  await c.db.from('studio_activity').insert({ owner_id: c.owner, kind, message: message.slice(0, 500), contact_id: contactId ?? null });
  c.log.push(`${kind}: ${message}`);
}

async function suppress(c: Ctx, value: string, kind: 'email' | 'domain', reason: string) {
  await c.db.from('studio_suppressions').upsert({ owner_id: c.owner, value: value.toLowerCase(), kind, reason }, { onConflict: 'owner_id,kind,value', ignoreDuplicates: true });
}

const isSuppressed = async (c: Ctx, email: string) =>
  Boolean((await c.db.rpc('studio_is_suppressed', { p_owner: c.owner, p_email: email })).data);

// 1. Inbox: replies stop the sequence, opt-outs and bounces go on the do-not-contact list -------------------------------
async function checkInbox(c: Ctx, token: string) {
  const since = c.s.inbox_checked_at ? Math.floor(Date.parse(c.s.inbox_checked_at) / 1000) - 120 : Math.floor(c.now.getTime() / 1000) - 3 * 86400;
  const messages = await inboxSince(token, since);
  if (!messages.length) { await c.db.from('studio_autopilot').update({ inbox_checked_at: c.now.toISOString() }).eq('owner_id', c.owner); return; }
  const threads = [...new Set(messages.map((m) => m.threadId))];
  const { data: sent } = await c.db.from('studio_emails').select('contact_id, gmail_thread_id, to_email').eq('owner_id', c.owner).eq('status', 'sent').in('gmail_thread_id', threads);
  const byThread = new Map((sent || []).map((e) => [e.gmail_thread_id as string, e]));
  for (const m of messages) {
    const from = addressOf(m.from);
    let hit = byThread.get(m.threadId);
    if (!hit) {
      // A reply that started a new thread: match the sender to someone we have emailed.
      const { data } = await c.db.from('studio_emails').select('contact_id, gmail_thread_id, to_email').eq('owner_id', c.owner).eq('status', 'sent').eq('to_email', from).limit(1);
      hit = data?.[0];
    }
    if (!hit) continue;
    const kind = classifyReply({ from: m.from, subject: m.subject, snippet: m.snippet, autoSubmitted: m.autoSubmitted });
    const { data: contact } = await c.db.from('studio_contacts').select('id, name, company, stage, email').eq('id', hit.contact_id).single();
    if (!contact) continue;
    const who = contact.name || contact.company || contact.email;
    if (kind === 'auto_reply') continue;
    // Anything still waiting to go to this person is cancelled.
    await c.db.from('studio_emails').update({ status: 'cancelled', error: `stopped: ${kind}` }).eq('contact_id', contact.id).in('status', ['pending', 'approved']);
    if (kind === 'bounce') {
      await suppress(c, hit.to_email, 'email', 'bounce');
      await c.db.from('studio_contacts').update({ stage: 'Not now', notes: `Email bounced (${hit.to_email}). ` }).eq('id', contact.id);
      await activity(c, 'bounce', `${who}: the email bounced, so the address is now on the do-not-contact list.`, contact.id);
    } else if (kind === 'opt_out') {
      await suppress(c, hit.to_email, 'email', 'opt_out');
      if (from && from !== hit.to_email) await suppress(c, from, 'email', 'opt_out');
      await c.db.from('studio_contacts').update({ stage: 'Not now' }).eq('id', contact.id);
      await activity(c, 'opt_out', `${who} asked not to be contacted. They will not be emailed again.`, contact.id);
    } else if (['To contact', 'Emailed', 'Followed up'].includes(contact.stage)) {
      await c.db.from('studio_contacts').update({ stage: 'Replied' }).eq('id', contact.id);
      await activity(c, 'replied', `${who} replied: "${m.snippet.slice(0, 140)}"`, contact.id);
    }
  }
  await c.db.from('studio_autopilot').update({ inbox_checked_at: c.now.toISOString() }).eq('owner_id', c.owner);
}

// 2. Follow-ups: one, in the same thread, follow_up_days after the first email, only if nobody has replied ---------------
async function queueFollowUps(c: Ctx) {
  const cutoff = new Date(c.now.getTime() - c.s.follow_up_days * 86_400_000).toISOString();
  const { data: firsts } = await c.db.from('studio_emails').select('id, contact_id, subject, to_email, sent_at')
    .eq('owner_id', c.owner).eq('kind', 'first').eq('status', 'sent').lte('sent_at', cutoff).limit(30);
  for (const f of firsts || []) {
    const { data: existing } = await c.db.from('studio_emails').select('id').eq('contact_id', f.contact_id).eq('kind', 'follow_up').limit(1);
    if (existing?.length) continue;
    const { data: contact } = await c.db.from('studio_contacts').select('id, name, company, stage').eq('id', f.contact_id).single();
    if (!contact || contact.stage !== 'Emailed') continue;
    const d = followUpEmail({ firstName: firstNameOf(contact.name), company: contact.company, firstSubject: f.subject, senderName: c.s.sender_name, portfolioUrl: c.s.portfolio_url });
    // Follow-ups go out on their own in both modes: the first email was already approved.
    await c.db.from('studio_emails').insert({ owner_id: c.owner, contact_id: contact.id, kind: 'follow_up', status: 'approved', approved_at: c.now.toISOString(),
      to_email: f.to_email, subject: d.subject, body: d.body });
  }
}

// 3. Send at most one email per step, inside working hours, spaced out, within today's limit ----------------------------
async function sendOne(c: Ctx, token: string, fromEmail: string, perDay: number) {
  if (!inSendWindow(c.s, c.now)) return;
  if (c.s.last_send_at && c.now.getTime() - Date.parse(c.s.last_send_at) < minutesBetweenSends(c.s, perDay + 2) * 60_000) return;
  const today = londonParts(c.now).date;
  const { data: sentToday } = await c.db.from('studio_emails').select('kind, sent_at').eq('owner_id', c.owner).eq('status', 'sent')
    .gte('sent_at', new Date(c.now.getTime() - 26 * 3600_000).toISOString());
  const todays = (sentToday || []).filter((e) => londonParts(new Date(e.sent_at)).date === today);
  const firstsToday = todays.filter((e) => e.kind === 'first').length;
  if (todays.length >= perDay + 15) return; // hard ceiling on everything sent in a day

  const { data: queue } = await c.db.from('studio_emails').select('*').eq('owner_id', c.owner).eq('status', 'approved')
    .order('kind', { ascending: false }) // 'follow_up' before 'first'
    .order('approved_at').limit(5);
  const next = (queue || []).find((e) => e.kind === 'follow_up' || firstsToday < perDay);
  if (!next) return;

  const { data: contact } = await c.db.from('studio_contacts').select('*').eq('id', next.contact_id).single();
  const stillWanted = contact && (next.kind === 'first' ? contact.stage === 'To contact' : contact.stage === 'Emailed');
  if (!stillWanted || (await isSuppressed(c, next.to_email))) {
    await c.db.from('studio_emails').update({ status: 'cancelled', error: !stillWanted ? 'contact moved on' : 'on do-not-contact list' }).eq('id', next.id);
    return;
  }
  let inReplyTo: string | null = null; let threadId: string | null = null;
  if (next.kind === 'follow_up') {
    const { data: first } = await c.db.from('studio_emails').select('rfc_message_id, gmail_thread_id').eq('contact_id', next.contact_id).eq('kind', 'first').eq('status', 'sent').single();
    inReplyTo = first?.rfc_message_id ?? null; threadId = first?.gmail_thread_id ?? null;
  }
  // Claim it first so two overlapping runs can never send the same email twice.
  const { data: claimed } = await c.db.from('studio_emails').update({ attempts: (next.attempts || 0) + 1, status: 'failed', error: 'sending' })
    .eq('id', next.id).eq('status', 'approved').select('id');
  if (!claimed?.length) return;
  try {
    const msg = buildMessage({ fromName: c.s.sender_name, fromEmail, to: next.to_email, subject: next.subject, body: next.body, inReplyTo });
    const sent = await sendMessage(token, msg.raw, threadId);
    await c.db.from('studio_emails').update({ status: 'sent', error: '', sent_at: new Date().toISOString(), gmail_message_id: sent.id, gmail_thread_id: sent.threadId, rfc_message_id: msg.messageId }).eq('id', next.id);
    await c.db.from('studio_contacts').update({ stage: next.kind === 'first' ? 'Emailed' : 'Followed up' }).eq('id', next.contact_id);
    await c.db.from('studio_autopilot').update({ last_send_at: new Date().toISOString() }).eq('owner_id', c.owner);
    const who = contact.name ? `${contact.name} at ${contact.company || contact.domain}` : contact.company || next.to_email;
    await activity(c, next.kind === 'first' ? 'sent' : 'follow_up', `${next.kind === 'first' ? 'Emailed' : 'Followed up with'} ${who} (${next.to_email}).`, contact.id);
  } catch (e) {
    const err = e instanceof Error ? e.message : 'unknown error';
    // Put it back for another try unless it has failed three times.
    await c.db.from('studio_emails').update({ status: (next.attempts || 0) + 1 >= 3 ? 'failed' : 'approved', error: err.slice(0, 500) }).eq('id', next.id);
    await activity(c, 'error', `Could not send to ${next.to_email}: ${err}`, next.contact_id);
  }
}

// 4. Find new businesses until there is a couple of days' supply waiting ----------------------------------------------
async function discover(c: Ctx, perDay: number) {
  if (!env.braveKey || !env.anthropicKey) return;
  const { count: waiting } = await c.db.from('studio_emails').select('id', { count: 'exact', head: true })
    .eq('owner_id', c.owner).eq('kind', 'first').in('status', ['pending', 'approved']);
  if ((waiting ?? 0) >= Math.max(perDay, c.s.daily_new_limit) * 2) return;
  const today = londonParts(c.now).date;
  const { count: foundToday } = await c.db.from('studio_contacts').select('id', { count: 'exact', head: true })
    .eq('owner_id', c.owner).eq('source', 'autopilot').gte('created_at', `${today}T00:00:00Z`);
  if ((foundToday ?? 0) >= c.s.daily_new_limit * 2) return;

  const { data: log } = await c.db.from('studio_search_log').select('query, page').eq('owner_id', c.owner);
  const next = nextSearch(c.s.targets, log || []);
  if (!next) { await activity(c, 'info', 'Every search target has been worked through. Add new targets on the Autopilot page to keep finding businesses.'); return; }
  const results = await webSearch(next.query, next.page);
  await c.db.from('studio_search_log').insert({ owner_id: c.owner, query: next.query, page: next.page, results: results.length });

  const { data: seen } = await c.db.from('studio_seen_domains').select('domain').eq('owner_id', c.owner);
  const { data: known } = await c.db.from('studio_contacts').select('domain, email').eq('owner_id', c.owner);
  const skip = new Set([...(seen || []).map((s) => s.domain), ...(known || []).map((k) => k.domain).filter(Boolean),
    ...(known || []).map((k) => (k.email || '').split('@')[1]).filter(Boolean)]);
  const domains = [...new Set(results.map((r) => domainOf(r.url)).filter((d): d is string => Boolean(d)))];
  let added = 0;
  for (const domain of domains) {
    if (remaining(c) < 20_000) break;
    if (skip.has(domain)) continue;
    skip.add(domain);
    const mark = (outcome: string, note = '') => c.db.from('studio_seen_domains').upsert({ owner_id: c.owner, domain, outcome, note: note.slice(0, 300) }, { onConflict: 'owner_id,domain' });
    if (isSkippedDomain(domain) || domain.endsWith('.gov.uk') || domain.endsWith('.ac.uk') || domain.endsWith('.nhs.uk')) { await mark('excluded'); continue; }
    try {
      const site = await readSite(`https://${domain}/`);
      if (!site) { await mark('error', 'could not read the site'); continue; }
      const pick = chooseEmail(site.emails, site.domain);
      if (!pick) { await mark('no_email'); continue; }
      if (await isSuppressed(c, pick.email)) { await mark('suppressed'); continue; }
      const { assessment: a, email, rejected } = await assessAndWrite(site, pick.email, { senderName: c.s.sender_name, portfolioUrl: c.s.portfolio_url });
      if (!a.is_business || !a.is_london) { await mark('not_business', a.reason); continue; }
      if (a.fit < c.s.min_fit) { await mark('low_fit', `${a.fit}/10: ${a.reason}`); continue; }
      if (!email) { await mark('error', `email not usable: ${rejected}`); continue; }
      let companyNumber = '';
      if (env.companiesHouseKey) {
        const co = await findCompany(a.company_name);
        if (co) companyNumber = co.number;
        else if (c.s.require_companies_house) { await mark('not_business', 'not found on Companies House'); continue; }
      }
      const { data: contact, error } = await c.db.from('studio_contacts').insert({
        owner_id: c.owner, source: 'autopilot', name: a.contact_name, company: a.company_name || site.title.slice(0, 200), email: pick.email,
        website: site.url.slice(0, 500), domain, source_url: site.url.slice(0, 1000), research: `${a.summary} ${a.reason}`.slice(0, 2000),
        fit_score: a.fit, company_number: companyNumber, category: categoryFor(a.business_type), stage: 'To contact',
        notes: `Found by Autopilot from the search "${next.query}".`,
      }).select('id').single();
      if (error || !contact) { await mark('duplicate', error?.message || ''); continue; }
      const auto = c.s.mode === 'auto';
      await c.db.from('studio_emails').insert({ owner_id: c.owner, contact_id: contact.id, kind: 'first', status: auto ? 'approved' : 'pending',
        approved_at: auto ? c.now.toISOString() : null, to_email: pick.email, subject: email.subject, body: email.body });
      await mark('added', `${a.fit}/10`);
      await activity(c, 'found', `Found ${a.company_name || domain} (${a.business_type}, fit ${a.fit}/10). ${auto ? 'Email queued.' : 'Email waiting for your approval.'}`, contact.id);
      if (++added >= 3) break;
    } catch (e) {
      await mark('error', e instanceof Error ? e.message : 'error');
      if (e instanceof Error && /API key|not set up|limit reached/.test(e.message)) { await activity(c, 'error', e.message); break; }
    }
  }
}

function categoryFor(type: string): string {
  const t = type.toLowerCase();
  if (/agency|pr\b|social|marketing|creative/.test(t)) return 'Agency';
  if (/hotel|restaurant|bar|cafe|hospitality|venue|club/.test(t)) return 'Hospitality';
  if (/event|promot|festival|nightlife/.test(t)) return 'Events';
  if (/magazine|media|publication|radio/.test(t)) return 'Media';
  if (/brand|fashion|beauty|lifestyle|label|shop|retail/.test(t)) return 'Brand';
  return 'Other';
}

export async function runTick(opts: { budgetMs?: number; ownerId?: string } = {}) {
  const db = createSupabaseAdminClient();
  const deadline = Date.now() + (opts.budgetMs ?? 45_000);
  let q = db.from('studio_autopilot').select('*').eq('enabled', true);
  if (opts.ownerId) q = q.eq('owner_id', opts.ownerId);
  const { data: accounts } = await q;
  const report: Record<string, string[]> = {};
  for (const s of (accounts || []) as (Settings & { owner_id: string })[]) {
    const c: Ctx = { db, owner: s.owner_id, s, now: new Date(), deadline, log: [] };
    try {
      let token: string | null = null; let fromEmail = ''; let perDay = 0;
      try {
        const t = await accessToken(c.owner);
        token = t.token; fromEmail = t.mailbox.email; perDay = dailyLimit(s.daily_new_limit, t.mailbox.connected_at, c.now);
      } catch (e) { c.log.push(`mailbox: ${e instanceof Error ? e.message : e}`); }
      if (token) await checkInbox(c, token);
      await queueFollowUps(c);
      if (token) await sendOne(c, token, fromEmail, perDay);
      if (remaining(c) > 25_000) await discover(c, perDay || s.daily_new_limit);
      await db.from('studio_autopilot').update({ last_tick_at: new Date().toISOString(), last_error: '' }).eq('owner_id', c.owner);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      c.log.push(`error: ${msg}`);
      await db.from('studio_autopilot').update({ last_tick_at: new Date().toISOString(), last_error: msg.slice(0, 500) }).eq('owner_id', c.owner);
    }
    report[s.owner_id.slice(0, 8)] = c.log;
  }
  return report;
}
