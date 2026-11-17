# vendor

`aigent-0.0.0.tgz` is aigent, the owner's agent engine, packed by `npm run package` in a checkout of krimvp/aigents. ken installs it from this file because aigent has no package registry. Every build carries version 0.0.0, so the commit below is the only record of which code is inside.

Source commit: 41a595450613f258a42f573f8d982fb9992201f0

To take a new build, run `scripts/vendor-aigent.sh <path to an aigents checkout>`. It builds the tarball there, copies it here, rewrites the commit line, and runs `npm install` so `package-lock.json` records the new tarball's hash.
