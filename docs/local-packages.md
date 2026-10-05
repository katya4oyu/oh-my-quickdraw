# Use the packages in your own app

The extension packages are not published to a registry. You can install the packages you need from a clone of oh-my-quickdraw and import them by name, without running the bundled `omq` app.

This guide is for an npm-managed app. It does not require changing oh-my-quickdraw's package manager.

## Clone the source

You need Git and Node.js with npm 9 or later. For the browser example below, use a bundler that supports JavaScript modules and CSS imports, such as Vite.

Keep the clone beside your app:

```text
projects/
├── oh-my-quickdraw/
└── my-app/
    └── package.json
```

From `projects/`, clone the repository with its pinned Quickdraw core:

```sh
git clone --recurse-submodules https://github.com/katya4oyu/oh-my-quickdraw.git
```

If you already cloned without submodules, run this inside `oh-my-quickdraw/`:

```sh
git submodule update --init --recursive
```

You do not need to run `npm install` in oh-my-quickdraw or install the `omq` command to use its library packages this way.

## Install the packages in your app

From your existing `my-app/`, configure npm to install local packages as copies rather than symbolic links:

```sh
npm config set install-links=true --location=project
```

Then install the fork's core and the extensions you need. For example, tickets depend on frames, so install both together:

```sh
npm install \
  ../oh-my-quickdraw/vendor/quickdraw/packages/core \
  ../oh-my-quickdraw/packages/quickdraw-frames \
  ../oh-my-quickdraw/packages/quickdraw-tickets
```

This records `file:../oh-my-quickdraw/...` dependencies in your app's `package.json`. The core, frames and tickets expose JavaScript directly; there is no library build step before installing them.

The `install-links` setting is saved in your app's `.npmrc`. Keep it with `package.json` and `package-lock.json` in version control so that later installs and `npm ci` use the same installation mode. Installing copies lets these packages resolve dependencies from your app rather than from the source checkout's `node_modules`.

Install individual package directories, not the repository root: the root is a private workspace, not a library entry point.

### Choose other extensions

Use the [package table](../README.md#packages) and each package's README to choose what to install.

- Include every unpublished package that an extension depends on in the same install command, including its transitive dependencies. For example, `quickdraw-screenshare` and `quickdraw-layouts` also need `quickdraw-frames`; `quickdraw-agent` needs several other extensions. Check their `package.json` dependencies before installing.
- Install external dependencies normally. For example, `quickdraw-yjs` needs `yjs` as a peer dependency.
- Use the bundled fork's core for custom shapes such as Markdown cards, embeds and tickets. A registry version of `@quickdrawjs/core` may not have the required `registerShapeType` API. Keep one shared core for your app and its extensions.

If npm returns a registry 404 for a `quickdraw-*` dependency, include that package's local directory too; these extensions are not on the registry.

## Import and use an extension

In a browser app, provide a container with a nonzero size:

```html
<div id="board" style="width: 100%; height: 600px"></div>
```

Then, in your app's JavaScript entry point:

```js
import { createQuickdraw } from '@quickdrawjs/core'
import '@quickdrawjs/core/quickdraw.css'
import { bindFrames, createFrame } from 'quickdraw-frames'

const board = createQuickdraw({
  container: document.getElementById('board'),
})

bindFrames(board.editor.store)

createFrame(board.editor.store, {
  x: 0,
  y: 0,
  title: 'Plan',
})
```

This creates a Quickdraw board with one frame. Follow each extension's README for its setup and cleanup; installing an extension alone does not attach its UI or behavior to the board.

## Update the local source

Inside `oh-my-quickdraw/`, update the checkout and restore the core revision pinned by that checkout:

```sh
git pull --ff-only
git submodule update --init --recursive
```

Then, inside `my-app/`, reinstall from the lockfile to refresh the installed copies:

```sh
npm ci
```

Changes in the source checkout are not automatically reflected in the copies under your app's `node_modules`. Repeating `npm install` with the same local paths can report "up to date" without copying changed files; `npm ci` recreates `node_modules` and picks up the current local source. If the extension's dependency list changed, add any new local dependencies before running `npm ci`. Restart your app's development server if it caches dependencies.

## Use another machine or CI

Create the same directory layout, clone oh-my-quickdraw with its submodule, and run `npm ci` inside your app. The local `file:` paths must exist before installation.

For repeatable builds, check out a specific oh-my-quickdraw commit, then run `git submodule update --init --recursive`. Your app's npm lockfile records the local paths, not which Git commit those directories contain.
