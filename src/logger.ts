export interface Logger {
    info(message: string): void;
    debug(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}

export const nullLogger: Logger = {
    info() {},
    debug() {},
    warn() {},
    error() {},
};

/**
 * Create a logger that writes to stderr (keeps stdout clean for JSON output).
 */
export function createConsoleLogger(verbose = false): Logger {
    return {
        info: (msg) => process.stderr.write(`${msg}\n`),
        debug: verbose ? (msg) => process.stderr.write(`[debug] ${msg}\n`) : () => {},
        warn: (msg) => process.stderr.write(`[warn] ${msg}\n`),
        error: (msg) => process.stderr.write(`[error] ${msg}\n`),
    };
}
