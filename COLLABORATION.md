# Collaboration Workflow

This repo can be worked on in several parallel Codex threads, but only if each thread has clear file ownership and a narrow objective.

## Thread model

Use one main integration thread plus side threads with bounded responsibilities.

### Main thread

The main thread owns:

- roadmap and priorities
- integration order
- testing checklist
- commit and push decisions

The main thread should avoid large experimental edits while side threads are active.

### Thread A: Parsing and extraction

Owns:

- `app.js` parsing logic

Scope:

- ImmoScout extraction
- rent, utilities, reserve heuristics
- search page completeness
- blocked page handling

Out of scope:

- visual redesign
- layout refactors
- launcher and server UX unless needed for transport

### Thread B: UI and readability

Owns:

- `index.html`
- `styles.css`
- only small UI wiring in `app.js`

Scope:

- card readability
- import UX
- help text
- layout polish
- visual hierarchy

Out of scope:

- parsing helper refactors
- scoring logic changes

### Thread C: Local tooling and ops

Owns:

- `server.py`
- `start.command`
- `README.md`

Scope:

- launcher flow
- local server startup
- local import infrastructure
- docs

Out of scope:

- offer scoring changes
- parsing behavior unless required for request transport

## Working rules

Each thread should have one bounded objective.

Good examples:

- improve labeled rent extraction
- polish import help text
- make `start.command` restart more clearly

Bad examples:

- improve import
- clean up app
- make everything better

If two threads need the same file, only one thread owns it at a time.

Before starting a side thread, define:

- target files
- exact goal
- what is out of scope
- expected handoff format

## Handoff format

Each side thread should hand back:

- files changed
- user-visible behavior change
- risks or open questions
- whether restart or retest is needed

Short example:

- Files changed: `app.js`
- Behavior: labeled `Kaltmiete` now wins over generic euro fallback
- Risks: still heuristic for unlabeled rent values
- Retest: restart app and retry one search URL and one expose URL

## Recommended sequence for this repo

1. Keep the main thread for roadmap and integration.
2. Run Thread A until parser quality is stable enough for current goals.
3. Run Thread B in parallel only if it avoids the same `app.js` sections.
4. Run Thread C separately for launcher, server, and documentation changes.
5. After each milestone:
   - integrate into the main thread
   - restart the app
   - test one real search URL and one expose URL
   - commit before opening the next parallel round

## Test and integration routine

After parser changes:

- test one search results URL
- test one expose URL
- verify `monthlyRent`, `Nebenkosten`, and `Ruecklagen`

After UI changes:

- verify import flow
- verify settings visibility
- verify card readability

After tooling or server changes:

- verify `start.command`
- verify server restart
- verify URL import still works

Only push from the main thread after integration. Side threads should not push independently.
