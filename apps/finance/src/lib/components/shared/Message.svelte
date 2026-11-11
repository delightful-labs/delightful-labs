<script lang="ts">
	import { Text } from 'delightful-ui'
	let { message, role }: { message: string; role?: 'alert' | 'status' } = $props()
</script>

<Text {role}>{message}</Text>
