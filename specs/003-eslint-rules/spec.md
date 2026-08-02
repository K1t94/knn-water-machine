# Feature Specification: Unified ESLint Rules

**Feature Branch**: `eslint-feature`

**Created**: 2026-08-02

**Status**: Draft

**Input**: User description: "Configure strict, practical, stack-specific ESLint rules for the mobile and API applications without changing product behavior."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Detect Actionable TypeScript Defects (Priority: P1)

As a developer, I want one reliable static-analysis baseline for both applications so that mistakes involving unused code, asynchronous work, unsafe types, imports, and unreachable or duplicated logic are found before review or integration.

**Why this priority**: The primary value of this feature is preventing real defects consistently across the repository without forcing developers to interpret noisy or contradictory results.

**Independent Test**: Run the repository-wide check against the current code and a controlled set of invalid samples; current valid code passes, while every sample representing a required error category fails with an actionable diagnostic and a non-zero command result.

**Acceptance Scenarios**:

1. **Given** valid production and test code in both applications, **When** a developer runs the repository-wide check, **Then** the correct shared and application-specific policies are applied and the command succeeds.
2. **Given** code with an unused import, unhandled asynchronous operation, unsafe type operation, unreachable branch, or invalid import, **When** the relevant check runs, **Then** it reports the defect and exits unsuccessfully.
3. **Given** an intentional exception in an approved special-purpose file, **When** the relevant check runs, **Then** the narrow override applies without weakening production-code checks.

---

### User Story 2 - Validate React Native Code Correctly (Priority: P1)

As a mobile developer, I want checks that understand the actual React Native and Expo application so that hook, JSX, native UI, accessibility, reactive-flow, test, and architecture errors are caught without applying browser-only assumptions.

**Why this priority**: Generic TypeScript rules cannot validate the mobile runtime's component, hook, accessibility, and reactive lifecycle constraints.

**Independent Test**: Run the mobile-only check against the existing phone authentication flow and controlled invalid mobile samples, then run focused React Native Testing Library accessibility assertions; the flow passes without behavior changes, static hook/JSX/native/async/boundary defects fail, and native accessibility behavior is verified without browser-only assumptions.

**Acceptance Scenarios**:

1. **Given** a component that violates hook ordering or omits a required hook dependency, **When** the mobile check runs, **Then** the violation is reported.
2. **Given** a React Native list with an invalid key, raw JSX text in an invalid native context, or an inaccessible interactive control, **When** the mobile lint and focused accessibility tests run, **Then** static defects produce native diagnostics and interaction semantics produce a scoped RNTL failure without requesting browser-only attributes.
3. **Given** an Observable-based workflow that creates a long-lived subscription, **When** the mobile check runs, **Then** accidental ignored streams and missing deliberate lifecycle handling are detected wherever reliable static detection is available.
4. **Given** platform-specific files or `Platform.select` usage, **When** the mobile check resolves imports, **Then** valid iOS and Android variants are accepted.

---

### User Story 3 - Preserve API Layer Boundaries (Priority: P1)

As an API developer, I want checks that understand the current Nest application so that asynchronous controller and provider defects, invalid dependency directions, and accidental infrastructure coupling are detected without treating decorator- or metadata-driven declarations as dead code.

**Why this priority**: The API handles security-sensitive authentication and session workflows; false negatives around Promise handling or layer boundaries and false positives around framework metadata both reduce confidence.

**Independent Test**: Run the API-only check against the existing phone authentication modules and controlled invalid API samples; valid controllers, DTOs, guards, filters, interceptors, modules, and providers pass, while floating Promise and forbidden-layer imports fail.

**Acceptance Scenarios**:

1. **Given** a controller delegates validated input to an application service and shapes its response, **When** the API check runs, **Then** the controller passes without decorator-related false errors.
2. **Given** a controller directly imports forbidden infrastructure or expresses business logic through another deterministically prohibited dependency, **When** the API check runs, **Then** an enforceable boundary violation is reported.
3. **Given** a controller contains business logic without a reliable static boundary signal, **When** the API policy is verified, **Then** controller thinness remains an explicit review responsibility and no noisy complexity heuristic is enabled.
4. **Given** a controller, service, or provider accidentally ignores or misuses a Promise, **When** the API check runs, **Then** the asynchronous defect is reported.
5. **Given** a migration, seed, script, test, or mock implementation, **When** the API check runs, **Then** only its documented narrow override applies.

---

### User Story 4 - Use Predictable Local and CI Commands (Priority: P2)

