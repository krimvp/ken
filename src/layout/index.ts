// The project's layout: a level of a few boxes over its folders, at any commit, with a change laid over it and the
// reader's map on each box. Plain code makes all of it from git, the project record and the understanding map, and no
// model takes part. A box opens the level whose scope is its paths, so zoom is a lookup, with nothing to keep in step.
export { type ChangeChoice, changeChoices, type RawAsk, readLayoutAsk } from './layout-ask.ts'
export {
	type Change,
	type LayoutAsk,
	type LayoutLook,
	type LayoutSources,
	type LookBox,
	lookAtLayout,
	type Scope,
	type Touched,
} from './layout-look.ts'
export type { BoxMap, BoxTopic, Mark, Next, Standing } from './reader-marks.ts'
