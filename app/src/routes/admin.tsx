import { createFileRoute } from '@tanstack/react-router'
import { AdminLayout } from '../components/admin-chrome'

// /admin layout route (Sprint 2): auth gate + section nav live in
// components/admin-chrome.tsx; child routes render into the Outlet —
//   /admin            → routes/admin/index.tsx     (overview: action queue, jobs)
//   /admin/leads      → routes/admin/leads.tsx     (CRM lead list, P0.5)
//   /admin/leads/$id  → routes/admin/leads.$id.tsx (lead detail, P0.5)
//   /admin/dashboard  → routes/admin/dashboard.tsx (coordinator scoreboard, P0.6)
export const Route = createFileRoute('/admin')({
  component: AdminLayout,
})