As a maintainer, I want documented whole-repository, per-application, and safe-fix commands so that developers and future CI jobs invoke the same checks and formatting remains a separate responsibility.

**Why this priority**: Consistent policies provide limited value if command behavior is unclear, silently succeeds on errors, or conflicts with formatting.

**Independent Test**: Follow only the documented command instructions from a clean checkout; each scope checks the intended files, invalid code causes a non-zero result, safe fixes are limited to fixable static-analysis findings, and the formatter reports no policy conflict.

**Acceptance Scenarios**:

1. **Given** the documented commands, **When** a developer checks all code, only mobile code, or only API code, **Then** each command covers exactly its stated scope.
2. **Given** a safely fixable violation, **When** a developer runs the fix command, **Then** the violation is corrected without changing observable product behavior.
3. **Given** any remaining error, **When** a check or fix command completes, **Then** it returns a non-zero result.
4. **Given** code accepted by the formatter, **When** static analysis runs, **Then** no enabled style rule contradicts the formatter's output.

### Edge Cases

- Generated contracts, generated native projects, dependencies, build output, coverage, caches, temporary files, and generated ORM clients must not enter the analysis scope.
- A name intentionally unused to satisfy a callback, framework, or interface contract must be accepted only through a documented naming convention or narrow file override; unrelated unused values must still fail.
- A Promise or Observable deliberately detached from its caller must require an explicit, reviewable indication of intent and must not hide failures accidentally.
- Observable-returning APIs must not be mistaken for inert values: returned streams, subscriptions, teardown, and error paths must follow the repository's explicit reactive lifecycle.
- Type-only imports, mixed type/value imports, side-effect imports, native platform modules, and aliases must be ordered and resolved without changing runtime behavior.
- Cyclic-dependency analysis must not be enabled if it is unreliable for the repository's aliases or causes disproportionate check time; the plan must document the selected reliable alternative or the measured reason for deferral.
- Native inline styles that are justified by dynamic values must not be rejected by a blanket policy; unused named styles must still be detected.
- Tests may use runner globals, mocks, fixtures, non-null assertions, and intentionally partial doubles only under test-file policies that do not leak into production code.
- Infrastructure entry points and maintenance scripts may use console output when output is their explicit operational purpose; application modules must use the established logging path.
- Existing phone-authentication code may receive mechanical lint fixes, but any fix that could alter OTP, registration, legal, session, SMS, or navigation behavior must be rejected or handled as a separately approved change.

## Requirements _(mandatory)_

### Functional Requirements

#### Policy Structure and Scope

- **FR-001**: The repository MUST provide one understandable policy entry point with a shared TypeScript baseline and separate mobile and API policies, avoiding duplicated declarations unless an application requires a deliberate difference.
- **FR-002**: The policies MUST match the repository's existing configuration format and package-management model without migrating core frameworks, changing product dependencies, or performing an unrelated configuration-format migration.
- **FR-003**: The entire repository, mobile application, and API application MUST each have a documented check command, and the repository MUST have a documented safe automatic-fix command.
- **FR-004**: Every check and fix command MUST exit unsuccessfully when an error remains and MUST be suitable for local execution and later CI use.
- **FR-005**: Generated files, dependency directories, build outputs, coverage, native generated projects, caches, and temporary artifacts MUST be excluded centrally and consistently.
- **FR-006**: Production, test, configuration, migration, seed, script, mock, fixture, and generated-file scopes MUST use narrow policies appropriate to their purpose rather than global disabling of useful checks.

#### Shared TypeScript Safety

- **FR-007**: Shared rules MUST reject unused imports, variables, and parameters, while allowing intentional contract placeholders through one documented and narrowly defined convention.
- **FR-008**: Shared rules MUST detect unhandled Promises, async callbacks used where their result cannot be observed, accidental Promise truthiness, redundant `await`, and other unsafe async/await patterns supported reliably by the selected policy set.
- **FR-009**: Shared rules MUST prevent accidental ignoring of Observable values and subscriptions and MUST enforce deliberate consumption, return, composition, or lifecycle ownership wherever reliable static analysis supports the distinction.
- **FR-010**: Shared rules MUST detect unreachable code, duplicate conditions or branches, and other redundant control flow that can be identified without speculative semantics.
- **FR-011**: Shared rules MUST detect unnecessary assertions and type parameters, unsafe assignments, calls, member access, arguments, and returns, and other unjustified escapes from type safety.
- **FR-012**: Explicit `any` MUST be restricted in production code and require a narrow justification or safer boundary narrowing, while tests, migrations, generated declarations, and external-integration boundaries MAY receive documented targeted allowances.
- **FR-013**: Shared rules MUST define clear naming expectations for exported types, values, components, hooks, classes, methods, and intentionally unused placeholders without imposing naming constraints that conflict with framework contracts or external payloads.
- **FR-014**: Imports MUST follow one deterministic grouping and ordering policy, distinguish type-only imports correctly, preserve side-effect import semantics, and resolve the repository's TypeScript configuration and aliases.
- **FR-015**: Import validation MUST reject unresolved imports and cross-application imports, including any API implementation imported into mobile code.
- **FR-016**: Cyclic imports MUST be checked when the selected mechanism resolves project aliases and platform files reliably and remains within the performance target; otherwise the plan MUST record measurements, limitations, and a lower-cost boundary safeguard.
- **FR-017**: Production application code MUST reject direct console use, with targeted allowances only for entry points, operational scripts, migrations, seeds, and other files whose explicit responsibility is terminal or infrastructure output.
- **FR-018**: Type-informed checks MUST be applied to source sets for which complete project information is available, and files outside that set MUST receive a documented compatible policy instead of silent omission or parsing failures.

