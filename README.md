# purescript-dependency-helper

[![Latest version](https://img.shields.io/npm/v/purescript-dependency-helper.svg)](https://www.npmjs.com/package/purescript-dependency-helper)

A tool to perform reverse lookups of purescript dependencies.

## Installation

```
npm install -g purescript-dependency-helper
```

This will install a globally-runnable command called `psc-dependencies`.

## Usage

To find the dependants of a project:

```
psc-dependencies --lookup purescript-free
```

The returned list is a topologically sorted list of all dependants, including transitive dependants (suffixed with an `*` in the result), meaning if you are using this tool to find projects that need their versions bumping, you can safely run through this list from top to bottom.

Please note that running `psc-dependencies` will create a `.psc-dependencies-cache` subdirectory within the current directory to cache various metadata files.

The first time a `psc-dependencies` command is run the cache will be created, subsequent runs will only refer to the cache. To clear the cache either delete the `.psc-dependencies-cache` directory, or run `psc-dependencies --clean`.

### Ignore transitive dependants

To only show direct dependants the `--direct` flag can be used.

### Filter owners

If you're only interested in finding the dependants owned by a particular owner (or list of owners) the `--filter-owners` flag enables this. For example:

```
psc-dependencies --lookup purescript-free --filter-owners ethul
```

Or for a list of owners, use a comma-separated list:

```
psc-dependencies --lookup purescript-free --filter-owners ethul,slamdata
```

### Markdown output

The `--markdown` flag will print the output as a GitHub flavoured markdown check list, with links to each of the project repositories.
