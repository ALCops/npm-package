const ATTRIBUTE_NAME = 'TargetFrameworkAttribute';

const TFM_PREFIXES = [
    '.NETCoreApp,Version=v',
    '.NETStandard,Version=v',
    '.NETFramework,Version=v',
] as const;

const VERSION_CHAR_REGEX = /^[0-9.]+/;

const FILE_VERSION_ATTRIBUTE = 'AssemblyFileVersionAttribute';
const BLOB_PROLOG = Buffer.from([0x01, 0x00]);
const ASSEMBLY_VERSION_REGEX = /^\d{1,3}\.\d{1,3}\.\d{1,5}\.\d{1,5}$/;

/**
 * Detect the target framework moniker from a .NET assembly buffer.
 * Searches for the TargetFrameworkAttribute value in the binary
 * using Buffer.indexOf() (native C++ byte scanning).
 *
 * Returns a short TFM like 'net8.0', 'netstandard2.1', or null if not found.
 */
export function detectTfmFromBuffer(buffer: Buffer): string | null {
    if (buffer.indexOf(ATTRIBUTE_NAME, 0, 'utf8') === -1) {
        return null;
    }

    for (const prefix of TFM_PREFIXES) {
        const idx = buffer.indexOf(prefix, 0, 'utf8');
        if (idx === -1) { continue; }

        const versionStart = idx + Buffer.byteLength(prefix, 'utf8');
        const slice = buffer.subarray(versionStart, Math.min(versionStart + 16, buffer.length));
        const versionStr = slice.toString('utf8');

        const match = VERSION_CHAR_REGEX.exec(versionStr);
        if (!match) { continue; }

        const version = match[0].replace(/\.+$/, '');
        if (version.length === 0) { continue; }

        const fullTfm = `${prefix}${version}`;
        return toShortTfm(fullTfm);
    }

    return null;
}

/**
 * Extract the assembly file version from a .NET assembly buffer.
 * Searches for the AssemblyFileVersionAttribute value in the blob heap
 * using the custom attribute blob format: prolog (01 00) + string length + version string.
 *
 * Returns a version string like '17.0.34.45391', or null if not found.
 */
export function detectAssemblyVersionFromBuffer(buffer: Buffer): string | null {
    if (buffer.indexOf(FILE_VERSION_ATTRIBUTE, 0, 'utf8') === -1) {
        return null;
    }

    let searchStart = 0;
    while (searchStart < buffer.length - 5) {
        const prologIdx = buffer.indexOf(BLOB_PROLOG, searchStart);
        if (prologIdx === -1 || prologIdx + 3 >= buffer.length) { break; }

        const strLen = buffer[prologIdx + 2];
        if (strLen >= 5 && strLen <= 20) {
            const strStart = prologIdx + 3;
            const strEnd = Math.min(strStart + strLen, buffer.length);
            const candidate = buffer.subarray(strStart, strEnd).toString('utf8');

            if (ASSEMBLY_VERSION_REGEX.test(candidate)) {
                return candidate;
            }
        }

        searchStart = prologIdx + 2;
    }

    return null;
}

/**
 * Convert a full TFM string to its short form.
 * E.g., '.NETCoreApp,Version=v8.0' → 'net8.0'
 */
export function toShortTfm(tfm: string | null): string | null {
    if (!tfm) { return null; }
    return tfm
        .replace('.NETCoreApp,Version=v', 'net')
        .replace('.NETStandard,Version=v', 'netstandard')
        .replace('.NETFramework,Version=v', 'net');
}
