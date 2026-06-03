<script lang="ts">
    import { globalAudio } from "$lib/shared/audio.svelte"
    import PackPreview from "$lib/components/pack-preview.svelte"
    import TagBadge from "$lib/components/tag-badge.svelte"
    import Waveform from "$lib/components/waveform.svelte"
    import type { SoundAsset } from "$lib/shared/provider.svelte"
    import AudioLines from "lucide-svelte/icons/audio-lines"
    import Pause from "lucide-svelte/icons/pause"
    import Play from "lucide-svelte/icons/play"
    import Button from "$lib/components/ui/button/button.svelte"
    import * as Tooltip from "$lib/components/ui/tooltip/index.js"
    import LoaderCircle from "lucide-svelte/icons/loader-circle"
    import { dataStore, fetchAssets } from "$lib/shared/store.svelte"
    import { cn, formatKey } from "$lib/utils"
    import { loading } from "$lib/shared/loading.svelte"
    import { assetIcons } from "$lib/shared/icons.svelte"

    let {
        class: className,
        selected,
        playing,
        sampleAsset,
    }: {
        class?: string
        selected: boolean
        playing: boolean
        sampleAsset: SoundAsset
    } = $props()

    let playButtonRef = $state<HTMLButtonElement>(null!)

    $effect(() => {
        if (selected) {
            playButtonRef.focus({ preventScroll: true })
        }
    })

    const pack = $derived({
        name: sampleAsset.packName,
        files: [{ url: sampleAsset.packCoverUrl || "" }],
        sourceUrl: sampleAsset.sourceUrl,
    })
    const name = $derived(sampleAsset.name.split("/").slice(-1)[0])

    const millisToMinutesAndSeconds = (millis: number) => {
        var minutes = Math.floor(millis / 60000)
        var seconds = Math.floor((millis % 60000) / 1000)
        return minutes + ":" + (seconds < 10 ? "0" : "") + seconds
    }

    let probing = $state(false)

    const handleMouseEnter = () => {
        if (sampleAsset.duration <= 0 && sampleAsset.previewUrl && !probing) {
            probing = true
            const audio = new Audio()
            audio.preload = "metadata"
            
            const cleanup = () => {
                audio.src = ""
                probing = false
            }

            const timeout = setTimeout(cleanup, 4000)

            audio.addEventListener("loadedmetadata", () => {
                clearTimeout(timeout)
                const ms = Math.round(audio.duration * 1000)
                if (isFinite(ms) && ms > 0) {
                    sampleAsset.duration = ms
                }
                cleanup()
            })

            audio.addEventListener("error", () => {
                clearTimeout(timeout)
                cleanup()
            })

            audio.src = sampleAsset.previewUrl
        }
    }

    const handleDragStart = async (event: DragEvent) => {
        event.preventDefault()
        const { handleSampleDrag } = await import("$lib/shared/drag.svelte")
        await handleSampleDrag(event, sampleAsset)
    }
</script>

<button
    class={cn(
        "flex gap-4 items-center justify-between p-1 rounded-lg focus:outline-none cursor-grab",
        selected && "bg-muted",
        className
    )}
    id={`sample-list-entry-${sampleAsset.uuid}`}
    draggable="true"
    tabindex="-1"
    onmousedown={() => globalAudio.selectSampleAsset(sampleAsset, false)}
    ondragstart={handleDragStart}
    onmouseenter={handleMouseEnter}
>
    <PackPreview pack={pack as any} />
    <Button
        variant="ghost"
        bind:ref={playButtonRef}
        class="group flex-shrink-0 focus:outline-none"
        size="icon-lg"
        onclick={() =>
            playing
                ? globalAudio.ref.pause()
                : globalAudio.playSampleAsset(sampleAsset)}
    >
        {#if (selected && globalAudio.loading) || (loading.samplesCount && loading.samples.has(sampleAsset.uuid))}
            <LoaderCircle class="animate-spin" />
        {:else if playing}
            <Pause />
        {:else}
            <Play class="group-hover:block hidden" />
            {#if sampleAsset.assetCategorySlug && sampleAsset.assetCategorySlug in assetIcons}
                {@const Icon = assetIcons[sampleAsset.assetCategorySlug]}
                <Icon class="group-hover:hidden" />
            {:else}
                <AudioLines class="group-hover:hidden" />
            {/if}
        {/if}
    </Button>
    <div class="min-w-32 w-96 flex-[3_1_auto] overflow-clip">
        <div
            class={cn(
                "text-left relative after:content-[''] after:absolute after:inset-y-0 after:right-0 after:w-4 after:bg-gradient-to-r after:from-transparent after:pointer-events-none",
                selected ? " after:to-muted" : "after:to-background"
            )}
        >
            <Tooltip.Provider>
                <Tooltip.Root>
                    <Tooltip.Trigger
                        class="block max-w-full overflow-hidden text-ellipsis text-nowrap cursor-grab"
                    >
                        {name}
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                        {name}
                    </Tooltip.Content>
                </Tooltip.Root>
            </Tooltip.Provider>
            <div class="flex gap-0.5 text-xs overflow-clip text-nowrap">
                {#each sampleAsset.tags as tag}
                    {@const active = dataStore.tags.includes(tag.uuid)}
                    {@const tag_summary_tag = dataStore.tag_summary.find(
                        (t: any) => t.tag.uuid == tag.uuid
                    )}
                    <TagBadge
                        label={tag.label}
                        variant="ghost"
                        class="px-1 py-0.5 h-auto"
                        count={tag_summary_tag?.count ?? 0}
                        onclick={() => {
                            if (!active) {
                                dataStore.tags.push(tag.uuid)
                                fetchAssets()
                            }
                        }}
                    />
                {/each}
            </div>
        </div>
    </div>
    <Waveform
        src={sampleAsset.waveformUrl || ""}
        seed={sampleAsset.uuid}
        progress={selected ? globalAudio.progress() : 0}
        onseek={(progress) => {
            const startTime = progress * (sampleAsset.duration / 1000)
            globalAudio.playSampleAsset(sampleAsset, startTime)
        }}
        class="min-w-32 w-[150px] h-12 flex-grow md:block hidden"
    />
    <div class="text-muted-foreground flex-shrink-0 w-14 flex-grow">
        {sampleAsset.duration > 0 ? millisToMinutesAndSeconds(sampleAsset.duration) : "--"}
    </div>
    <div class="text-muted-foreground flex-shrink-0 w-14 flex-grow">
        {(sampleAsset.key &&
            formatKey(sampleAsset.key, sampleAsset.chordType)) ??
            "--"}
    </div>
    <div class="text-muted-foreground flex-shrink-0 w-14 flex-grow">
        {sampleAsset.bpm ?? "--"}
    </div>
</button>
