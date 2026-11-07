import { createClient } from '@insforge/sdk'

// Single browser client for the public site + admin shell (decision D2).
// Values come from Vite env vars — see app/.env.example and app/README.md.
// The anon key is public by design; backend RLS decides what it can read/write
// (anon gets SELECT on published public events only — see the migration).
export const insforge = createClient({
  baseUrl: import.meta.env.VITE_INSFORGE_URL,
  anonKey: import.meta.env.VITE_INSFORGE_ANON_KEY,
})
