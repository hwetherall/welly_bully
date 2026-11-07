// /signup form model: values, client validation, and the request body for the
// `submit-enquiry` edge function (which maps it onto RPC public.submit_enquiry —
// see migrations/20261107211910_bulldogs-core-schema.sql).
// Pure functions only, so vitest can cover them without a browser.

import type { UtmParams } from './utm'

export const PATHWAYS = [
  { value: 'mens', label: "Men's" },
  { value: 'womens', label: "Women's" },
  { value: 'mixed', label: 'Mixed / coed' },
  { value: 'social', label: 'Social — just come along' },
] as const

export const EXPERIENCE_LEVELS = [
  { value: 'none', label: 'None — never played' },
  { value: 'some', label: 'Some — casual kick around' },
  { value: 'played', label: 'Played before' },
] as const

export interface SignupFormValues {
  firstName: string
  lastName: string
  email: string
  phone: string
  consent: boolean
  preferredSessionId: string // '' = no preference
  experience: string
  pathway: string
  questions: string
  howHeard: string
  website: string // honeypot — must stay empty (anti-spam, plan P0.2)
}

export const EMPTY_SIGNUP_FORM: SignupFormValues = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  consent: false,
  preferredSessionId: '',
  experience: 'none',
  pathway: '',
  questions: '',
  howHeard: '',
  website: '',
}

export type SignupFieldError = Partial<
  Record<'firstName' | 'email' | 'phone' | 'consent', string>
>

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Required per plan P0.2: first name, email, phone, consent. */
export function validateSignupForm(v: SignupFormValues): SignupFieldError {
  const errors: SignupFieldError = {}
  if (!v.firstName.trim()) errors.firstName = 'Please tell us your first name.'
  if (!EMAIL_RE.test(v.email.trim())) errors.email = 'Enter a valid email address.'
  // loose phone check: at least 7 digits, any formatting
  if (v.phone.replace(/\D/g, '').length < 7) errors.phone = 'Enter a valid phone number.'
  if (!v.consent)
    errors.consent = 'We need your consent before a club volunteer can contact you.'
  return errors
}

/** Body sent to edge function `submit-enquiry` (WF-01). */
export interface EnquiryPayload {
  idempotencyKey: string
  firstName: string
  lastName: string | null
  email: string
  phone: string
  consent: boolean
  howHeard: string | null
  preferredSessionId: string | null
  landingUrl: string
  referrer: string | null
  utm: UtmParams
  answers: {
    experience: string
    pathway: string
    questions: string
  }
  userAgent: string
}

export function buildEnquiryPayload(args: {
  values: SignupFormValues
  idempotencyKey: string
  utm: UtmParams
  landingUrl: string
  referrer: string | null
  userAgent: string
}): EnquiryPayload {
  const { values, idempotencyKey, utm, landingUrl, referrer, userAgent } = args
  return {
    idempotencyKey,
    firstName: values.firstName.trim(),
    lastName: values.lastName.trim() || null,
    email: values.email.trim(),
    phone: values.phone.trim(),
    consent: values.consent,
    howHeard: values.howHeard.trim() || null,
    preferredSessionId: values.preferredSessionId || null,
    landingUrl,
    referrer: referrer || null,
    utm,
    answers: {
      experience: values.experience,
      pathway: values.pathway,
      questions: values.questions.trim(),
    },
    userAgent,
  }
}

/** One idempotency key per page load (plan WF-01: retries reuse it). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  // fallback for very old browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}
