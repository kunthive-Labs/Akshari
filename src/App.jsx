import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight, Check, Copy, MagnifyingGlass, Moon, Plus,
  Sparkle, Sun, X,
} from '@phosphor-icons/react'

const FALLBACK_FONTS = [
  { name: 'Satoshi', className: 'satoshi', initials: 'Sa', category: 'Neo-grotesk', tags: ['Modern', 'Trustworthy', 'UI product'], rawTags: ['modern', 'trustworthy', 'ui-product'], score: 94, detail: 'Open apertures, high x-height', weights: '400-900', note: 'Clear and confident at small sizes.' },
  { name: 'Manrope', className: 'manrope', initials: 'Ma', category: 'Geometric sans', tags: ['Geometric', 'Friendly', 'SaaS'], rawTags: ['geometric', 'friendly', 'saas'], score: 91, detail: 'Rounded forms, low contrast', weights: '400-800', note: 'Warm structure without losing precision.' },
  { name: 'DM Sans', className: 'dm', initials: 'DM', category: 'Low-contrast grotesk', tags: ['Modern', 'Readable', 'UI product'], rawTags: ['modern', 'readable', 'ui-product'], score: 89, detail: 'Wide aperture, sturdy rhythm', weights: '400-700', note: 'Quietly capable for product interfaces.' },
  { name: 'Space Grotesk', className: 'space', initials: 'SG', category: 'Neo-grotesk', tags: ['Technical', 'Distinctive', 'Modern'], rawTags: ['technical', 'distinctive', 'modern'], score: 84, detail: 'Angular details, generous counters', weights: '400-700', note: 'A sharper edge for forward-looking tools.' },
]

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

function toDisplayFont(font) {
  const tags = (font.tags ?? []).map(tag => typeof tag === 'string' ? tag : tag.tag)
  const weights = font.weights?.length ? `${Math.min(...font.weights)}-${Math.max(...font.weights)}` : '400'
  return {
    id: font.id,
    name: font.family,
    googleFontsId: font.googleFontsId,
    previewUrl: font.previewUrl,
    className: font.googleFontsId?.replace(/[^a-z]/g, '') || 'dm',
    initials: font.family.split(' ').map(word => word[0]).join('').slice(0, 2),
    category: font.category || 'Type family',
    tags: tags.slice(0, 3).map(titleCase),
    rawTags: tags,
    score: font.matchScore ?? 0,
    detail: `${font.features?.aperture ?? 'open'} apertures, ${font.features?.contrast ?? 'low'} contrast`,
    weights,
    note: font.description || 'Available in the Fontscape catalog.',
  }
}

function Tag({ children, active, onClick }) {
  return <button className={`tag ${active ? 'tag-active' : ''}`} onClick={onClick} aria-pressed={active}>{children}</button>
}

function FontCard({ font, compared, onPreview, onCompare }) {
  return <article className="font-card">
    <button className={`font-specimen ${font.className}`} onClick={() => onPreview(font)} aria-label={`Preview ${font.name}`}>
      <span aria-hidden="true">{font.name === 'IBM Plex Mono' ? '0O1l' : 'Ag'}</span>
      <small>{font.category}</small>
    </button>
    <div className="font-card-content">
      <div className="font-card-heading"><div><h3>{font.name}</h3><p>{font.detail}</p></div>{font.score > 0 && <span className="match">{font.score}%</span>}</div>
      <div className="card-tags">{font.tags.length ? font.tags.map(tag => <span key={tag}>{tag}</span>) : <span>Catalog family</span>}</div>
      <div className="card-actions">
        <button className="preview-action" onClick={() => onPreview(font)}>Preview <ArrowRight size={15} /></button>
        <button className={`compare-action ${compared ? 'in-tray' : ''}`} onClick={() => onCompare(font)} aria-pressed={compared}>
          {compared ? <Check size={15} weight="bold" /> : <Plus size={16} weight="bold" />}{compared ? 'Added' : 'Compare'}
        </button>
      </div>
    </div>
  </article>
}

