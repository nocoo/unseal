# Retrospective

Accident narratives for this repo.

Routing: narrative stays here. A project-specific rule that will recur may become one line in `AGENTS.md`. Cross-project lessons go to nmem or a global rule. If it can be checked by a machine, add a hook or test instead of prose.

## 2026-11-02 — npm publish burned several attempts before 0.3.5 landed

Context: releasing v0.3.5 (deps upgrades). The artifact was fine; publication control flow was not.

What went wrong:

- `npm publish` without a PTY prints `EOTP` and masks the auth URL as `.../auth/cli/***`. The masked URL is useless, so the browser flow can never start from that output.
- `screen -dmS` on this Mac produced a detached session whose shell emitted nothing (`hardcopy` empty), so driving npm through it wasted a cycle.
- A FIFO/`yes ''` stdin trick plus backgrounding left ambiguous state: one attempt eventually published 0.3.5 while a later attempt reported `403 cannot publish over the previously published versions`, making success look like failure.

What worked, in order:

1. `npm login --auth-type=web` (no PTY needed; prints the unmasked login URL).
2. Run publish under a PTY and keep it alive: `script -q /tmp/pub.log npm publish ./pkg.tgz ...`, then poll the logfile for `https://www.npmjs.com/auth/cli/...`.
3. Open that URL in Chrome; the process exits by itself when the browser flow completes.
4. Never trust the second attempt's error — check `https://registry.npmjs.org/<pkg>/<version>` and compare `dist.shasum` / `dist.integrity` with the retained tarball.

Rule: one publish attempt at a time, diff the registry hashes before retrying, and treat a PTY-less masked URL as a hard stop rather than something to work around.
