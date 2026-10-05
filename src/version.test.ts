import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as semver from 'semver';
import { formatVersion, getFallbackVersion, getReleaseVersion, type BuildRef, type Logger } from './version.ts';

// Ported from the version pattern in Python packaging, packaging.version.VERSION_PATTERN
const pep440 = /^\s*v?(?:(?:[0-9]+!)?[0-9]+(?:\.[0-9]+)*(?:[-_.]?(?:alpha|a|beta|b|preview|pre|c|rc)[-_.]?[0-9]*)?(?:-[0-9]+|[-_.]?(?:post|rev|r)[-_.]?[0-9]*)?(?:[-_.]?dev[-_.]?[0-9]*)?)(?:\+[a-z0-9]+(?:[-_.][a-z0-9]+)*)?\s*$/i;

class TestLogger implements Logger {
    readonly infos: string[] = [];
    readonly warnings: string[] = [];
    info(message: string) { this.infos.push(message); }
    warning(message: string) { this.warnings.push(message); }
}

function release(tag_name: unknown, prerelease: unknown = false) {
    const version = formatVersion(getReleaseVersion({ tag_name, prerelease }, new TestLogger()));
    assert.match(version, pep440);
    return version;
}

const mainBranch: BuildRef = { ref: 'refs/heads/main', defaultBranch: 'main', runNumber: 45 };

function fallback(latestReleaseTag: string | null, buildRef: Partial<BuildRef> = {}, log = new TestLogger()) {
    const version = formatVersion(getFallbackVersion(latestReleaseTag, { ...mainBranch, ...buildRef }, log));
    assert.match(version, pep440);
    return version;
}

describe('release version', () => {
    test('stable tag', () => {
        assert.equal(release('v1.2.3'), '1.2.3');
    });

    test('prerelease tag marked as prerelease', () => {
        assert.equal(release('v1.2.3-rc.1', true), '1.2.3-rc.1');
    });

    test('alpha and beta prerelease tags', () => {
        assert.equal(release('v1.2.3-alpha.1', true), '1.2.3-alpha.1');
        assert.equal(release('v1.2.3-beta.10', true), '1.2.3-beta.10');
    });

    test('unsupported prerelease labels raise', () => {
        for (const tag of ['v1.2.3-preview.1', 'v1.2.3-pre.1', 'v1.2.3-rc1', 'v1.2.3-RC.1', 'v1.2.3-rc.1.2', 'v1.2.3-rc.x', 'v1.2.3-dev.1']) {
            assert.throws(() => release(tag, true), /only alpha\.N, beta\.N or rc\.N/, tag);
        }
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
        assert.equal(fallback('v0.10.0'), '0.10.1-dev.45');
    });

    test('prerelease drops prerelease without bump', () => {
        assert.equal(fallback('v0.10.0-rc.1'), '0.10.0-dev.45');
    });

    test('no releases falls back to zero without bump', () => {
        assert.equal(fallback(null), '0.0.0-dev.45');
    });

    test('invalid release tag warns and bumps zero', () => {
        const log = new TestLogger();
        assert.equal(fallback('latest', {}, log), '0.0.1-dev.45');
        assert.match(log.warnings[0], /'latest' is not a valid semver version/);
    });

    test('build metadata on release tag is dropped with warning', () => {
        const log = new TestLogger();
        assert.equal(fallback('v0.10.0+abc', {}, log), '0.10.1-dev.45');
        assert.match(log.warnings[0], /has build metadata 'abc'/);
    });

    test('run numbers sort numerically', () => {
        assert.ok(semver.gt(fallback('v0.10.0', { runNumber: 100 }), fallback('v0.10.0', { runNumber: 45 })));
    });

    test('custom default branch has no build metadata', () => {
        assert.equal(fallback('v0.10.0', { ref: 'refs/heads/develop', defaultBranch: 'develop' }), '0.10.1-dev.45');
    });

    test('branch ref adds build metadata', () => {
        assert.equal(fallback('v0.10.0', { ref: 'refs/heads/my-branch' }), '0.10.1-dev.45+heads-my-branch');
    });

    test('branch ref collapses and trims invalid characters', () => {
        assert.equal(fallback('v0.10.0', { ref: 'refs/heads/feature/v1.0__x-' }), '0.10.1-dev.45+heads-feature-v1-0-x');
    });

    test('tag ref adds build metadata', () => {
        assert.equal(fallback('v0.10.0', { ref: 'refs/tags/v1.0' }), '0.10.1-dev.45+tags-v1-0');
    });

    test('pull request ref adds build metadata', () => {
        assert.equal(fallback('v0.10.0', { ref: 'refs/pull/123/merge' }), '0.10.1-dev.45+pull-123-merge');
    });

    test('tag and branch with similar names differ', () => {
        assert.notEqual(fallback('v0.10.0', { ref: 'refs/tags/v1.0' }), fallback('v0.10.0', { ref: 'refs/heads/tag-v1.0' }));
    });
});
