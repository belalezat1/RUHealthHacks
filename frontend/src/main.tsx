import React from 'react'
import ReactDOM from 'react-dom/client'
import { MantineProvider, createTheme } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles.css'

// Navy is the only action colour; mint is reserved for selection and state.
const theme = createTheme({
  primaryColor: 'ink',
  primaryShade: 6,
  defaultRadius: 'md',
  fontFamily: "'Avenir Next', 'Segoe UI', system-ui, sans-serif",
  headings: { fontFamily: "'Avenir Next', 'Segoe UI', system-ui, sans-serif", fontWeight: '600' },
  colors: {
    ink: [
      'oklch(0.97 0.008 262)',
      'oklch(0.935 0.014 262)',
      'oklch(0.88 0.02 262)',
      'oklch(0.8 0.03 262)',
      'oklch(0.67 0.04 262)',
      'oklch(0.5 0.05 262)',
      'oklch(0.34 0.055 262)',
      'oklch(0.29 0.055 262)',
      'oklch(0.24 0.05 262)',
      'oklch(0.19 0.04 262)',
    ],
  },
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MantineProvider theme={theme}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </MantineProvider>
  </React.StrictMode>,
)