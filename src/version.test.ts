import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { getFallbackVersion, getReleaseVersion, type BuildRef, type Logger } from './version.ts';

class TestLogger implements Logger {
    readonly infos: string[] = [];
    readonly warnings: string[] = [];
    info(message: string) { this.infos.push(message); }
    warning(message: string) { this.warnings.push(message); }
}

function release(tag_name: unknown, prerelease: unknown = false) {
    return getReleaseVersion({ tag_name, prerelease }, new TestLogger()).format();
}

const mainBranch: BuildRef = { ref: 'refs/heads/main', defaultBranch: 'main', runNumber: 45 };

function fallback(latestReleaseTag: string | null, buildRef: Partial<BuildRef> = {}, log = new TestLogger()) {
    return getFallbackVersion(latestReleaseTag, { ...mainBranch, ...buildRef }, log).format();
}

describe('release version', () => {
    test('stable tag', () => {
        assert.equal(release('v1.2.3'), '1.2.3');
    });

    test('prerelease tag marked as prerelease', () => {
        assert.equal(release('v1.2.3-rc.1', true), '1.2.3-rc.1');
    });

    test('prerelease tag not marked as prerelease raises', () => {
        assert.throws(() => release('v1.2.3-rc.1', false), /not marked as a pre-release/);
    });

    test('missing tag raises', () => {
        assert.throws(() => release(undefined), /Release version is missing/);
    });

    test('invalid tag raises', () => {
        assert.throws(() => release('latest'), /is not a valid semver version/);
    });

    test('unspecified prerelease status raises', () => {
        assert.throws(() => getReleaseVersion({ tag_name: 'v1.2.3' }, new TestLogger()), /prerelease status was invalid/);
    });

    test('build metadata raises', () => {
        assert.throws(() => release('v1.2.3+abc'), /unexpected build metadata 'abc'/);
    });
});

describe('fallback version', () => {
    test('stable release bumps patch', () => {
        assert.equal(fallback('v0.10.0'), '0.10.1-ci45');
    });

    test('prerelease drops prerelease without bump', () => {
        assert.equal(fallback('v0.10.0-rc.1'), '0.10.0-ci45');
    });

    test('no releases falls back to zero without bump', () => {
        assert.equal(fallback(null), '0.0.0-ci45');
    });

    test('invalid release tag warns and bumps zero', () => {
        const log = new TestLogger();
        assert.equal(fallback('latest', {}, log), '0.0.1-ci45');
        assert.match(log.warnings[0], /'latest' is not a valid semver version/);
    });

    test('build metadata on release tag is dropped with warning', () => {
        const log = new TestLogger();
        assert.equal(fallback('v0.10.0+abc', {}, log), '0.10.1-ci45');
        assert.match(log.warnings[0], /had build metadata 'abc'/);
    });

    test('custom default branch has no ref prefix', () => {
        assert.equal(fallback('v0.10.0', { ref: 'refs/heads/develop', defaultBranch: 'develop' }), '0.10.1-ci45');
    });

    test('branch ref prefixes branch name', () => {
        assert.equal(fallback('v0.10.0', { ref: 'refs/heads/my-branch' }), '0.10.1-my-branch-ci45');
    });

    test('branch ref replaces invalid characters', () => {
        assert.equal(fallback('v0.10.0', { ref: 'refs/heads/feature/v1.0_x' }), '0.10.1-feature-v1-0-x-ci45');
    });

    test('tag ref prefixes tag name', () => {
        assert.equal(fallback('v0.10.0', { ref: 'refs/tags/v1.0' }), '0.10.1-tag-v1-0-ci45');
    });

    test('pull request ref keeps full ref', () => {
        assert.equal(fallback('v0.10.0', { ref: 'refs/pull/123/merge' }), '0.10.1-refs-pull-123-merge-ci45');
    });
});
