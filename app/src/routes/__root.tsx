import { Link, Outlet, createRootRoute } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-navy-700 bg-navy-900">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link to="/" className="text-lg font-extrabold tracking-tight text-gold-400">
            Denver Bulldogs
          </Link>
          <nav className="flex gap-4 text-sm font-medium">
            <Link to="/" className="text-navy-100 hover:text-gold-300" activeOptions={{ exact: true }}>
              Home
            </Link>
            <Link to="/signup" className="text-navy-100 hover:text-gold-300">
              Come try footy
            </Link>
            <Link to="/admin" className="text-navy-100 hover:text-gold-300">
              Admin
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-navy-700 bg-navy-900">
        <div className="mx-auto max-w-3xl px-4 py-6 text-xs leading-relaxed text-navy-100">
          <p>
            <strong>Privacy:</strong> if you sign up, we use your name, email and phone only so a
            club volunteer can contact you about playing for the Denver Bulldogs. We never sell or
            share your details, and you can ask us to delete them at any time.
          </p>
          <p className="mt-2">© {new Date().getFullYear()} Denver Bulldogs Australian Rules Football Club</p>
        </div>
      </footer>
    </div>
  )
}
