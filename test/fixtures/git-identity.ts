// Tests make git commits. A CI runner has no git identity, so a commit there fails with "empty ident name" unless the
// test process names one. Loaded by `npm test` before any test, and inherited by every git the tests spawn.
process.env.GIT_AUTHOR_NAME ??= 'ken tests'
process.env.GIT_AUTHOR_EMAIL ??= 'tests@ken.invalid'
process.env.GIT_COMMITTER_NAME ??= 'ken tests'
process.env.GIT_COMMITTER_EMAIL ??= 'tests@ken.invalid'
