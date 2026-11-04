import { mount } from 'svelte'
import Host from './Host.svelte'
export function mountFixture(target: HTMLElement) {
	mount(Host, { target })
}
