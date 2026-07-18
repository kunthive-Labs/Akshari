import { Component, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App.jsx'

class StartupBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return <main className="startup-error"><p>Fontscape couldn’t finish loading.</p><button onClick={() => window.location.reload()}>Try again</button></main>
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode><StartupBoundary><App /></StartupBoundary></StrictMode>,
)
