import React from 'react'
import { createRoot } from 'react-dom/client'
// The app's theme tokens (shadcn HSL vars). Aliased to the app's frontend dir.
import '@app/orgTheme.css'
// The app root component, imported by absolute alias (see vite config).
import App from '@app/App'

createRoot(document.getElementById('root')!).render(React.createElement(App))
