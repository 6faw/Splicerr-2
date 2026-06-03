<script lang="ts">
    import "../app.css"
    import { ModeWatcher } from "mode-watcher"
    import {
        config,
        isSamplesDirValid,
        loadConfig,
        settingsDialog,
    } from "$lib/shared/config.svelte"
    import { onMount } from "svelte"

    let { children } = $props()

    const DEFAULT_SCALE = 0.8
    let setWebviewZoom = $state<((scale: number) => void) | null>(null)

    $effect(() => {
        setWebviewZoom?.(config.ui_scale * DEFAULT_SCALE)
    })

    onMount(() => {
        import("@tauri-apps/api/webview").then(({ getCurrentWebview }) => {
            const webview = getCurrentWebview()
            setWebviewZoom = (scale: number) => {
                void webview.setZoom(scale)
            }
        })

        loadConfig().then(() => {
            if (!isSamplesDirValid()) {
                settingsDialog.open = true
            }
        })
    })
</script>

<ModeWatcher />
{@render children?.()}
