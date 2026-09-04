# Evidence-first execution protocol

This document defines the default operating method for AI-assisted engineering work in `gameAccess`, especially when external tools, local agents, third-party libraries, provider APIs, Steam, or the `AI_Local_Access` runner are involved.

The purpose is to prevent guess-driven work, duplicated mechanisms, random experimentation, and premature claims that something is unavailable or impossible.

## Core rule

**Inspect before assuming. Research before experimenting. Reuse before building. When one route is blocked, enumerate equivalent permitted routes before giving up.**

A task is not ready for implementation until the relevant repository state, code paths, tool contracts, and external-library behavior have been inspected.

## Mandatory preflight

Before making a non-trivial change or running an experiment:

1. **Read project instructions first.**
   - Read `skill.md`.
   - Read the relevant parts of `README.md` and `docs/architecture.md`.
   - Read any narrower design/specification document that governs the subsystem being touched.

2. **Inspect the current implementation.**
   - Search for the relevant feature, function, capability, action, endpoint, adapter, script, or configuration before assuming it exists or does not exist.
   - Open the actual implementation, not only search snippets.
   - Trace imports/callers far enough to understand the current data flow.
   - Verify the active branch/worktree and current runtime version when those facts matter.
   - Never infer current behavior from an old filename, old conversation, or remembered architecture when the code can answer the question.

3. **Inspect the tools before using them.**
   - Read the tool/function schema and operational contract.
   - Check required fields, allowed roots, side effects, output behavior, concurrency rules, admission tokens, authentication model, and limitations.
   - For `AI_Local_Access`, inspect `runner.py`, `local_actions.py`, and the relevant action module before inventing shell commands or new capabilities.
   - Search the installed action/capability registry first. Prefer an existing generic operation such as `read_file`, `fs.read_text`, `action`, `command`, or a purpose-built action over ad-hoc shell code.

4. **Research third-party libraries/services before probing them.**
   - Prefer current official documentation, source code, protocol definitions, and maintained reference implementations.
   - Check the installed/current version of the library and read documentation appropriate to that version.
   - For undocumented behavior, inspect reputable implementations and clearly distinguish confirmed behavior from inference.
   - Search the web before running many speculative experiments when documentation can narrow the problem first.

5. **Form a minimal test from evidence.**
   - State what specific uncertainty the test resolves.
   - Change one important variable at a time.
   - Use one account/item/session first when a pool-wide test is not required.
   - Avoid destructive or expensive scans merely to discover information already available through metadata or an API.

## Evidence hierarchy

Use this order when deciding what is true about the current system:

1. Current runtime observation/result.
2. Current checked-out source code and configuration.
3. Current repository documentation/specification.
4. Official documentation for the exact dependency/service version.
5. Maintained reference implementations and upstream source.
6. Focused experiment.
7. Inference.

Do not present level 6 or 7 as if it were level 1-4.

## Reuse before implementation

Before adding code, search for:

- an existing function;
- a generic capability;
- a registered local action;
- a helper script;
- an existing connector/tool;
- a library feature that already performs the operation;
- a project convention that already solves the same transport or persistence problem.

If an existing primitive is sufficient, use it. Do not create a second mechanism with overlapping semantics unless there is a documented reason.

Example from `AI_Local_Access`: `read_file` and `fs.read_text` already existed. A task requiring a local text file should use those capabilities rather than inventing a PowerShell file-reader first.

## Tool-use discipline

When using `AI_Local_Access`:

- Treat the runner as an API with a contract, not as an opaque remote shell.
- Inspect `CAPABILITIES` and the action registries before selecting an execution method.
- Respect `allowed_roots`.
- Respect single-flight semantics and consume each `admission_token` exactly once.
- Wait for and read the prior result before submitting the next dependent job.
- Do not create duplicate worktrees/branches for routine work when the project policy specifies one active copy.
- Prefer targeted commits; never use blind `git add -A` in a dirty project tree.
- Keep project-specific logic in the project repository when practical. The monigote should usually perform `fetch/pull -> execute project script`, rather than embedding large project-specific scripts inside job JSON.

