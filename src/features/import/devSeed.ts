/**
 * DevSeed — a dev-only escape hatch for the import flows.
 *
 * Each import flow is a self-contained state machine that auto-parses a real
 * file on mount and derives its per-step view from internal state. That makes
 * the intermediate screens (preview / unmatched / cost-basis / done) impossible
 * to inspect without a full end-to-end run.
 *
 * When a flow receives a `devSeed` prop it:
 *   - initialises `step` to `devSeed.step`,
 *   - seeds the relevant internal state from `devSeed.state`,
 *   - skips its auto-parse effect (so the seeded state is not overwritten).
 *
 * This is consumed exclusively by the `/dev` showcase ([DevShowcase.tsx]).
 * In production every flow is rendered with `devSeed` undefined, so the normal
 * code paths are untouched.
 */
export type DevSeed<Step, State> = {
  step: Step
  state?: Partial<State>
}
