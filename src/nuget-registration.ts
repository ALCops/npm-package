import {
    NUGET_REGISTRATION_BASE,
    RegistrationIndex,
    RegistrationPage,
    RegistrationVersion,
} from './types';
import { httpsGetJson } from './http-client';
import { Logger, nullLogger } from './logger';

/**
 * Parse a RegistrationIndex into a flat array of RegistrationVersion objects.
 * Only processes pages that have inlined items; pages without items are skipped.
 * Call resolveExternalPages first if the index may contain external page references.
 */
export function parseRegistrationIndex(index: RegistrationIndex): RegistrationVersion[] {
    const versions: RegistrationVersion[] = [];

    for (const page of index.items) {
        if (!page.items) continue;
        for (const leaf of page.items) {
            versions.push({
                version: leaf.catalogEntry.version,
                listed: leaf.catalogEntry.listed ?? true,
                packageContent: leaf.packageContent,
            });
        }
    }

    return versions;
}

/**
 * Fetch any external pages (those without inlined items) in parallel,
 * mutating the index in place to populate their items arrays.
 */
async function resolveExternalPages(index: RegistrationIndex, userAgent?: string): Promise<void> {
    const externalPages = index.items.filter((page) => !page.items);
    if (externalPages.length === 0) return;

    const fetched = await Promise.all(
        externalPages.map((page) => httpsGetJson<RegistrationPage>(page['@id'], userAgent)),
    );

    for (let i = 0; i < externalPages.length; i++) {
        externalPages[i].items = fetched[i].items;
    }
}

/**
 * Query the NuGet V3 Registration API for all versions of a package.
 * Returns the full list of versions with listing status and download URLs.
 * Handles pagination (external pages) transparently.
 */
export async function queryNuGetRegistration(
    packageName: string,
    userAgent?: string,
    logger: Logger = nullLogger,
): Promise<RegistrationVersion[]> {
    const lowerId = packageName.toLowerCase();
    const url = `${NUGET_REGISTRATION_BASE}/${lowerId}/index.json`;
    logger.debug(`NuGet Registration URL: ${url}`);

    const index = await httpsGetJson<RegistrationIndex>(url, userAgent);

    await resolveExternalPages(index, userAgent);

    const versions = parseRegistrationIndex(index);
    logger.debug(`Found ${versions.length} total versions (${versions.filter((v) => v.listed).length} listed)`);

    return versions;
}
