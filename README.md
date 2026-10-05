# configure-build

Action for applying the Bonsai Foundation standard versioning and release scheme in GitHub Actions workflows.

The action determines the build version from the event that triggered the workflow, exports it for the rest of the build to consume, and reports whether the repository contains Bonsai workflows that need to be rendered for documentation.

## Usage

Invoke the action early in the build job, after checking out the repository:

```yml
- name: Configure build
  id: configure-build
  uses: bonsai-rx/configure-build@v3
```

The action exports two environment variables for later steps to consume:

- `CiBuildVersion` is the version to build. On a release it is the version in the release tag, such as `1.2.0` for `v1.2.0`. Otherwise it is the next version after the most recent release with a `dev` pre-release carrying the workflow run number, such as `0.10.1-dev.45`. Builds outside the default branch also carry the ref as build metadata, such as `0.10.1-dev.45+heads-my-branch`. The version is valid in both SemVer 2 and PEP 440, so the same value can version NuGet and Python packages.
- `CiIsForRelease` is `true` when the workflow runs for a published release and `false` otherwise.

It also sets the `need-workflow-image-render` output, which is `true` when the repository contains Bonsai workflows that need images rendered for the documentation website. Expose it as a job output so later jobs can decide whether to run the rendering step:

```yml
jobs:
  build:
    outputs:
      need-workflow-image-render: ${{steps.configure-build.outputs.need-workflow-image-render}}
```

### Release tags

A release tag with a pre-release must use `alpha.N`, `beta.N` or `rc.N`, as in `v1.2.0-rc.1`, and the release must be marked as a pre-release on GitHub. These are the labels that PEP 440 preserves, and the dot keeps the number ordered numerically. Any other pre-release label, or build metadata on the tag, fails the build.

### Documentation workflow detection

By default the action looks for Bonsai workflows under `docs/workflows/` and `docs/examples/`. Override the search with the `documentation-workflows` input:

```yml
- name: Configure build
  id: configure-build
  uses: bonsai-rx/configure-build@v3
  with:
    documentation-workflows: |
      docs/workflows/**/*.bonsai
      docs/examples/**/*.bonsai
```

## Documentation

See [action.yml](action.yml) for the full list of input parameters and outputs supported by this action.
