import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight, Check, Copy, MagnifyingGlass, Moon, Plus, Sun, X,
} from '@phosphor-icons/react'
import { inferTags, scoreCatalog } from '../server/search.mjs'

// A pangram: one sentence that carries every letter a to z, so each card shows
// how the whole alphabet behaves in the family, not just a single glyph.
const PANGRAM = 'The quick brown fox jumps over the lazy dog'
const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz'
const FIGURES = '1234567890 & . , ; : ! ? @ # $ % ( ) “ ”'

// Raw-shaped starter set (matching public/fonts.json), shown only if that static
// export can't be fetched. It flows through the same scoring path as the real
// catalog, so the UI behaves identically whether or not the fetch succeeds.
const FALLBACK_CATALOG = [
  { id: 'dm-sans', family: 'DM Sans', weights: [400, 500, 700], category: 'Low-contrast grotesk', description: 'Quietly capable for product interfaces.', tags: [{ tag: 'modern', confidence: 0.9 }, { tag: 'readable', confidence: 0.9 }, { tag: 'ui-product', confidence: 0.9 }], features: {} },
  { id: 'manrope', family: 'Manrope', weights: [400, 600, 800], category: 'Geometric sans', description: 'Warm structure without losing precision.', tags: [{ tag: 'geometric', confidence: 0.9 }, { tag: 'friendly', confidence: 0.9 }, { tag: 'saas', confidence: 0.9 }], features: {} },
  { id: 'space-grotesk', family: 'Space Grotesk', weights: [400, 500, 700], category: 'Neo-grotesk', description: 'A sharper edge for forward-looking tools.', tags: [{ tag: 'technical', confidence: 0.9 }, { tag: 'distinctive', confidence: 0.9 }, { tag: 'modern', confidence: 0.9 }], features: {} },
  { id: 'fraunces', family: 'Fraunces', weights: [400, 600], category: 'Old-style display', description: 'Characterful contrast for headlines with a voice.', tags: [{ tag: 'editorial', confidence: 0.9 }, { tag: 'elegant', confidence: 0.9 }, { tag: 'display', confidence: 0.9 }], features: {} },
]

const PAGE_SIZE = 48

const FILTERS = {
  Personality: ['Modern', 'Trustworthy', 'Friendly', 'Technical', 'Elegant', 'Playful'],
  Classification: ['Geometric', 'Humanist', 'Grotesk', 'Rounded', 'Monospace'],
  Context: ['UI product', 'Branding', 'Editorial', 'Display'],
}

const PRESETS = [
  ['AI / SaaS', 'modern', 'trustworthy', 'ui-product'],
  ['Editorial', 'editorial', 'elegant'],
  ['Dev tool', 'technical', 'dev-tool'],
  ['Playful', 'playful', 'friendly'],
]

function apiTag(label) { return label.toLowerCase().replaceAll(' ', '-') }
function titleCase(tag) { return tag.replaceAll('-', ' ').replace(/\b\w/g, character => character.toUpperCase()) }

// The "Copy CSS" payload, computed locally — byte-for-byte what the old
// /api/fonts/:id/export?format=css endpoint returned.
function exportCss(family, weights) {
  const list = weights?.length ? weights : [400]
  return `@import url('https://fonts.googleapis.com/css2?family=${family.replaceAll(' ', '+')}:wght@${list.join(';')}&display=swap');\n\n:root { --font-brand: '${family}', sans-serif; }`
}

function toDisplayFont(font) {
  const tags = (font.tags ?? []).map(tag => typeof tag === 'string' ? tag : tag.tag)
  const weightList = font.weights?.length ? font.weights : [400]
  const weights = font.weights?.length ? `${Math.min(...font.weights)}-${Math.max(...font.weights)}` : '400'
  return {
    id: font.id,
    name: font.family,
    googleFontsId: font.googleFontsId,
    previewUrl: font.previewUrl,
    initials: font.family.split(' ').map(word => word[0]).join('').slice(0, 2),
    category: font.category || 'Type family',
    tags: tags.slice(0, 3).map(titleCase),
    rawTags: tags,
    score: font.matchScore ?? 0,
    weights,
    weightList,
    note: font.description || 'Available in the Akshari catalog.',
  }
}

