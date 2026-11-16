// The local server behind the page. It listens on 127.0.0.1 only, serves the page's files, runs the questions the
// page sends and the notes of live mode one model call at a time, and keeps each one in the reader's history so the
// page can show it again without a model. "ken live" runs the same live mode without the page.
export { type KenProject, openProject } from './ken-project.ts'
export type { LiveRunner, LiveView } from './live-runner.ts'
export { type KenServer, openServer } from './open-server.ts'
export type { QuestionView } from './question-desk.ts'