#### Mobile Policy

- **FR-019**: The mobile policy MUST reflect the actual Expo, React Native, React, TypeScript, test-runner, and configuration versions found during planning; dependency choices MUST not be based on popularity alone.
- **FR-020**: The mobile policy MUST enforce hook call rules and hook dependency correctness for `useEffect`, `useMemo`, `useCallback`, and detected project-specific effect hooks.
- **FR-021**: The mobile policy MUST enable currently applicable checks for unsafe state updates and effect lifecycle mistakes without treating MobX observer updates or deliberate RxJS composition as React state misuse.
- **FR-022**: The mobile policy MUST validate common React and JSX mistakes, component and prop usage, and list keys while accepting the automatic JSX runtime and not requiring a React import in every file.
- **FR-023**: Browser-only JSX and accessibility rules MUST NOT be applied to native components unless the rule explicitly supports React Native semantics.
- **FR-024**: The mobile policy MUST detect unused named `StyleSheet` styles and invalid raw JSX text outside an appropriate native text component.
- **FR-025**: Inline-style checks MUST be selected from measured current usage and practical maintenance value; strict prohibition MUST NOT be enabled by default, and justified dynamic styles MUST remain possible.
- **FR-026**: Native import and component checks MUST account for `Platform.select` and valid `*.ios.*` and `*.android.*` files.
- **FR-027**: Mobile accessibility coverage MUST use compatible static React Native rules where reliable and focused React Native Testing Library behavior assertions for labels, roles, and interactive controls where no ESLint 9 Flat Config-compatible native rule exists; it MUST NOT demand browser-only attributes such as `alt` or `tabindex`.
- **FR-028**: Mobile import-boundary checks MUST prevent API implementation imports and enforce the existing responsibilities among screens, components, contexts, hooks, services, storage adapters, stores, navigation, API adapters, and testing support where those boundaries can be expressed deterministically.
- **FR-029**: Reactive mobile checks MUST support the established MobX ownership and Observable-first architecture: presentation components do not own long-lived subscriptions, application services deliberately compose or subscribe to streams, and subscription owners expose and use explicit disposal.
- **FR-030**: Mobile test policies MUST recognize the actual test runner and React Native Testing Library, apply testing-specific checks only to tests, and allow narrowly scoped mock, fixture, and helper patterns.

#### API Policy

- **FR-031**: The API policy MUST reflect the actual NestJS, TypeScript, test-runner, and configuration versions found during planning.
- **FR-032**: API rules MUST accept legitimate decorator-, dependency-injection-, DTO-, guard-, interceptor-, filter-, module-, scheduler-, and metadata-driven usage without incorrectly reporting framework-discovered declarations as unused.
- **FR-033**: API rules MUST enforce safe Promise handling in controllers, application services, repositories, providers, schedulers, guards, interceptors, and filters.
- **FR-034**: Enforceable API boundaries MUST keep controllers as transport adapters, reject direct controller dependencies on infrastructure implementations, and prevent domain or application code from importing HTTP or infrastructure details contrary to the existing architecture.
- **FR-035**: Business-logic placement that cannot be identified reliably by static rules MUST be documented as a review responsibility rather than represented by noisy heuristic failures.
- **FR-036**: Migrations, seeds, scripts, tests, fixtures, and mock implementations MUST receive separate targeted API overrides for their legitimate runtime and typing needs.

#### Dependency Selection, Formatting, and Adoption

