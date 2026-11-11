import { schema as s } from 'jazz-tools'
import type { z } from 'zod'

export function validatedTextColumn<Validator extends z.ZodType<string>>(validator: Validator) {
	return {
		column: s.string().transform<string>({
			from: (value) => value,
			to: (value) => validator.parse(value)
		})
	}
}
