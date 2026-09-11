# GameAccess agent rules

Before changing this repository, read `docs/EXECUTION_PROTOCOL.md`, `skill.md`, and the relevant project documentation.

## Mandatory GitHub-first workflow

**GitHub is the source of truth for GameAccess source code and project documentation.**

All implementation changes must follow this sequence:

```text
inspect current repository/remote state
-> implement on a GitHub-backed branch/PR
-> commit + push
-> use AI_Local_Access / monigote to fetch/pull/checkout that pushed commit
-> build/run/test on the user's working copy
-> fix any discovered bug on GitHub
-> push
-> monigote pulls the update
-> test again
```

Hard rules:

- Do not author or patch GameAccess source directly on the user's PC through the monigote.
- Do not use monigote job payloads containing `python -c`, PowerShell, `sed`, encoded scripts, here-documents, or similar mechanisms to rewrite project source files.
- The monigote is primarily for synchronization and execution: inspect runtime state when necessary, `fetch`/`pull`/`checkout`, install dependencies, build, run, test, execute committed project scripts, and collect logs/results.
- If local runtime inspection reveals a code change is needed, make the change on GitHub first, push it, then pull it locally.
- Preserve any pre-existing local/user changes. If newer local source changes are not on GitHub, capture/push those existing changes first so GitHub becomes authoritative; do not overwrite them while integrating a PR.
- Before claiming that a PR was tested, verify the tested local checkout corresponds to the exact pushed commit being reported.
- Temporary local worktrees do not authorize local source authoring. They may be used only as synchronized checkouts of GitHub-backed work when needed for build/test isolation.

A direct local-source-edit workflow is forbidden unless the user explicitly overrides this rule for that specific task.
