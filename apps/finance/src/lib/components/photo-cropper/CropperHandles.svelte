<script lang="ts">
	import { m } from '#lib/paraglide/messages.js'
	import type { CropCorner } from './machine.js'
	import CropperHandle from './CropperHandle.svelte'

	let {
		onpointerdown,
		onkeydown
	}: {
		onpointerdown: (event: PointerEvent, corner: CropCorner) => void
		onkeydown: (event: KeyboardEvent, corner: CropCorner) => void
	} = $props()
</script>

<CropperHandle
	corner="topLeft"
	label={m['profile.crop_resize_top_left']()}
	style="top:0;left:0;transform:translate(-50%,-50%);cursor:nwse-resize"
	{onpointerdown}
	{onkeydown}
/>
<CropperHandle
	corner="topRight"
	label={m['profile.crop_resize_top_right']()}
	style="top:0;right:0;transform:translate(50%,-50%);cursor:nesw-resize"
	{onpointerdown}
	{onkeydown}
/>
<CropperHandle
	corner="bottomLeft"
	label={m['profile.crop_resize_bottom_left']()}
	style="bottom:0;left:0;transform:translate(-50%,50%);cursor:nesw-resize"
	{onpointerdown}
	{onkeydown}
/>
<CropperHandle
	corner="bottomRight"
	label={m['profile.crop_resize_bottom_right']()}
	style="right:0;bottom:0;transform:translate(50%,50%);cursor:nwse-resize"
	{onpointerdown}
	{onkeydown}
/>
