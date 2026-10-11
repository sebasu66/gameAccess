# GameAccess agent rules

Before changing this repository, read `docs/EXECUTION_PROTOCOL.md`, `skill.md`, and the relevant project documentation.

## Local and remote development workflow

GameAccess uses `dev` for development and `main` for stable releases. Work on the existing `dev` branch; do not create a branch or worktree for each task. Do not delete historical branches or move work into `main` without an explicit request.

**Local agents with direct filesystem access work locally first.** Inspect the checkout and remote state, edit files directly in the existing checkout, build/run/test locally, then commit and push the verified changes on `dev`. AI_Local_Access / monigote is optional for local execution, not a prerequisite for editing.

**GitHub-first applies only to remote agents without direct filesystem access.** Author changes on the existing GitHub `dev` branch, commit/push them, synchronize that commit through AI_Local_Access / monigote, then build/run/test on the user's working copy. Do not create a new branch for routine work or rewrite source through ad-hoc monigote payloads.

For both workflows:

- Preserve pre-existing user changes and private configuration. Never discard or overwrite them while synchronizing.
- Inspect branch divergence before pulling or pushing; reconcile safely without force pushes.
- Stage only files belonging to the task, not unrelated dirty or untracked files.
- Report the exact tested commit and any subsequent untested changes. A build alone is not runtime or visual acceptance.
