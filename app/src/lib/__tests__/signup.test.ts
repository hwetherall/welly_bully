import { describe, expect, it } from 'vitest'
import {
  EMPTY_SIGNUP_FORM,
  buildEnquiryPayload,
  newIdempotencyKey,
  validateSignupForm,
  type SignupFormValues,
} from '../signup'

function validValues(overrides: Partial<SignupFormValues> = {}): SignupFormValues {
  return {
    ...EMPTY_SIGNUP_FORM,
    firstName: 'Alex',
    email: 'alex@example.test',
    phone: '+1 555 0100',
    consent: true,
    ...overrides,
  }
}

describe('validateSignupForm', () => {
  it('accepts a minimal valid form (P0.2 required fields only)', () => {
    expect(validateSignupForm(validValues())).toEqual({})
  })

  it('requires firstName, email, phone, consent', () => {
    const errors = validateSignupForm(EMPTY_SIGNUP_FORM)
    expect(errors.firstName).toBeTruthy()
    expect(errors.email).toBeTruthy()
    expect(errors.phone).toBeTruthy()
    expect(errors.consent).toBeTruthy()
  })

  it('rejects malformed emails', () => {
    expect(validateSignupForm(validValues({ email: 'not-an-email' })).email).toBeTruthy()
    expect(validateSignupForm(validValues({ email: 'a@b' })).email).toBeTruthy()
    expect(validateSignupForm(validValues({ email: 'a@b.co' })).email).toBeUndefined()
  })

  it('rejects phones with too few digits', () => {
    expect(validateSignupForm(validValues({ phone: '123' })).phone).toBeTruthy()
    expect(validateSignupForm(validValues({ phone: '(303) 555-0100' })).phone).toBeUndefined()
  })

  it('does not require optional fields', () => {
    const errors = validateSignupForm(validValues({ lastName: '', pathway: '', questions: '' }))
    expect(errors).toEqual({})
  })
})

describe('buildEnquiryPayload', () => {
  it('maps the form onto the submit-enquiry body, trimming and nulling empties', () => {
    const payload = buildEnquiryPayload({
      values: validValues({ lastName: '  ', questions: '  Do I need boots?  ' }),
      idempotencyKey: 'key-1',
      utm: { utm_source: 'instagram', utm_medium: 'social' },
      landingUrl: 'https://example.test/?utm_source=instagram',
      referrer: 'https://instagram.com',
      userAgent: 'test-agent',
    })
    expect(payload.idempotencyKey).toBe('key-1')
    expect(payload.firstName).toBe('Alex')
    expect(payload.lastName).toBeNull()
    expect(payload.consent).toBe(true)
    expect(payload.preferredSessionId).toBeNull()
    expect(payload.utm).toEqual({ utm_source: 'instagram', utm_medium: 'social' })
    expect(payload.answers.questions).toBe('Do I need boots?')
    expect(payload.landingUrl).toContain('utm_source=instagram')
  })
})

describe('newIdempotencyKey', () => {
  it('returns unique UUID-shaped keys', () => {
    const a = newIdempotencyKey()
    const b = newIdempotencyKey()
    expect(a).toMatch(/^[0-9a-f-]{36}$/)
    expect(a).not.toBe(b)
  })
})
