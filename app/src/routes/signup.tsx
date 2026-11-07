import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { insforge } from '../lib/insforge'
import { fetchUpcomingPublicEvents } from '../lib/events'
import { formatEventDate, formatEventTimeRange } from '../lib/format'
import { parseUtm } from '../lib/utm'
import {
  EMPTY_SIGNUP_FORM,
  EXPERIENCE_LEVELS,
  PATHWAYS,
  buildEnquiryPayload,
  newIdempotencyKey,
  validateSignupForm,
  type SignupFieldError,
  type SignupFormValues,
} from '../lib/signup'
import type { PublicEvent } from '../lib/types'

export const Route = createFileRoute('/signup')({
  component: SignupPage,
})

// Low-friction sign-up (plan P0.2 → WF-01). Writes go through the `submit-enquiry`
// edge function (anon has no direct table writes — decision D3).
function SignupPage() {
  const navigate = useNavigate()
  const [values, setValues] = useState<SignupFormValues>(EMPTY_SIGNUP_FORM)
  const [errors, setErrors] = useState<SignupFieldError>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sessions, setSessions] = useState<PublicEvent[]>([])

  // One idempotency key per page load; a retried submit reuses it (WF-01 idempotency).
  const idempotencyKey = useMemo(() => newIdempotencyKey(), [])

  useEffect(() => {
    // Preferred-session select lists published public upcoming events.
    void fetchUpcomingPublicEvents(10).then(({ events }) => setSessions(events))
  }, [])

  const set = <K extends keyof SignupFormValues>(key: K, value: SignupFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setServerError(null)

    // Honeypot: if the hidden field is filled, this is a bot — silently "succeed"
    // without writing anything (plan P0.2 anti-spam).
    if (values.website.trim() !== '') {
      await navigate({ to: '/thanks' })
      return
    }

    const validation = validateSignupForm(values)
    setErrors(validation)
    if (Object.keys(validation).length > 0) return

    setSubmitting(true) // disable double-submit
    try {
      const body = buildEnquiryPayload({
        values,
        idempotencyKey,
        utm: parseUtm(window.location.search),
        landingUrl: window.location.href,
        referrer: document.referrer || null,
        userAgent: navigator.userAgent,
      })
      const { error } = await insforge.functions.invoke('submit-enquiry', { body })
      if (error) {
        setServerError(error.message || 'Something went wrong. Please try again.')
        return
      }
      await navigate({ to: '/thanks' })
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass =
    'mt-1 w-full rounded-lg border border-navy-100 bg-white px-3 py-2 text-base text-navy-900 shadow-sm focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-400'
  const labelClass = 'block text-sm font-semibold text-navy-800'
  const errorClass = 'mt-1 text-sm font-medium text-burgundy-700'

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-2xl font-extrabold text-white sm:text-3xl">Come try footy</h1>
      <p className="mt-2 text-sm text-navy-100">
        Fill this in and a Denver Bulldogs volunteer will get in touch about playing. No experience
        needed — promise.
      </p>

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4 rounded-xl bg-white p-5 shadow">
        {serverError && (
          <div role="alert" className="rounded-lg bg-burgundy-100 p-3 text-sm font-medium text-burgundy-800">
            {serverError}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="firstName" className={labelClass}>
              First name *
            </label>
            <input
              id="firstName"
              name="firstName"
              type="text"
              autoComplete="given-name"
              required
              value={values.firstName}
              onChange={(e) => set('firstName', e.target.value)}
              aria-invalid={!!errors.firstName}
              aria-describedby={errors.firstName ? 'firstName-error' : undefined}
              className={inputClass}
            />
            {errors.firstName && (
              <p id="firstName-error" className={errorClass}>
                {errors.firstName}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="lastName" className={labelClass}>
              Last name <span className="font-normal text-navy-600">(optional)</span>
            </label>
            <input
              id="lastName"
              name="lastName"
              type="text"
              autoComplete="family-name"
              value={values.lastName}
              onChange={(e) => set('lastName', e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label htmlFor="email" className={labelClass}>
            Email *
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={values.email}
            onChange={(e) => set('email', e.target.value)}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? 'email-error' : undefined}
            className={inputClass}
          />
          {errors.email && (
            <p id="email-error" className={errorClass}>
              {errors.email}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="phone" className={labelClass}>
            Phone *
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            required
            value={values.phone}
            onChange={(e) => set('phone', e.target.value)}
            aria-invalid={!!errors.phone}
            aria-describedby={errors.phone ? 'phone-error' : undefined}
            className={inputClass}
          />
          {errors.phone && (
            <p id="phone-error" className={errorClass}>
              {errors.phone}
            </p>
          )}
        </div>

        {sessions.length > 0 && (
          <div>
            <label htmlFor="preferredSessionId" className={labelClass}>
              Preferred first session <span className="font-normal text-navy-600">(optional)</span>
            </label>
            <select
              id="preferredSessionId"
              name="preferredSessionId"
              value={values.preferredSessionId}
              onChange={(e) => set('preferredSessionId', e.target.value)}
              className={inputClass}
            >
              <option value="">No preference — surprise me</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} — {formatEventDate(s.starts_at, s.time_zone)},{' '}
                  {formatEventTimeRange(s.starts_at, s.ends_at, s.time_zone)}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="experience" className={labelClass}>
              Aussie rules experience
            </label>
            <select
              id="experience"
              name="experience"
              value={values.experience}
              onChange={(e) => set('experience', e.target.value)}
              className={inputClass}
            >
              {EXPERIENCE_LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="pathway" className={labelClass}>
              I’m interested in <span className="font-normal text-navy-600">(optional)</span>
            </label>
            <select
              id="pathway"
              name="pathway"
              value={values.pathway}
              onChange={(e) => set('pathway', e.target.value)}
              className={inputClass}
            >
              <option value="">Not sure yet</option>
              {PATHWAYS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="questions" className={labelClass}>
            Anything you’d like to ask? <span className="font-normal text-navy-600">(optional)</span>
          </label>
          <textarea
            id="questions"
            name="questions"
            rows={3}
            value={values.questions}
            onChange={(e) => set('questions', e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="howHeard" className={labelClass}>
            How did you hear about us? <span className="font-normal text-navy-600">(optional)</span>
          </label>
          <input
            id="howHeard"
            name="howHeard"
            type="text"
            value={values.howHeard}
            onChange={(e) => set('howHeard', e.target.value)}
            className={inputClass}
          />
        </div>

        {/* Honeypot — hidden from humans, bots fill it in */}
        <div className="hidden" aria-hidden="true">
          <label htmlFor="website">Website</label>
          <input
            id="website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={values.website}
            onChange={(e) => set('website', e.target.value)}
          />
        </div>

        <div>
          <div className="flex items-start gap-2">
            <input
              id="consent"
              name="consent"
              type="checkbox"
              required
              checked={values.consent}
              onChange={(e) => set('consent', e.target.checked)}
              aria-invalid={!!errors.consent}
              aria-describedby="consent-disclosure consent-error"
              className="mt-1 h-4 w-4 rounded border-navy-100"
            />
            <label htmlFor="consent" id="consent-disclosure" className="text-sm text-navy-800">
              I agree that a Denver Bulldogs volunteer may contact me by email or phone about playing
              for the club. * We only use your details for that, and you can opt out any time.
            </label>
          </div>
          {errors.consent && (
            <p id="consent-error" className={errorClass} role="alert">
              {errors.consent}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl bg-gold-500 px-6 py-3 text-base font-bold text-navy-950 shadow hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Sending…' : 'Sign up — come try footy'}
        </button>
        <p className="text-center text-xs text-navy-600">
          By signing up you agree to be contacted about playing. See our privacy note in the footer.{' '}
          <Link to="/" className="underline">
            Back to home
          </Link>
        </p>
      </form>
    </div>
  )
}