## Research-first rule for provider and Steam work

For Steam/provider behavior in particular:

1. Inspect existing GameAccess adapter/inventory/session code.
2. Inspect the actual local-agent capabilities that will perform the operation.
3. Search current Valve/Steamworks documentation, SteamKit source/docs, protocol definitions, or maintained reference implementations as relevant.
4. Identify exactly what authentication, visibility, account state, and API key/token type each endpoint requires.
5. Only then run a minimal controlled test.

Do not log into many provider accounts merely to discover whether an API or cached metadata already exposes the needed information.

## Alternative-path requirement

A blocked implementation path is not equivalent to an impossible task.

When a route fails, explicitly identify the blocked layer and enumerate other permitted ways to achieve the same end-to-end result. Examples include:

- use an existing registered action instead of a shell command;
- put reusable/project-specific logic in the project repo, then `fetch/pull` and execute it locally;
- use a local file as input rather than transporting its content through a remote job payload;
- use a user environment variable or OS credential store for runtime configuration;
- use a connector directly rather than relaying data through GitHub;
- use a local cached identity/metadata mapping rather than opening a provider GUI;
- call a supported API/protocol directly instead of automating a UI;
- split a blocked compound operation into independent benign stages;
- reuse an authenticated local session/token when the provider and security model support that legitimately.

Alternatives must remain within security, platform, and product constraints. Do not disguise data or semantics merely to bypass a safety/policy control.

## Separate transport from business logic

Keep generic transport/configuration mechanisms generic.

Examples:

- `read text file` should be a generic filesystem operation;
- `import text into environment variable` should be a generic environment/configuration operation;
- `Steam GetOwnedGames` should consume configuration from the environment or an injected runtime source;
- provider inventory logic should not be embedded into the runner protocol itself.

This separation makes blocked paths easier to replace and prevents secrets/project semantics from leaking into orchestration layers unnecessarily.

## Practicality rule

Optimize for the shortest reliable path to the user's actual goal, not for demonstrating a particular technique.

Before doing additional work, ask internally:

- What is the end state the user needs?
- What facts are already known?
- What existing code/tool can produce that state?
- What is the least invasive test that resolves the remaining uncertainty?
- If this route fails, what are the next two or three equivalent routes?

Do not spend multiple iterations fighting one transport mechanism when the same result can be reached through a project script, existing action, local file, environment configuration, connector, API, or another already-supported primitive.

## Corrections become constraints

When the user corrects architecture, taxonomy, workflow, or operational policy, treat the correction as binding project state until explicitly changed.

Before later work in the same area, re-read the relevant persisted project instructions and current code so an earlier invalid assumption is not reintroduced.

For GameAccess this includes, among other project-specific rules documented elsewhere, keeping local/user Steam accounts distinct from GameAccess provider accounts and preserving the configured single-worktree development policy.

## Reporting standard

After an investigation or change, report separately:

- **Confirmed:** directly supported by current code/runtime/official documentation.
- **Changed:** exact files/functions/configuration modified.
- **Tested:** exact scope of the test and its result.
- **Unknown:** questions that still require evidence.
- **Next action:** the smallest high-value next step.

Avoid saying that a capability is absent until the repository/tool registry has actually been searched. Avoid saying a dependency behaves a certain way until its current documentation/source or a focused test supports it.

## Stop conditions

Stop and inspect/research rather than continuing speculative attempts when any of these occur:

- two consecutive experiments fail for reasons not yet understood;
- a tool rejects a request and the tool contract has not been inspected;
- the proposed change duplicates a capability that may already exist;
- the task depends on a third-party API/library whose current version or authentication model has not been verified;
- results conflict with repository documentation or earlier runtime evidence;
- a broad/bulk operation is being considered before a one-item test has established the mechanism.

The response to a stop condition is not passive waiting. It is targeted inspection, documentation research, and alternative-path design.
