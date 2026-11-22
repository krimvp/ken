// Live mode's eyes. While a coding agent works in the project, ken polls HEAD, the branch, the uncommitted files and the
// newest saved session, decides with watchStep when a note is due, and takes a snapshot of uncommitted work so a note
// can quote it. It reads the project and never writes to it: a snapshot goes to ken's own store under ~/.ken. It talks
// to no model; the agent writes the note.
export { type LastAsk, lastAsk, type NowBlock, nowBlock } from './now-block.ts'
export { observe } from './observe.ts'
export { holdsSnapshot, openSnapshots, type Snapshot, type SnapshotStore, takeSnapshot } from './snapshot.ts'
export {
	type About,
	type Observation,
	PACE,
	startWatch,
	type WatchAction,
	type WatchEvent,
	type WatchState,
	watchStep,
} from './watch-step.ts'
