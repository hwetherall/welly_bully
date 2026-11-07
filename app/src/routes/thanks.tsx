import { Link, createFileRoute } from '@tanstack/react-router'
import { NextSessionCard } from '../components/NextSessionCard'
import { useNextPublicEvent } from '../hooks/useNextPublicEvent'

export const Route = createFileRoute('/thanks')({
  component: ThanksPage,
})

// Confirmation page after a successful enquiry (plan P0.2 / WF-01 step 6):
// next training details + expectation that a volunteer will be in touch.
function ThanksPage() {
  const next = useNextPublicEvent() // re-fetch: the freshest next session

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-2xl font-extrabold text-white sm:text-3xl">Thanks — you’re on the list! 🎉</h1>
      <p className="mt-3 text-navy-100">
        Your enquiry is in. A Denver Bulldogs volunteer will be in touch soon to say g’day and answer
        any questions. There’s nothing you need to do until then.
      </p>

      <div className="mt-6">
        <NextSessionCard {...next} />
      </div>

      <section className="mt-6 rounded-xl bg-navy-800 p-5">
        <h2 className="font-bold text-gold-400">What to bring to your first session</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-navy-100">
          <li>Boots or grippy runners, a water bottle, and clothes you can move in</li>
          <li>We bring the footy — and a spare jersey if you need one</li>
        </ul>
      </section>

      <p className="mt-6 text-center text-sm">
        <Link to="/" className="font-semibold text-gold-400 underline">
          Back to the home page
        </Link>
      </p>
    </div>
  )
}
