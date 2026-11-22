// The reader's settings: how much text a brief shows, and light or dark. How much text is kept by the server, in the
// reader's own files, so ken's model is told of it too. Light or dark belongs to this browser.
const TEXTS = ['pictures', 'balanced', 'words']
const THEMES = ['light', 'dark']

// stored and store read and write a value this browser keeps.
export function readerPrefs({ read, post, stored, store }) {
	const system = () => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
	const prefs = {
		text: TEXTS.find((each) => each === stored('ken-text')) ?? 'pictures',
		theme: THEMES.find((each) => each === stored('ken-theme')) ?? system(),
	}
	const paint = () => {
		document.documentElement.dataset.theme = prefs.theme
	}
	paint()

	// shortcut: while GET /api/prefs answers 404 the setting for text lives in this browser alone, so ken's model is
	// not told of it. The browser's copy goes when the server's prefs (branch dash2-server) are merged.
	async function load() {
		const answer = await read('/api/prefs').catch(() => null)
		const text = answer?.ok ? TEXTS.find((each) => each === answer.body.text) : undefined
		if (text) prefs.text = text
	}

	function setText(text) {
		if (!TEXTS.includes(text)) return
		prefs.text = text
		store('ken-text', text)
		void post('/api/prefs', { text }).catch(() => {})
	}

	function setTheme(theme) {
		if (!THEMES.includes(theme)) return
		prefs.theme = theme
		store('ken-theme', theme)
		paint()
	}

	return { prefs, load, setText, setTheme }
}
