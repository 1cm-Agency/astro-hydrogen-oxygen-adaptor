<script lang="ts">
  let { label, start = 0 }: { label: string; start?: number } = $props();
  let clicks = $state(0);
  const count = $derived(start + clicks);
</script>

<button id="svelte-counter" data-hydrated={clicks > 0 ? 'yes' : undefined} onclick={() => clicks++}>{label} {count}</button>
