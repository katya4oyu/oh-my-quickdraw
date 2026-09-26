# Quickdraw Extensions

A private workspace for optional packages and examples that extend [`katya4oyu/quickdraw`](https://github.com/katya4oyu/quickdraw).

## Design boundaries

- Prefer implementing capabilities in this repository when they can sit outside the Quickdraw core. Frames are an example to explore here first.
- Change the forked core only for behavior that should be shared by Quickdraw hosts and genuinely belongs in the core.
- Keep features with unresolved performance or security concerns in extension packages until those concerns are understood.
- Design extensions so they can be implemented with zero external dependencies; do not add dependencies by default.

## Layout

- `vendor/quickdraw/`: pinned Git submodule of the `katya4oyu/quickdraw` fork.
- `packages/*`: reusable extension packages, managed as npm workspaces.
- `examples/*`: runnable examples, also managed as npm workspaces.

The workspace starts intentionally empty. Add a package only when a concrete extension or example is ready to be named; there is no placeholder runtime package.
