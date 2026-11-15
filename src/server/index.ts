// The local server behind the page. It listens on 127.0.0.1 only, serves the page's files, runs the questions the
// page sends one at a time, and keeps each one in the reader's history so the page can show it again without a model.
export { type KenServer, openServer } from './open-server.ts'
