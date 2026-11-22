// What plain code can say of a project in the first second, before ken's model has read anything: what the project
// says it is, in its own manifests and README, what it is written in, how it is started and deployed, how busy it
// has been, and how large and busy each folder is. All of it comes from git at one commit, so it is always true.
export type { Language } from './languages.ts'
export type { EntryPoint, Said } from './manifests.ts'
export {
	type Activity,
	type DeployFile,
	type FirstLook,
	RECENT_DAYS,
	readFirstLook,
	type Sizes,
	sizeOf,
} from './read-first-look.ts'
