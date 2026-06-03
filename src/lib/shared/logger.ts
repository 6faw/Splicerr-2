import { dev } from "$app/environment";

export function debugLog(...args: unknown[]) {
    if (dev) {
        console.info(...args);
    }
}

export function debugWarn(...args: unknown[]) {
    if (dev) {
        console.warn(...args);
    }
}
