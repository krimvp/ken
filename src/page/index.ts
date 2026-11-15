// The page the reader uses: plain HTML, CSS and JavaScript modules that the server sends as they are, with no build
// step and no request to any other host. Nothing in this folder runs in Node; this door only tells the server where
// the files are.
import { fileURLToPath } from 'node:url'

export const PAGE_FOLDER = import.meta.dirname

// Mermaid's single-file browser build, which draws the diagrams. The server sends it from the page's own address.
export const MERMAID_FILE = fileURLToPath(import.meta.resolve('mermaid/dist/mermaid.min.js'))
