import * as os from 'os';

/**
 * Build the User-Agent string for NuGet HTTP requests.
 * Follows the `ClientName/major.minor.patch` convention used by
 * NuGet's known-client stats parser.
 *
 * @see https://github.com/NuGet/NuGetGallery/blob/main/python/StatsLogParser/loginterpretation/knownclients.yaml
 *
 * @param clientId  Caller identifier, e.g. 'ALCops' (CLI/library default)
 *                  or 'vsts-task-installer' (ADO extension, a registered known client).
 * @param version   Semver version of the calling package.
 */
export function getUserAgent(clientId: string, version: string): string {
    return `${clientId}/${version} (Node.js ${process.version}; ${os.type()} ${os.release()})`;
}
