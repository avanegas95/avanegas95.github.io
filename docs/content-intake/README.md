# Content intake

Anderson's own words live here (`site-copy.md`, `resume.md`, `about-me-questions.md`). Agents never write or reword his prose; the tools below make sure nothing changes without him.

## How to use the voice lock

The knowledge base prose (`src/content/knowledge/`) is hashed into `voice.lock.json`. If any locked field changes, CI fails until Anderson accepts it.

| Command                | Who                                    | What it does                                                                                                                                                                        |
| ---------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run voice:check`  | anyone, CI                             | Exits 1 and names each changed field, e.g. `experience.md#roles[0].bullets[2]`.                                                                                                     |
| `npm run voice:accept` | **Anderson only**, in his own terminal | Shows each change as old → new, says whether the new text appears verbatim in `site-copy.md`, and asks you to type `accept`. Then commit `voice.lock.json` with the KB change.      |
| `npm run voice:init`   | once                                   | Snapshots the current text. Refuses if `voice.lock.json` already exists.                                                                                                            |
| `npm run facts:check`  | anyone                                 | Report only, writes nothing: DISCREPANCIES rule breaches, KB vs site date/title mismatches, PII, likely typos, and hard-coded facts in section components (the site-drift ratchet). |

Steps when the prose changed on purpose:

1. Run `npm run voice:accept` (add `-- --help` for the full usage).
2. Read each old → new pair. Type `accept` to lock them all; anything else cancels and changes nothing.
3. Commit `voice.lock.json`.

If nothing changed, it says "Nothing to accept". It refuses to run when there is no interactive terminal or `CI` is set, so an agent or a pipeline cannot accept for you.

The site-drift allow files in `tests/fixtures/drift/allow/` list the hard-coded facts that still sit in section components. They may only shrink: delete a line when you move that fact to the KB.

## Shortening Experience bullets for the site

The full resume bullets stay in `src/content/knowledge/experience.md` under `bullets`. Blob (the chat prompt) always uses those. To show shorter text on the site cards, add an optional `siteBullets` list to a role. When present the card shows it instead of `bullets`; when absent the card shows the full `bullets`.

```yaml
roles:
  - company: "Company name"
    title: "Role title"
    start: "2020-01"
    end: null
    showOnSite: true
    siteBullets:
      - "your short bullet here"
      - "your second short bullet here"
    bullets:
      - "(the full resume bullets stay as they are)"
```

`siteBullets` is voice-locked like `bullets`: after editing, run `npm run voice:accept` yourself and commit `voice.lock.json`.

## Who may touch the lock

- Only Anderson runs `voice:accept` and `voice:init`, in his own terminal. Agents must never run them and must never edit `voice.lock.json` by hand.
- Both commands refuse non-interactive shells (no TTY, or `CI` set), and stamp the lock with `meta` (when, and which fields changed).
- The TTY check is a speed bump, not a security boundary: a hand-edited lock still passes `voice:check`. The real gate is review of the visible lock diff. CI prints every changed field as a GitHub annotation and in the job summary (the "Voice lock changes" step), so a lock change is always visible on the PR.
