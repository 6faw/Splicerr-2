import type { SoundAsset } from "./provider.svelte"
import { loading } from "$lib/shared/loading.svelte"
import { config } from "$lib/shared/config.svelte"
import {
    dataStore,
    freeDescrambledSample,
    getDescrambledSampleURL,
} from "$lib/shared/store.svelte"
import { debugLog } from "$lib/shared/logger"

let prevVolume = 0.8

export const globalAudio = $state({
    ref: null! as HTMLAudioElement,
    currentAsset: null as SoundAsset | null,
    paused: true,
    currentTime: 0,
    duration: 0,
    loading: false,
    volume: 0.8,
    progress() {
        return this.currentTime / this.duration
    },
    togglePlay() {
        this.paused = !this.paused
    },
    toggleMute() {
        if (this.volume > 0) {
            prevVolume = this.volume
            this.volume = 0
        } else {
            this.volume = prevVolume
        }
    },
    async selectSampleAsset(sampleAsset: SoundAsset, play: boolean = true) {
        if (this.currentAsset?.uuid != sampleAsset.uuid) {
            this.paused = true
            this.currentTime = 0

            if (this.currentAsset) {
                if (
                    !dataStore.sampleAssets.some(
                        (other) => this.currentAsset?.uuid == other.uuid
                    )
                ) {
                    freeDescrambledSample(this.currentAsset.uuid)
                }
            }

            this.currentAsset = sampleAsset
        }
    },
    async playSampleAsset(sampleAsset: SoundAsset, from: number = 0) {
        if (loading.samples.has(sampleAsset.uuid)) {
            debugLog("Sample is already loading")
            return
        }
        this.ref.src = ""
        this.currentTime = 0

        if (this.currentAsset) {
            if (
                !dataStore.sampleAssets.some(
                    (other) => this.currentAsset?.uuid == other.uuid
                )
            ) {
                freeDescrambledSample(this.currentAsset.uuid)
            }
        }

        this.currentAsset = sampleAsset
        try {
            this.ref.src = await getDescrambledSampleURL(sampleAsset)
            if (this.currentAsset.uuid != sampleAsset.uuid) {
                return
            }
            this.ref.currentTime = from
            this.ref.loop = sampleAsset.assetCategorySlug == "loop" && config.repeat_audio
            await this.ref.play()
        } catch (error) {
            console.error("Failed to play sample", error)
            this.loading = false
            this.paused = true
        }
    },
})
