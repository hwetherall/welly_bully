// functions/export-data.ts — club-owned data export (plan §9 exportability, Sprint 5).
//
// GET {base}/functions/export-data?table=people|enquiries|tasks|interactions|events|
//     attendance|milestones|participations|seasons|notification_jobs|audit_events|data_imports
// Header: Authorization: Bearer <club admin user token>
// Returns text/csv (Content-Disposition attachment). Admin role required (checked server-side
// against user_roles via the caller's token — the function itself never trusts the client).
//
// Deploy: npx -y @insforge/cli functions deploy export-data --file functions/export-data.ts

import { createClient, createAdminClient } from 'npm:@insforge/sdk';

const TABLES = [
  'people', 'enquiries', 'tasks', 'interactions', 'events', 'attendance',
  'milestones', 'participations', 'seasons', 'notification_jobs', 'audit_events', 'data_imports',
] as const;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0]);
  const header = cols.map(csvCell).join(',');
  const body = rows.map((r) => cols.map((c) => csvCell(r[c])).join(',')).join('\r\n');
  return header + '\r\n' + body + '\r\n';
}

export default async function (req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  const baseUrl = Deno.env.get('INSFORGE_BASE_URL');
  const apiKey = Deno.env.get('API_KEY');
  if (!baseUrl || !apiKey) return new Response(JSON.stringify({ error: 'secrets missing' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });

  // Authenticate the CALLER with their bearer token and check the admin role server-side.
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer /i, '');
  if (!token) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
  const userClient = createClient({ baseUrl, accessToken: token });
  const { data: me, error: meErr } = await userClient.auth.getCurrentUser();
  if (meErr || !me?.user?.id) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
  const { data: roleRows, error: roleErr } = await userClient.database
    .from('user_roles').select('roles(name)').eq('user_id', me.user.id);
  const isAdmin = !roleErr && (roleRows ?? []).some((r: { roles?: { name?: string } | null }) => r.roles?.name === 'admin');
  if (!isAdmin) return new Response(JSON.stringify({ error: 'forbidden: admin role required' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });

  const table = new URL(req.url).searchParams.get('table') ?? '';
  if (!TABLES.includes(table as (typeof TABLES)[number])) {
    return new Response(JSON.stringify({ error: 'unknown_table', tables: TABLES }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  // Admin client for the read itself (project_admin); export is logged in audit_events.
  const admin = createAdminClient({ baseUrl, apiKey });
  const { data, error } = await admin.database.from(table).select('*').order('created_at', { ascending: true, nullsFirst: false }).limit(10000);
  if (error) return new Response(JSON.stringify({ error: 'export_failed', message: error.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });

  await admin.database.from('audit_events').insert([{
    actor_id: me.user.id, action: 'data.exported', table_name: table,
    after: { rows: (data ?? []).length },
  }]);

  const csv = toCsv((data ?? []) as Record<string, unknown>[]);
  return new Response(csv, {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="bulldogs-${table}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
