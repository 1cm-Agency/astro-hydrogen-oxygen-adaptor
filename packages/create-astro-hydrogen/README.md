# create-astro-hydrogen

One command to start an Astro storefront on Shopify Oxygen, or to add the [astro-hydrogen](https://github.com/1cm-Agency/astro-hydrogen-oxygen-adaptor/tree/main/packages/astro-hydrogen#readme) adapter to an Astro project you already have. No runtime dependencies, no prompts.

```sh
npm create astro-hydrogen@latest my-shop
```

`pnpm create astro-hydrogen my-shop`, `yarn create astro-hydrogen my-shop` and `bun create astro-hydrogen my-shop` work too.

## Usage

```sh
create-astro-hydrogen [dir] [options]
```

| Option | Effect |
| --- | --- |
| `--no-install` | Skip installing dependencies. |
| `--no-git` | Skip `git init` (new projects only). |
| `--pm <npm\|pnpm\|yarn\|bun>` | Override the detected package manager. |
| `--help` | Show usage. |

The package manager comes from `--pm`, else the tool that ran the command (`npm_config_user_agent`), else a lockfile in an existing project, else npm.

The mode is chosen from `dir`:

- It does not exist, or is an empty directory: **new project**.
- It is a directory whose `package.json` lists `astro` as a dependency: **init**. `dir` defaults to the current directory when that is an Astro project.
- Anything else is an error (exit code 1), and nothing is written. Running with no `dir` outside an Astro project prints the usage and exits 1.

## New project

Copies the [mock-shop](https://github.com/1cm-Agency/astro-hydrogen-oxygen-adaptor/tree/main/examples/mock-shop) storefront into `dir`, names the package after the directory, runs `git init` (unless `--no-git` or you are already inside a git repository), installs dependencies, and prints the next steps. It runs against the public mock.shop store until you link your own:

```sh
npx shopify hydrogen link && npx shopify hydrogen env pull
```

## Init

Adds the adapter to an existing project:

- `package.json`: adds `astro-hydrogen` and `@shopify/hydrogen` to `dependencies`, `@shopify/cli` to `devDependencies`, and a `deploy` script. Existing entries are never changed or downgraded.
- `astro.config.*`: adds the `astro-hydrogen` import, `output: 'server'` and `adapter: hydrogen()`. The edit is textual. If another adapter is configured, or the config has an unfamiliar shape, the file is left alone and the lines to add are printed. An existing `output` other than `'server'` is kept, and `export const prerender = false` opts a page in to server rendering. Without a config file, `astro.config.mjs` is created.
- `src/pages/products/[handle].astro` and `src/pages/cart.astro`: standalone product and cart pages. Swap their `<html>` wrapper for your own layout.
- `.env.example`: the variables the adapter reads.

It never overwrites a file: anything that already exists is reported as `kept`. Running it twice changes nothing the second time.

## Development

`template/` is generated from `examples/mock-shop` by `npm run sync-template` (also run by `prepack` and the tests), so edit the example, not the template.

```sh
npm test                  # offline
npm run test:integration  # needs network: real install and astro build
```
