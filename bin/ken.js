#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import './strip-types.js'

await import('../src/cli/main.ts')