// Fontscape is a Google Fonts browser, so the honest specimen is the family set
// in its own typeface. Families load lazily (only as a card nears the viewport)
// through <link> injection, which the app's CSP allows. Chrome type is preloaded
// from index.html, so those names are skipped here.
const PRELOADED_FAMILIES = new Set(['Fraunces', 'Inter', 'Source Serif 4'])
const requestedFamilies = new Set()

function ensureFontFace(name) {
  if (!name || PRELOADED_FAMILIES.has(name) || requestedFamilies.has(name)) return
  requestedFamilies.add(name)
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, '+')}:wght@400;600&display=swap`
  document.head.append(link)
}

function useInView(ref) {
  const [inView, setInView] = useState(false)
  useEffect(() => {
    if (inView || !ref.current) return undefined
    if (!('IntersectionObserver' in window)) { setInView(true); return undefined }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setInView(true); observer.disconnect() }
    }, { rootMargin: '250px 0px' })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [inView, ref])
  return inView
}

function useSpecimenFont(name, active) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!active || !name) return undefined
    ensureFontFace(name)
    if (!('fonts' in document)) { setReady(true); return undefined }
    let cancelled = false
    const done = () => { if (!cancelled) setReady(true) }
    Promise.all([document.fonts.load(`400 24px "${name}"`), document.fonts.load(`600 24px "${name}"`)]).then(done, done)
    return () => { cancelled = true }
  }, [name, active])
  return ready
}

function Pill({ children, active, onClick }) {
  return <button type="button" className={`pill ${active ? 'is-active' : ''}`} onClick={onClick} aria-pressed={active}>{children}</button>
}

function FontCard({ font, index, compared, isTop, onPreview, onCompare }) {
  const specimenRef = useRef(null)
  const inView = useInView(specimenRef)
  const ready = useSpecimenFont(font.name, inView)
  const family = inView && ready ? `'${font.name}', var(--font-display)` : undefined
  const loading = inView && !ready

  return <article className="card font-card grain" style={{ '--i': index % 14 }}>
    <button ref={specimenRef} type="button" className={`specimen ${loading ? 'is-loading' : ''}`} onClick={() => onPreview(font)} aria-label={`Open the ${font.name} specimen`}>
      <span className="specimen-name" style={{ fontFamily: family }}>{font.name}</span>
      <span className="specimen-line" style={{ fontFamily: family }} aria-hidden="true">{PANGRAM}</span>
    </button>
    <div className="font-meta">
      <div className="font-meta-head">
        <h3 className="font-name">{font.name}</h3>
        {font.score > 0 && <span className={`match ${isTop ? 'is-top' : ''}`}>{isTop ? `Top match · ${font.score}%` : `${font.score}%`}</span>}
      </div>
      <p className="font-sub">{font.category}{font.weights ? ` · ${font.weights}` : ''}</p>
      <div className="tags">{font.tags.map(tag => <span key={tag} className="tag">{tag}</span>)}</div>
      <div className="card-actions">
        <button type="button" className="btn-ghost" onClick={() => onPreview(font)}>Preview <ArrowRight size={14} /></button>
        <button type="button" className={`btn-ghost ${compared ? 'is-added' : ''}`} onClick={() => onCompare(font)} aria-pressed={compared}>
          {compared ? <><Check size={14} weight="bold" /> Added</> : <><Plus size={14} weight="bold" /> Compare</>}
        </button>
      </div>
    </div>
  </article>
}

function PreviewDialog({ font, pageTheme, onClose }) {
  const [previewTheme, setPreviewTheme] = useState(pageTheme)
  const [size, setSize] = useState(44)
  const [weight, setWeight] = useState(400)
  const [sample, setSample] = useState(PANGRAM)
  const [copied, setCopied] = useState(false)
  const dialogRef = useRef(null)
  const ready = useSpecimenFont(font.name, true)
  const family = ready ? `'${font.name}', var(--font-display)` : 'var(--font-display)'

  // Trap Tab focus inside the dialog and restore focus to the trigger on close.
  useEffect(() => {
    const node = dialogRef.current
    if (!node) return undefined
    const previouslyFocused = document.activeElement
    const getFocusable = () => Array.from(
      node.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
    ).filter(element => !element.disabled && element.offsetParent !== null)
    getFocusable()[0]?.focus()
    const onKeyDown = event => {
      if (event.key !== 'Tab') return
      const items = getFocusable()
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    node.addEventListener('keydown', onKeyDown)
    return () => {
      node.removeEventListener('keydown', onKeyDown)
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [])

  const copy = async () => {
    await navigator.clipboard?.writeText(exportCss(font.name, font.weightList))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return <div className="modal" role="presentation" onMouseDown={onClose}>
    <section ref={dialogRef} className="card dialog" data-theme={previewTheme} role="dialog" aria-modal="true" aria-labelledby="dialog-title" onMouseDown={event => event.stopPropagation()}>
      <header className="dialog-head">
        <div>
          <span className="section-label eyebrow">Live specimen</span>
          <h2 className="dialog-title" id="dialog-title">{font.name}</h2>
          <p className="dialog-sub">{font.note}</p>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close specimen"><X size={20} /></button>
      </header>

      <div className="dialog-controls">
        <div className="segmented" role="group" aria-label="Specimen paper">
          <button type="button" className={previewTheme === 'light' ? 'is-active' : ''} onClick={() => setPreviewTheme('light')} aria-pressed={previewTheme === 'light'}><Sun size={14} /> Light</button>
          <button type="button" className={previewTheme === 'dark' ? 'is-active' : ''} onClick={() => setPreviewTheme('dark')} aria-pressed={previewTheme === 'dark'}><Moon size={14} /> Dark</button>
        </div>
        <label className="control">Size <input type="range" min="24" max="96" value={size} onChange={event => setSize(Number(event.target.value))} aria-label="Preview size in pixels" /><output>{size}px</output></label>
        <label className="control">Weight <select value={weight} onChange={event => setWeight(Number(event.target.value))}><option value={400}>Regular</option><option value={600}>Semibold</option></select></label>
      </div>

      <div className="tester" style={{ '--tester-family': family, '--tester-size': `${size}px`, '--tester-weight': weight }}>
        <input className="tester-input" value={sample} onChange={event => setSample(event.target.value)} aria-label="Type your own preview text" spellCheck="false" placeholder="Type anything to test it" />
        <div className="tester-grid">
          <p className="tester-set"><span className="glyph-label">Uppercase</span>{UPPERCASE}</p>
          <p className="tester-set"><span className="glyph-label">Lowercase</span>{LOWERCASE}</p>
          <p className="tester-set"><span className="glyph-label">Figures and symbols</span>{FIGURES}</p>
        </div>
      </div>

      <footer className="dialog-foot">
        <span className="meta">{font.category} · Google Fonts · OFL</span>
        <button type="button" className={`btn-primary ${copied ? 'is-success' : ''}`} onClick={copy}>{copied ? <Check size={16} weight="bold" /> : <Copy size={15} />}{copied ? 'Copied CSS' : 'Copy CSS'}</button>
      </footer>
    </section>
  </div>
}

function App() {
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState(FALLBACK_CATALOG)
  const [loading, setLoading] = useState(true)
  const [catalogMessage, setCatalogMessage] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  // Default to light mode; only honour an explicit saved preference.
  const [theme, setTheme] = useState(() => localStorage.getItem('fontscape-theme') || 'light')
  const [activeTags, setActiveTags] = useState([])
  const [sort, setSort] = useState('match')
  const [previewFont, setPreviewFont] = useState(null)
  const [compared, setCompared] = useState([])
  const [toast, setToast] = useState('')

  useEffect(() => {
    const keydown = event => {
      if (event.key === '/' && document.activeElement?.tagName !== 'INPUT') { event.preventDefault(); document.getElementById('font-search')?.focus() }
      if (event.key === 'Escape') setPreviewFont(null)
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    localStorage.setItem('fontscape-theme', theme)
  }, [theme])

  // Load the whole catalog once, straight from the static export. Every search,
  // score, and page after this runs in the browser — no API, no round trips.
  useEffect(() => {
    const controller = new AbortController()
    fetch('/fonts.json', { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('Catalog unavailable'); return response.json() })
      .then(fonts => { if (Array.isArray(fonts) && fonts.length) setCatalog(fonts) })
      .catch(error => { if (error.name !== 'AbortError') setCatalogMessage('Showing the local starter set while the catalog reconnects.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  // A new query or filter set starts pagination over at the first page.
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [query, activeTags])

  const results = useMemo(() => {
    const scored = scoreCatalog(catalog, query, activeTags.map(apiTag))
    const ordered = sort === 'name' ? [...scored].sort((a, b) => a.family.localeCompare(b.family)) : scored
    return ordered.map(toDisplayFont)
  }, [catalog, query, activeTags, sort])

  const inferredMessage = useMemo(() => {
    const inferred = inferTags(query)
    return inferred.length ? `Matched on ${inferred.map(titleCase).join(', ')}` : ''
  }, [query])

  const totalResults = results.length
  const shown = useMemo(() => results.slice(0, visibleCount), [results, visibleCount])
  const statusMessage = loading ? 'Reading the catalog' : (inferredMessage || catalogMessage || 'Every family, arranged by fit')

  const toggleTag = tag => setActiveTags(current => current.includes(tag) ? current.filter(item => item !== tag) : [...current, tag])
  const notify = message => { setToast(message); window.setTimeout(() => setToast(''), 2200) }
  const loadMore = () => setVisibleCount(current => Math.min(current + PAGE_SIZE, totalResults))
  const toggleCompare = font => setCompared(current => current.some(item => item.name === font.name) ? current.filter(item => item.name !== font.name) : current.length < 4 ? [...current, font] : current)

  return <div className="app-shell">
    <a className="skip-link" href="#results">Skip to results</a>

    <header className="topbar">
      <a className="brand" href="#top" aria-label="Akshari home"><img className="brand-mark" src="/brand-mark.png" alt="" width="28" height="28" /><span className="brand-name">Akshari</span></a>
      <nav className="topnav" aria-label="Primary">
        <a className="is-active" href="#top">Discover</a>
        <a href="#results">Catalog</a>
        <a href="https://github.com/kunthive-Labs/Akshari">About</a>
      </nav>
      <div className="top-actions">
        <button type="button" className="search-shortcut" onClick={() => document.getElementById('font-search')?.focus()}><MagnifyingGlass size={15} /> Search <kbd>/</kbd></button>
        <button type="button" className="theme-toggle" onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>{theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}<span>{theme === 'dark' ? 'Light' : 'Dark'}</span></button>
      </div>
    </header>

    <div className="app-body" id="top">
      <aside className="sidebar" aria-label="Filters and directions">
        <div className="sidebar-scroll">
          <div className="side-intro">
            <span className="section-label eyebrow">Type discovery</span>
            <h1 className="side-title">Choose type with <em>confidence.</em></h1>
            <p className="side-lead">Read every letter in a live specimen before you commit.</p>
          </div>

          <div className="side-block">
            <div className="filter-head">
              <span className="section-label">Refine</span>
              {activeTags.length > 0 && <button type="button" className="filter-clear" onClick={() => setActiveTags([])}>Clear</button>}
            </div>
            {Object.entries(FILTERS).map(([group, tags]) => <div className="filter-group" key={group}><h4>{group}</h4><div className="pill-row">{tags.map(tag => <Pill key={tag} active={activeTags.includes(tag)} onClick={() => toggleTag(tag)}>{tag}</Pill>)}</div></div>)}
          </div>

          <div className="side-block">
            <span className="section-label">Try a direction</span>
            <div className="side-presets">{PRESETS.map(([name, ...tags]) => <button key={name} type="button" className="side-preset" onClick={() => { setQuery(''); setActiveTags(tags.map(titleCase)) }}><strong>{name}</strong><span>{tags.map(titleCase).join(', ')}</span></button>)}</div>
          </div>

          <nav className="side-footer" aria-label="Footer">
            <a href="/terms.html">Terms</a>
            <a href="/privacy.html">Privacy</a>
            <a href="https://github.com/kunthive-Labs/Akshari">Contribute</a>
          </nav>
        </div>
      </aside>

      <main className="workspace">
        <div className="workspace-head">
          <label className="search-box grain" htmlFor="font-search">
            <MagnifyingGlass size={22} />
            <input id="font-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Describe what you need, like “warm, trustworthy fintech”" />
            <kbd>/</kbd>
          </label>
          {!query && <div className="suggestions">
            <span>Try</span>
            {['Modern and trustworthy', 'Warm and human', 'Technical and precise'].map(term => <button key={term} type="button" onClick={() => setQuery(term)}>{term}</button>)}
          </div>}
          <div className="workspace-bar">
            <div>
              <span className="results-status" aria-live="polite">{statusMessage}</span>
              <h2 className="results-count">{shown.length.toLocaleString()} {shown.length === 1 ? 'family' : 'families'}</h2>
            </div>
            <label className="sort">Sort <select value={sort} onChange={event => setSort(event.target.value)}><option value="match">Best match</option><option value="name">A to Z</option></select></label>
          </div>
          {activeTags.length > 0 && <div className="active-filters">{activeTags.map(tag => <Pill key={tag} active onClick={() => toggleTag(tag)}>{tag} <X size={12} /></Pill>)}</div>}
        </div>

        <div className="workspace-scroll" id="results" tabIndex={-1}>
          {shown.length ? <div className={`font-grid ${loading ? 'is-busy' : ''}`} aria-busy={loading}>
            {shown.map((font, index) => <FontCard key={font.id || font.name} font={font} index={index} isTop={sort === 'match' && index === 0 && font.score > 0} compared={compared.some(item => item.name === font.name)} onPreview={setPreviewFont} onCompare={toggleCompare} />)}
          </div> : <div className="card empty grain"><h3>No families in that direction</h3><p>Try fewer filters, or describe the job the type needs to do.</p><button type="button" className="btn-ghost" onClick={() => { setQuery(''); setActiveTags([]) }}>Reset search</button></div>}
          {shown.length > 0 && shown.length < totalResults && <div className="load-more"><p>Showing {shown.length.toLocaleString()} of {totalResults.toLocaleString()}</p><button type="button" className="btn-primary" onClick={loadMore}>Show {PAGE_SIZE} more <ArrowRight size={15} /></button></div>}
        </div>
      </main>
    </div>

    {compared.length > 0 && <aside className="card compare-tray grain" aria-live="polite">
      <div className="tray-label"><span>Compare</span><strong>{compared.length} of 4</strong></div>
      <div className="tray-items">{compared.map(font => <div key={font.name} className="tray-item">
        <button type="button" className="tray-open" onClick={() => setPreviewFont(font)}><span aria-hidden="true">{font.initials}</span>{font.name}</button>
        <button type="button" className="tray-remove" aria-label={`Remove ${font.name}`} onClick={() => toggleCompare(font)}><X size={13} /></button>
      </div>)}</div>
      <button type="button" className="btn-primary" onClick={() => notify('Comparison view is ready for the selected families.')}>Compare <ArrowRight size={15} /></button>
    </aside>}
    {previewFont && <PreviewDialog font={previewFont} pageTheme={theme} onClose={() => setPreviewFont(null)} />}
    {toast && <div className="toast" role="status"><Check size={15} weight="bold" />{toast}</div>}
  </div>
}

export default App
