<script lang="ts">
    import * as HoverCard from "$lib/components/ui/hover-card/index.js"
    import { openUrl } from "@tauri-apps/plugin-opener"
    import AudioLines from "lucide-svelte/icons/audio-lines"

    type PreviewPack = {
        name: string
        files: Array<{ url: string }>
        sourceUrl?: string | null
    }

    const {
        pack,
        side = "right",
        size = 12,
        class: className,
    }: {
        pack: PreviewPack | null | undefined
        side?: "right" | "top" | "bottom" | "left"
        size?: number
        class?: string
    } = $props()

    const name = $derived(pack?.name.split("/").slice(-1)[0])
    const imgSrc = $derived(pack?.files?.[0]?.url || "")
    const sourceUrl = $derived(pack?.sourceUrl)
    const previewSize = $derived(`${size * 0.25}rem`)

    let imageFailed = $state(false)

    const showImage = $derived(Boolean(imgSrc) && !imageFailed)

    $effect(() => {
        imgSrc
        imageFailed = false
    })

    const openSource = () => {
        if (sourceUrl) {
            openUrl(sourceUrl)
        }
    }
</script>

{#if pack}
    <HoverCard.Root>
        <HoverCard.Trigger
            class="flex-shrink-0"
            onclick={openSource}
        >
            <div
                class="rounded flex items-center justify-center bg-muted/40 text-muted-foreground overflow-hidden"
                style={`width:${previewSize};height:${previewSize}`}
            >
                {#if showImage}
                    <img
                        src={imgSrc}
                        alt={name}
                        class="size-full object-cover"
                        draggable="false"
                        onerror={() => (imageFailed = true)}
                    />
                {:else}
                    <AudioLines class="size-2/3" aria-hidden="true" />
                {/if}
            </div>
        </HoverCard.Trigger>
        <HoverCard.Content {side} class="flex flex-col justify-center gap-2 w-48 max-w-[12rem] overflow-hidden">
            <button onclick={openSource} class="aspect-square overflow-hidden rounded bg-muted/40 text-muted-foreground flex items-center justify-center">
                {#if showImage}
                    <img
                        src={imgSrc}
                        alt={name}
                        class="size-full object-cover"
                        onerror={() => (imageFailed = true)}
                    />
                {:else}
                    <AudioLines class="size-2/3" aria-hidden="true" />
                {/if}
            </button>
            <p class="max-w-full truncate text-sm font-medium">{name}</p>
        </HoverCard.Content>
    </HoverCard.Root>
{:else}
    <div
        class="rounded flex-shrink-0 bg-muted/40 text-muted-foreground flex items-center justify-center"
        style={`width:${previewSize};height:${previewSize}`}
    >
        <AudioLines class="size-2/3" aria-hidden="true" />
    </div>
{/if}
