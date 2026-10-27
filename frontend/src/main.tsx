import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { backend } from './backend'
import { LangProvider } from './i18n'
import { setLocale } from './theme'
import type { Lang } from './types'

// Generated texts (agents) and number/date formats follow the UI language.
const onLangChange = (l: Lang) => {
  backend.setLang(l)
  setLocale(l === 'de' ? 'de-DE' : 'en-GB')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider onChange={onLangChange}>
      <App />
    </LangProvider>
  </StrictMode>,
)
