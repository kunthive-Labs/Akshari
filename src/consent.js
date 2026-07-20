// Single source of truth for the cookie/local-storage consent record described
// in /privacy.html. "necessary" (remembering the choice itself) never requires
// consent; every other category defaults to OFF until the visitor opts in.
const STORAGE_KEY = 'akshari-consent'
const CONSENT_VERSION = 1
export const REOPEN_EVENT = 'akshari:open-cookie-settings'

export function readConsent() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.version === CONSENT_VERSION ? parsed : null
  } catch {
    return null
  }
}

export function writeConsent(preferences) {
  const consent = { necessary: true, preferences: Boolean(preferences), version: CONSENT_VERSION, updatedAt: new Date().toISOString() }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(consent)) } catch { /* storage unavailable (private mode, quota) - consent stays session-only */ }
  return consent
}

export function hasPreferencesConsent() {
  return readConsent()?.preferences === true
}
