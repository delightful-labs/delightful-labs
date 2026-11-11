<script lang="ts">
	import Shared from 'delightful-local-first/profile/avatar-form'
	import type { ComponentProps } from 'svelte'
	import { avatarMimeType, profileAvatarFormSchema } from '#lib/validation/identity.js'
	import { formReasonText } from '#lib/forms/form-messages.js'
	import { m } from '#lib/paraglide/messages.js'
	import PhotoCropper from '../photo-cropper/PhotoCropper.svelte'
	let props: Omit<
		ComponentProps<typeof Shared>,
		'labels' | 'reasonText' | 'validateFile' | 'accept' | 'cropper'
	> = $props()
</script>

<Shared
	{...props}
	labels={{
		formats: m['images.formats'](),
		maxSize: m['images.max_file_size'](),
		resize: m['images.avatar_resize'](),
		profile: m['nouns.profile']({ count: 1 }),
		invalidName: m['profile.name_invalid'](),
		avatar: m['nouns.avatar']({ count: 1 }),
		select: m['actions.select_subject']({ subject: m['nouns.image']({ count: 1 }) }),
		details: m['labels.subject_details']({ subject: m['nouns.avatar']({ count: 1 }) }),
		close: m['actions.close'](),
		remove: m['actions.remove_subject']({ subject: m['nouns.avatar']({ count: 1 }) }),
		clear: m['actions.clear_selected_subject']({ subject: m['nouns.image']({ count: 1 }) }),
		edit: m['actions.edit_subject']({ subject: m['nouns.avatar']({ count: 1 }) }),
		invalid: m['forms.validation_error'](),
		save: m['actions.save_subject']({ subject: m['nouns.avatar']({ count: 1 }) }),
		saved: m['status.saved_subject']({ subject: m['nouns.avatar']({ count: 1 }) }),
		cropTitle: m['images.crop_avatar_title'](),
		retry: m['actions.retry']()
	}}
	reasonText={(reason) => formReasonText[reason]()}
	validateFile={(file) => profileAvatarFormSchema.safeParse({ action: 'upload', file }).success}
	accept={avatarMimeType.options.join(',')}
>
	{#snippet cropper(file, oncomplete, oncancel)}<PhotoCropper
			{file}
			mask="circle"
			{oncomplete}
			{oncancel}
		/>{/snippet}
</Shared>