function PreviewDialog({ font, pageTheme, onClose }) {
  const [previewTheme, setPreviewTheme] = useState(pageTheme)
  const [size, setSize] = useState(34)
  const [weight, setWeight] = useState(600)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (font.previewUrl && 'FontFace' in window) {
      const face = new FontFace(font.name, `url(${font.previewUrl})`)
      face.load().then(loaded => document.fonts.add(loaded)).catch(() => undefined)
      return undefined
    }
    if (!font.googleFontsId) return undefined
    const id = `fontscape-preview-${font.googleFontsId}`
    if (document.getElementById(id)) return undefined
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.name).replace(/%20/g, '+')}:wght@400;500;600;700&display=swap`
    document.head.append(link)
    return undefined
  }, [font.googleFontsId, font.name, font.previewUrl])

  const copy = async () => {
    let value = `font-family: '${font.name}', sans-serif;`
    if (font.id) {
      try { value = (await (await fetch(`/api/fonts/${font.id}/export?format=css`)).json()).value ?? value } catch { /* Local fallback stays usable. */ }
    }
    await navigator.clipboard?.writeText(value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="preview-dialog" data-preview-theme={previewTheme} role="dialog" aria-modal="true" aria-labelledby="preview-title" onMouseDown={event => event.stopPropagation()}>
      <header className="dialog-header">
        <div><span className="eyebrow"><Sparkle size={13} weight="fill" /> Live preview</span><h2 id="preview-title">{font.name}</h2><p>{font.note}</p></div>
        <button className="icon-button" onClick={onClose} aria-label="Close preview"><X size={20} /></button>
      </header>
      <div className="dialog-controls">
        <div className="segmented-control" aria-label="Sandbox appearance">
          <button className={previewTheme === 'light' ? 'is-active' : ''} onClick={() => setPreviewTheme('light')} aria-pressed={previewTheme === 'light'}><Sun size={15} /> Light</button>
          <button className={previewTheme === 'dark' ? 'is-active' : ''} onClick={() => setPreviewTheme('dark')} aria-pressed={previewTheme === 'dark'}><Moon size={15} /> Dark</button>
        </div>
        <label>Size <input type="range" min="24" max="50" value={size} onChange={event => setSize(event.target.value)} /><output>{size}px</output></label>
        <label>Weight <select value={weight} onChange={event => setWeight(event.target.value)}><option>400</option><option>500</option><option>600</option><option>700</option></select></label>
      </div>
      <div className="product-preview" style={{ '--preview-family': `'${font.name}', sans-serif`, '--preview-size': `${size}px`, '--preview-weight': weight }}>
        <nav><strong>Northstar</strong><span>Product&nbsp;&nbsp;&nbsp;Solutions&nbsp;&nbsp;&nbsp;Pricing</span><button>Start free</button></nav>
        <main><p>AN OPERATING SYSTEM FOR FOCUSED TEAMS</p><h3>Make work feel<br />more deliberate.</h3><div><input aria-label="Work email" placeholder="you@company.com" /><button>Get started</button></div></main>
        <footer><span>Simple systems for thoughtful teams.</span><span>New York · London · Remote</span></footer>
      </div>
      <footer className="dialog-footer"><span>{font.weights} weights · Google Fonts · OFL</span><button className="primary-button" onClick={copy}>{copied ? <Check size={17} /> : <Copy size={16} />}{copied ? 'Copied CSS' : 'Copy CSS'}</button></footer>
    </section>
  </div>
}

function App() {
  const [query, setQuery] = useState('')
  const [catalogFonts, setCatalogFonts] = useState(FALLBACK_FONTS)
  const [totalResults, setTotalResults] = useState(FALLBACK_FONTS.length)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [catalogMessage, setCatalogMessage] = useState('')
  const [theme, setTheme] = useState(() => localStorage.getItem('fontscape-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
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

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const tags = activeTags.map(apiTag).join(',')
        const response = await fetch(`/api/search?${new URLSearchParams({ q: query, tags, limit: '48', offset: '0' })}`, { signal: controller.signal })
        if (!response.ok) throw new Error('Catalog unavailable')
        const payload = await response.json()
        setCatalogFonts(payload.fonts.map(toDisplayFont))
        setTotalResults(payload.total ?? payload.fonts.length)
        setCatalogMessage(payload.inferredTags.length ? `Semantic match: ${payload.inferredTags.map(titleCase).join(', ')}` : '')
      } catch (error) {
        if (error.name !== 'AbortError') { setCatalogFonts(FALLBACK_FONTS); setTotalResults(FALLBACK_FONTS.length); setCatalogMessage('Showing the local starter catalog while the API reconnects.') }
      } finally { if (!controller.signal.aborted) setLoading(false) }
    }, 180)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [query, activeTags])

  const results = useMemo(() => {
    const localFiltered = catalogFonts.filter(font => {
      const searchable = `${font.name} ${font.category} ${font.rawTags.join(' ')}`.toLowerCase()
      return activeTags.every(tag => searchable.includes(apiTag(tag))) && (!query || font.score > 0 || searchable.includes(query.toLowerCase()))
    })
    return [...localFiltered].sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : b.score - a.score || a.name.localeCompare(b.name))
  }, [activeTags, catalogFonts, query, sort])

  const shown = results
  const toggleTag = tag => setActiveTags(current => current.includes(tag) ? current.filter(item => item !== tag) : [...current, tag])
  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const tags = activeTags.map(apiTag).join(',')
      const response = await fetch(`/api/search?${new URLSearchParams({ q: query, tags, limit: '48', offset: String(catalogFonts.length) })}`)
      if (!response.ok) throw new Error('Catalog unavailable')
      const payload = await response.json()
      setCatalogFonts(current => [...current, ...payload.fonts.map(toDisplayFont).filter(font => !current.some(item => item.id === font.id))])
      setTotalResults(payload.total ?? totalResults)
    } catch { notify('Could not load the next catalog page.') } finally { setLoadingMore(false) }
  }
  const toggleCompare = font => setCompared(current => current.some(item => item.name === font.name) ? current.filter(item => item.name !== font.name) : current.length < 4 ? [...current, font] : current)
  const notify = message => { setToast(message); window.setTimeout(() => setToast(''), 2200) }

  return <div className="app-shell">
    <a className="skip-link" href="#results">Skip to search results</a>
    <header className="topbar">
      <a className="brand" href="#top" aria-label="Fontscape home"><span className="brand-mark">F</span><span>fontscape</span></a>
      <nav aria-label="Primary navigation"><a className="nav-active" href="#discover">Discover</a><a href="#presets">Presets</a><a href="#about">About</a></nav>
      <div className="top-actions"><button className="search-shortcut" onClick={() => document.getElementById('font-search')?.focus()}><MagnifyingGlass size={16} /> Search <kbd>/</kbd></button><button className="appearance-button" onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}<span>{theme === 'dark' ? 'Light' : 'Dark'}</span></button></div>
    </header>

    <main id="top">
      <section className="discovery-hero" id="discover">
        <div><span className="eyebrow"><Sparkle size={13} weight="fill" /> Find type with intent</span><h1>Choose typefaces<br /><em>with confidence.</em></h1><p>Search by feeling, context, or visual character. Compare choices in the same product surface before committing.</p></div>
        <aside><strong>{catalogFonts.length.toLocaleString()}</strong><span>families in the catalog</span><p>Google Fonts only. Every family is free to use and ready to test.</p></aside>
      </section>

      <section className="search-section" aria-label="Font search">
        <label className="search-box" htmlFor="font-search"><MagnifyingGlass size={22} /><input id="font-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Describe what you need, for example “warm and trustworthy fintech”" /><kbd>/</kbd></label>
        <div className="suggestion-row"><span>Try a direction</span>{['Modern & trustworthy', 'Warm & human', 'Technical & precise'].map(term => <button key={term} onClick={() => setQuery(term)}>{term}</button>)}</div>
      </section>

      <section className="catalog-layout" id="results">
        <aside className="filters" aria-label="Catalog filters">
          <div className="filter-heading"><div><span>Filter catalog</span><h2>Refine your view</h2></div>{activeTags.length > 0 && <button onClick={() => setActiveTags([])}>Clear</button>}</div>
          {Object.entries(FILTERS).map(([group, tags]) => <div className="filter-group" key={group}><h3>{group}</h3><div>{tags.map(tag => <Tag key={tag} active={activeTags.includes(tag)} onClick={() => toggleTag(tag)}>{tag}</Tag>)}</div></div>)}
        </aside>

        <div className="results-area">
          <div className="results-heading"><div><span>{loading ? 'Searching catalog' : catalogMessage || 'All type families'}</span><h2>{results.length.toLocaleString()} results</h2></div><label className="sort-control">Sort <select value={sort} onChange={event => setSort(event.target.value)}><option value="match">Best match</option><option value="name">A to Z</option></select></label></div>
          {activeTags.length > 0 && <div className="active-filter-row" aria-live="polite">{activeTags.map(tag => <Tag key={tag} active onClick={() => toggleTag(tag)}>{tag} <X size={12} /></Tag>)}</div>}
          {shown.length ? <div className="font-grid">{shown.map(font => <FontCard key={font.id || font.name} font={font} compared={compared.some(item => item.name === font.name)} onPreview={setPreviewFont} onCompare={toggleCompare} />)}</div> : <div className="empty-state"><h3>No families match this direction.</h3><p>Try fewer filters or describe the intended use instead.</p><button onClick={() => { setQuery(''); setActiveTags([]) }}>Clear search</button></div>}
          {shown.length < totalResults && <div className="load-more"><p>Showing {shown.length.toLocaleString()} of {totalResults.toLocaleString()} families</p><button className="load-more-button" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Loading catalog' : 'Show 48 more'} <ArrowRight size={16} /></button></div>}
        </div>
      </section>

      <section className="preset-section" id="presets"><div><span className="eyebrow">Context presets</span><h2>Start with the job<br />the type needs to do.</h2></div><div className="preset-list">{PRESETS.map(([name, ...tags]) => <button key={name} onClick={() => { setQuery(''); setActiveTags(tags.map(titleCase)) }}><span>{name}</span><small>{tags.map(titleCase).join(' · ')}</small><ArrowRight size={17} /></button>)}</div></section>
    </main>

    <footer className="site-footer" id="about"><p>Fontscape is an open-source tool for choosing type more thoughtfully.</p><div><a href="/terms.html">Terms</a><a href="/privacy.html">Privacy</a><a href="https://github.com/kunthive/fontscape">Contribute</a></div></footer>
    {compared.length > 0 && <aside className="compare-tray" aria-live="polite"><div><span>Compare</span><strong>{compared.length} of 4</strong></div><div className="tray-fonts">{compared.map(font => <button key={font.name} onClick={() => setPreviewFont(font)}><span>{font.initials}</span>{font.name}<X size={13} onClick={event => { event.stopPropagation(); toggleCompare(font) }} /></button>)}</div><button onClick={() => notify('Comparison view is ready for the selected families.')}>Compare fonts <ArrowRight size={16} /></button></aside>}
    {previewFont && <PreviewDialog font={previewFont} pageTheme={theme} onClose={() => setPreviewFont(null)} />}
    {toast && <div className="toast" role="status"><Check size={17} weight="bold" />{toast}</div>}
  </div>
}

export default App
