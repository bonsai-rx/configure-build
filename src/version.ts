import * as semver from 'semver';
import { SemVer } from 'semver';

export interface Logger {
    info(message: string): void;
    warning(message: string): void;
}

export interface Release {
    tag_name?: unknown;
    prerelease?: unknown;
}

export interface BuildRef {
    ref: string;
    defaultBranch: string;
    runNumber: number;
}

export function getReleaseVersion(release: Release, log: Logger): SemVer {
    const releaseVersionString = release.tag_name;
    if (typeof releaseVersionString !== 'string' || !releaseVersionString) {
        throw new Error("Release version is missing!");
    }

    const version = semver.parse(releaseVersionString);
    if (!version) {
        throw new Error(`Release tag '${releaseVersionString}' is not a valid semver version!`);
    }

    const releaseIsPrerelease = release.prerelease;
    if (releaseIsPrerelease !== true && releaseIsPrerelease !== false) {
        throw new Error("Release prerelease status was invalid or unspecified!");
    }

    // There may be steps within the workflow which assume that the prerelease state of the release is correct, so we ensure it is
    if (version.prerelease.length > 0 && !releaseIsPrerelease) {
        throw new Error(`The version to be released '${releaseVersionString}' indicates a pre-release version, but the release is not marked as a pre-release!`);
    }

    if (version.prerelease.length > 0 && !isAllowedPrerelease(version.prerelease)) {
        throw new Error(`The version to be released '${releaseVersionString}' has pre-release '${version.prerelease.join('.')}', but only alpha.N, beta.N or rc.N are allowed!`);
    }

    log.info(`Got version ${version.format()} from release event.`);

    if (version.build.length > 0) {
        throw new Error(`Version '${version.format()}' has unexpected build metadata '${version.build.join('.')}', aborting!`);
    }

    return version;
}

export function getFallbackVersion(latestReleaseTag: string | null, buildRef: BuildRef, log: Logger): SemVer {
    const version = getNextVersion(latestReleaseTag, log);
    version.prerelease = ['dev', buildRef.runNumber];
    version.build = getBuildMetadata(buildRef);

    if (!semver.valid(formatVersion(version))) {
        throw new Error(`Internal error: Version '${formatVersion(version)}' is not a valid semver!`);
    }

    return version;
}

export function formatVersion(version: SemVer): string {
    const build = version.build.length > 0 ? `+${version.build.join('.')}` : '';
    return `${version.format()}${build}`;
}

function isAllowedPrerelease(prerelease: ReadonlyArray<string | number>): boolean {
    const [label, number] = prerelease;
    return prerelease.length == 2
        && (label == 'alpha' || label == 'beta' || label == 'rc')
        && typeof number == 'number';
}

function getNextVersion(latestReleaseTag: string | null, log: Logger): SemVer {
    if (latestReleaseTag === null) {
        log.info(`Repository does not appear to have any releases, falling back on 0.0.0`);
        return new SemVer('0.0.0');
    }

    let version = semver.parse(latestReleaseTag);
    if (!version) {
        log.warning(`Most recent release '${latestReleaseTag}' is not a valid semver version, using 0.0.0 instead.`);
        version = new SemVer('0.0.0');
    }

    log.info(`Got most recent release version: ${version.format()}`);

    if (version.build.length > 0) {
        log.warning(`Most recent release '${latestReleaseTag}' has build metadata '${version.build.join('.')}', it will be ignored.`);
        version.build = [];
    }

    // If the version is a pre-release version, drop the pre-release and use the main version as-is since presumably the next release
    // will be this version (but without the pre-release part.)
    //
    // We don't want to assume that pre-release versions will always be marked as pre-release releases, so don't rely on that aspect.
    // (Having releases marked as pre-releases has some visibility downsides on GitHub, so it's sensible to remove the designation)
    if (version.prerelease.length > 0) {
        log.info("Version is a pre-release version, CI version will be the same except without the pre-release suffix");
        version.prerelease = [];
    } else {
        version.patch++;
    }

    return version;
}

function getBuildMetadata({ ref, defaultBranch }: BuildRef): string[] {
    if (ref == `refs/heads/${defaultBranch}`) {
        return [];
    }

    //TODO: Might also be nice to include the fork owner if we're running from a fork. (Unfortunately the upstream repo doesn't seem to be in the context?)
    const name = ref
        .replace(/^refs\//, '')
        .replace(/[^0-9A-Za-z-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    return name ? [name] : [];
}