- **FR-037**: The implementation plan MUST evaluate each candidate base configuration and plugin against installed-version compatibility, active maintenance, support for the existing configuration format, overlap with the Expo baseline where applicable, false-positive rate, analysis speed, and demonstrated value in this repository.
- **FR-038**: The plan MUST select at most one import-analysis family and MUST include only framework, accessibility, unused-import, test, runner, reactive, or formatting compatibility modules that add verified non-duplicative coverage.
- **FR-039**: If a candidate is stale, incompatible, browser-oriented, redundant, or disproportionately slow, the plan MUST record why it was rejected and identify how the underlying required outcome is met or explicitly constrained.
- **FR-040**: Static analysis and formatting MUST have separate documented responsibilities, and enabled static-analysis policies MUST not conflict with the repository's established formatter.
- **FR-041**: The code introduced for phone OTP authentication MUST pass all applicable checks; required cleanup MUST be mechanical, reviewable, and behavior-preserving, with narrow justified suppressions used only when no reliable rule configuration can express valid code.
- **FR-042**: The feature MUST NOT change OTP, registration, legal documents, payments, balance, MQTT, water dispensing, referrals, session behavior, SMS behavior, navigation behavior, persistent schemas, or public contracts.
- **FR-043**: Documentation MUST list each command, its scope, its fix behavior, expected exit semantics, and the process for adding a justified override or new source category.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: The whole-repository, mobile-only, API-only, and safe-fix commands are all executable from the repository root, cover their documented scopes, and return a non-zero result for every remaining error.
- **SC-002**: One hundred percent of controlled static invalid samples covering unused code, unhandled Promise work, ignored reactive work where statically detectable, unsafe typing, invalid imports, hook misuse, native UI misuse, and API boundary violations produce the expected failure.
- **SC-003**: All application and test code introduced by `002-phone-otp-auth` passes the final checks with zero unexplained suppressions and no observed change to its public contracts or automated behavior.
- **SC-004**: A warm whole-repository check completes in 30 seconds or less on the documented development environment, and neither application-only check takes longer than the whole-repository check.
- **SC-005**: Running the formatter check after safe automatic fixes produces zero formatter changes attributable to conflicting static-analysis rules.
- **SC-006**: Every enabled external policy module has a recorded compatibility and value decision, and there are zero enabled duplicate rules that report the same defect for the same code location.
- **SC-007**: A developer unfamiliar with the setup can identify and run the correct whole-repository or per-application command from project documentation in under two minutes.
- **SC-008**: Generated files and excluded artifacts produce zero diagnostics even when present locally, while intentionally invalid production source always causes the applicable command to fail.
- **SC-009**: Focused React Native Testing Library assertions verify the existing phone-authentication controls' required labels, roles, and interaction semantics, and a controlled inaccessible variant fails without relying on DOM-only attributes or rules.

## Assumptions

- The repository remains a pnpm workspace with separate `apps/mobile` and `apps/api` applications and a root policy entry point.
- Planning will use the resolved dependency graph, not only manifest ranges. At specification time the manifests declare Expo 54, React Native 0.81.5, React 19.1.0, NestJS 11.1, TypeScript 5.8, ESLint 9 Flat Config, Vitest 3, and Prettier 3; the lockfile currently resolves newer compatible ESLint and TypeScript patch/minor versions.
- The current configuration supplies only general recommended JavaScript and TypeScript rules. None of the candidate Expo, React, hooks, React Native, native accessibility, import, unused-import, testing, runner, or formatter-compatibility packages is currently installed at the workspace root.
- The implementation plan, rather than this specification, will determine the final package set after checking current official compatibility and maintenance status. `eslint-config-expo` is the preferred base candidate because Expo is present, but it is not pre-approved.
- Existing Prettier configuration remains the formatting authority unless planning uncovers a contrary established mechanism. Adding or replacing a formatter is outside scope.
- Observable safety includes both accidental ignored stream values and unmanaged subscriptions. Where available policies cannot distinguish lifecycle intent reliably, deterministic architecture boundaries and reviewable local conventions are preferred over noisy global heuristics.
- The `002-phone-otp-auth` implementation is the primary style and architecture baseline. Its mobile code uses MobX-owned state, Observable-first application services, typed adapters, and explicit disposal; its API code separates HTTP, application, domain, and infrastructure responsibilities and uses explicit DTO and response shaping.
- Although the `002-phone-otp-auth` implementation commit is present and provides the baseline code, its task list still shows `T123`, `T124`, `T125`, and `T127` as incomplete acceptance activities. This lint feature does not claim those activities are complete and does not expand their scope.
- No persistent data entities, schema changes, or product-facing behavior are introduced by this feature.
