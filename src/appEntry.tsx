import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
// The app's theme tokens (shadcn HSL vars). Aliased to the app's frontend dir.
import '@app/orgTheme.css'
// The app root component, imported by absolute alias (see vite config).
import App from '@app/App'

// Some apps use react-router <Routes> without providing a Router (Retool wraps
// them at runtime). Wrap in BrowserRouter; harmless for apps that don't route.
createRoot(document.getElementById('root')!).render(
  React.createElement(BrowserRouter, null, React.createElement(App)),
)
