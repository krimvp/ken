// The page the reader uses: plain HTML, CSS and JavaScript modules that the server sends as they are, with no build
// step and no request to any other host. Nothing in this folder runs in Node; this door only tells the server where
// the files are.
export const PAGE_FOLDER = import.meta.dirname
