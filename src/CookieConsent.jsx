import { useEffect, useRef, useState } from 'react'
import { readConsent, writeConsent, REOPEN_EVENT } from './consent.js'

// Shown until a choice is recorded, and reopenable any time afterwards via the
// "Cookie settings" footer link (which dispatches REOPEN_EVENT). Accept and
// reject are the same size and weight throughout - regulators treat a
// visually-bigger "accept" next to a muted "reject" link as a dark pattern.
function CookieConsent({ onConsentChange }) {
  const [status, setStatus] = useState(() => (readConsent() ? 'hidden' : 'banner'))
  const [managing, setManaging] = useState(false)
  const [preferencesChecked, setPreferencesChecked] = useState(() => readConsent()?.preferences ?? false)
  const primaryRef = useRef(null)

  useEffect(() => {
    if (status === 'banner') primaryRef.current?.focus()
  }, [status, managing])

  useEffect(() => {
    const reopen = () => {
      setPreferencesChecked(readConsent()?.preferences ?? false)
      setManaging(true)
      setStatus('banner')
    }
    window.addEventListener(REOPEN_EVENT, reopen)
    return () => window.removeEventListener(REOPEN_EVENT, reopen)
  }, [])

  useEffect(() => {
    if (status !== 'banner') return undefined
    const onKeyDown = event => { if (event.key === 'Escape' && managing) setManaging(false) }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [status, managing])

  if (status === 'hidden') return null

  const settle = preferences => {
    writeConsent(preferences)
    onConsentChange?.()
    setStatus('hidden')
    setManaging(false)
  }

  return <div className="cookie-banner card grain" role="dialog" aria-modal="false" aria-labelledby="cookie-title" aria-describedby="cookie-desc">
    <div className="cookie-body">
      <h2 className="cookie-title" id="cookie-title">Cookies &amp; local storage</h2>
      <p className="cookie-desc" id="cookie-desc">
        Akshari runs no ads or analytics. With your permission we store your light/dark preference locally so it's there on your next visit - nothing else leaves your device. <a href="/privacy.html">Read the privacy notice</a>.
      </p>
      {managing && <div className="cookie-options" role="group" aria-label="Cookie categories">
        <label className="cookie-option">
          <div>
            <span className="cookie-option-name">Necessary</span>
            <span className="cookie-option-note">Remembers this choice so we don't ask every visit. Always on.</span>
          </div>
          <input type="checkbox" checked disabled aria-label="Necessary storage, always on" />
        </label>
        <label className="cookie-option">
          <div>
            <span className="cookie-option-name">Preferences</span>
            <span className="cookie-option-note">Remembers your light/dark appearance between visits.</span>
          </div>
          <input type="checkbox" checked={preferencesChecked} onChange={event => setPreferencesChecked(event.target.checked)} aria-label="Preferences storage" />
        </label>
      </div>}
    </div>
    <div className="cookie-actions">
      {!managing && <button type="button" className="btn-ghost cookie-manage" onClick={() => setManaging(true)}>Manage preferences</button>}
      {managing
        ? <button type="button" className="cookie-btn cookie-btn-fill" ref={primaryRef} onClick={() => settle(preferencesChecked)}>Save choices</button>
        : <>
            <button type="button" className="cookie-btn cookie-btn-outline" onClick={() => settle(false)}>Reject all</button>
            <button type="button" className="cookie-btn cookie-btn-fill" ref={primaryRef} onClick={() => settle(true)}>Accept all</button>
          </>}
    </div>
  </div>
}

export default CookieConsent
