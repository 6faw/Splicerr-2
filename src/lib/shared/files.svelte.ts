import type { SoundAsset } from "./provider.svelte"
import { join, sep } from "@tauri-apps/api/path"
import { exists, create, mkdir } from "@tauri-apps/plugin-fs"
import { getDescrambledSampleURL } from "./store.svelte"
import { config, isSamplesDirValid } from "$lib/shared/config.svelte"
import { debugLog, debugWarn } from "$lib/shared/logger"

const sanitizePath = (path: string) => path.replace(/[^a-zA-Z0-9#_\-\.\/]/g, "_")

const sampleAssetPath = (sampleAsset: SoundAsset) => {
    let name = sampleAsset.name
    const previewProviders = ["epidemicsound", "loopcloud", "audiio", "audiojungle"]
    if (previewProviders.includes(sampleAsset.providerId)) {
        const match = name.match(/^(.*)(\.(?:wav|mp3|ogg|aif|aiff|flac))$/i)
        if (match) {
            name = `${match[1]} (Preview)${match[2]}`
        } else {
            name = `${name} (Preview)`
        }
    }
    const hasExt = /\.(wav|mp3|ogg|aif|aiff|flac)$/i.test(name)
    if (!hasExt) {
        name += ".wav"
    }
    return sanitizePath(`${sampleAsset.packName}/${name}`)
}

async function ensureFileDirectoryExists(filePath: string) {
    const separator = sep()
    const dirs = filePath.split(separator).slice(0, -1) // Remove the filename
    let currentPath = ""

    for (const dir of dirs) {
        currentPath += dir + separator
        if (!(await exists(currentPath))) {
            await mkdir(currentPath)
        }
    }
}

export async function absoluteSamplePath(sampleAsset: SoundAsset) {
    if (!config.samples_dir) {
        throw new Error("Samples directory is not set")
    }

    if (!isSamplesDirValid()) {
        throw new Error("Samples directory is invalid")
    }

    return await join(config.samples_dir, sampleAssetPath(sampleAsset))
}

export async function saveSample(sampleAsset: SoundAsset) {
    const absolutePath = await absoluteSamplePath(sampleAsset)

    if (!absolutePath) {
        throw new Error("Invalid sample path")
    }

    if (await exists(absolutePath)) {
        debugLog("Sample already exists at", absolutePath)
        return absolutePath
    }

    const blobURL = await getDescrambledSampleURL(sampleAsset)

    const response = await fetch(blobURL)

    const blob = await response.blob()

    const buffer = await blob.arrayBuffer()

    const samples = await new AudioContext().decodeAudioData(buffer)
    const channels: Float32Array[] = []

    // If the asset does not have a duration yet, resolve it from the decoded buffer
    const durationMs = sampleAsset.duration > 0 ? sampleAsset.duration : samples.duration * 1000
    if (sampleAsset.duration <= 0) {
        sampleAsset.duration = Math.round(durationMs)
    }

    for (let i = 0; i < samples.numberOfChannels; i++) {
        const channel = samples.getChannelData(i)
        
        // Calculate 12ms in samples based on the actual sample rate
        const trimSamples = config.cut_mp3_delay ? Math.floor(samples.sampleRate * 0.012) : 0
        
        const start = trimSamples
        const end = (durationMs / 1000) * samples.sampleRate + start
        
        // Make sure we don't try to slice beyond the available data
        const safeEnd = Math.min(end, channel.length)
        
        channels.push(channel.subarray(start, safeEnd))
    }

    const [{ encode }, { Buffer }] = await Promise.all([
        import("node-wav"),
        import("buffer"),
    ])
    ;(globalThis as any).Buffer ??= Buffer

    const wavData = encode(channels as any, {
        bitDepth: 16,
        sampleRate: samples.sampleRate,
    })

    debugLog("Sample converted, saving at", absolutePath)

    await ensureFileDirectoryExists(absolutePath)

    const file = await create(absolutePath)
    await file.write(new Uint8Array(wavData))
    await file.close()

    debugLog("Sample saved")

    return absolutePath
}

export async function absolutePackImagePath(sampleAsset: SoundAsset) {
    if (!config.samples_dir) {
        throw new Error("Samples directory is not set")
    }

    if (!isSamplesDirValid()) {
        throw new Error("Samples directory is invalid")
    }

    const packDir = sanitizePath(sampleAsset.packName)
    return await join(config.samples_dir, packDir, "cover.jpg")
}

export async function savePackImage(sampleAsset: SoundAsset) {
    const packImageUrl = sampleAsset.packCoverUrl
    if (!packImageUrl) return null

    const absolutePath = await absolutePackImagePath(sampleAsset)

    if (!absolutePath) {
        throw new Error("Invalid pack image path")
    }

    if (await exists(absolutePath)) {
        debugLog("Pack image already exists at", absolutePath)
        return absolutePath
    }

    try {
        const response = await fetch(packImageUrl)
        if (!response.ok) throw new Error("Failed to fetch image")
        const buffer = await response.arrayBuffer()

        debugLog("Saving pack image at", absolutePath)

        await ensureFileDirectoryExists(absolutePath)

        const file = await create(absolutePath)
        await file.write(new Uint8Array(buffer))
        await file.close()

        debugLog("Pack image saved")

        return absolutePath
    } catch (e: any) {
        debugLog(e.message)
        if (e instanceof TypeError && (e.message.includes("Failed to fetch") || e.message.includes("Load failed"))) {
            debugWarn("CORS error or network issue when fetching pack image", e)
            return null
        }
        throw e
    }
}
