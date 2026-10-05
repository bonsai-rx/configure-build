import * as core from '@actions/core';
import * as github from '@actions/github';
import * as glob from '@actions/glob';
import { RequestError } from '@octokit/request-error';
import { strict as assert } from 'assert';
import * as fs from 'fs';
import { SemVer } from 'semver';
import { getFallbackVersion, getReleaseVersion } from './version.ts';

async function getLatestReleaseTag(context: typeof github.context): Promise<string | null> {
    const token = core.getInput('repo-token', { required: true });
    assert(token, "Must have GitHub token!");

    const owner = context.payload.repository?.owner?.login;
    const repo = context.payload.repository?.name;
    //TODO: Can these ever realistically happen? The field is nullable for some reason
    assert(owner, "Action expects to run with repository context w/ owner!");
    assert(repo, "Action expects to run with repository context w/ name!");

    try {
        const latestRelease = await github.getOctokit(token).rest.repos.getLatestRelease({
            owner: owner,
            repo: repo,
        });
        return latestRelease.data.tag_name;
    } catch (error) {
        if ((<RequestError>error).status == 404) {
            return null;
        }
        throw error;
    }
}

async function main(): Promise<void> {
    core.debug(`Starting action invocation`);

    const context = github.context;
    if (core.isDebug()) {
        core.startGroup("Context dump");
        core.info(JSON.stringify(context, null, 2));
        core.endGroup();
    }

    //==============================================================================================================================================================
    // Determine build settings
    //==============================================================================================================================================================
    const isForRelease = context.eventName == 'release';
    let version: SemVer;
    try {
        if (isForRelease) {
            version = getReleaseVersion(context.payload.release ?? {}, core);
        } else {
            switch (context.eventName) {
                case 'push':
                case 'pull_request':
                case 'workflow_dispatch':
                    break;
                default:
                    core.warning(`GitHub Actions event '${context.eventName}' was not properly considered when designing the logic of this action!`);
                    break;
            }

            core.info(`Determining version to use based off of last release version...`);
            const latestReleaseTag = await getLatestReleaseTag(context);
            version = getFallbackVersion(latestReleaseTag, {
                ref: context.ref,
                defaultBranch: context.payload.repository?.default_branch ?? 'main',
                runNumber: context.runNumber,
            }, core);
        }
    } catch (error) {
        core.setFailed(error instanceof Error ? error.message : String(error));
        return;
    }

    //==============================================================================================================================================================
    // Determine if workflow images need to be built
    //==============================================================================================================================================================
    //TODO: Might be interesting support detecting if any existing SVGs are stale
    const documentationWorkflowPaths = core.getInput('documentation-workflows');
    let needWorkflowImageRender = false;
    if (documentationWorkflowPaths) {
        core.debug(`Looking for Bonsai workflows matching patterns '${documentationWorkflowPaths}'`);
        const bonsaiWorkflows = await glob.create(documentationWorkflowPaths, {
            matchDirectories: false,
            implicitDescendants: false,
        });

        for await (const bonsaiWorkflow of bonsaiWorkflows.globGenerator()) {
            core.info(`Found one or more Bonsai workflows used by documentation, image rendering will be needed.`);
            needWorkflowImageRender = true;
            break;
        }

        if (!needWorkflowImageRender) {
            if (!fs.existsSync('.git')) {
                core.warning("Could not locate Bonsai workflows used for documentation, and there's no .git folder in the workspace, did you forget to checkout?");
            } else {
                core.info("No Bonsai workflows were found in documentation-related locations.");
            }
        }
    }

    //==============================================================================================================================================================
    // Emit outputs
    //==============================================================================================================================================================
    core.info(`Configuring build environment to build${isForRelease ? ' and release' : ''} version ${version.format()}`);
    core.exportVariable('CiBuildVersion', version.format());
    core.exportVariable('CiIsForRelease', isForRelease ? 'true' : 'false');
    core.setOutput('need-workflow-image-render', needWorkflowImageRender ? 'true' : 'false');
}

// Node's default error printer is extremely obnoxious and tries to be "helpful" by printing the source line where the exception occurred
// This is all well and good, but sometimes the source map lookup fails and it just barfs an extremely long minified source line which is
// not only useless but makes the log much more annoying to read. This behavior is implemented in `GetErrorSource` in `node_errors.cc` and
// seemingly cannot be disabled directly except by overriding the uncaught exception handler, so that's what we do. :/
const actionIsUnderTest = !!process.env['__TEST_INVOCATION_ID'];
process.on('uncaughtException', (err, origin) => {
    // We don't use core.error here as it causes the initialization order to get messed up and might not work as expected
    let message: string = err.stack ?? `${err.message}:\n(Stack trace missing)`;
    if (!actionIsUnderTest) {
        message = message
            .replaceAll('%', '%25')
            .replaceAll('\r', '%0D')
            .replaceAll('\n', '%0A')
            ;
    }
    process.stdout.write(`::error::${message}`);
    if (!process.exitCode) {
        process.exitCode = -1;
    }
});

main();
