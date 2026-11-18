#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import './strip-types.js'

const { serve } = await import('../scripts/claude-endpoint/claude-endpoint.ts')
await serve(process.argv.slice(2))
