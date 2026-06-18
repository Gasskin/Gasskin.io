export function applyDocumentTheme(darkMode: boolean): () => void {
  const root = document.documentElement
  root.classList.toggle('dark', darkMode)
  root.style.colorScheme = darkMode ? 'dark' : 'light'

  return () => {
    root.classList.remove('dark')
    root.style.removeProperty('color-scheme')
  }
}
