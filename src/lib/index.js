import DrawerSection from './Components/DrawerSection.svelte'
import NavigationGroup from './Components/NavigationGroup.svelte'
import NavigationLink from './Components/NavigationLink.svelte'
import Text from './Components/Text.svelte'
import Heading from './Components/Heading.svelte'
import Button from './Components/Button.svelte'
import ButtonContent from './Components/ButtonContent.svelte'
import Icon from './Components/Icon.svelte'
import NumberKeypad from './Components/NumberKeypad.svelte'
import Details from './Components/Details.svelte'
import Dialog from './Components/Dialog.svelte'
import Popover from './Components/Popover.svelte'
import LoadingSpinner from './Components/LoadingSpinner.svelte'
import StatusMessage from './Components/StatusMessage.svelte'
import LoadingScreen from './Components/LoadingScreen.svelte'
import LoadingContent from './Components/LoadingContent.svelte'
import Table from './Components/Table.svelte'
import LinkedListRow from './Components/LinkedListRow.svelte'
import Navigation from './Components/Navigation.svelte'
import Stepper from './Components/Stepper.svelte'
import Pagination from './Components/Pagination.svelte'
import PaginationItem from './Components/PaginationItem.svelte'
import TopNavigation from './Components/TopNavigation.svelte'
import Drawer from './Components/Drawer.svelte'
import ScreenReaderText from './Components/ScreenReaderText.svelte'
import InputText from './Components/Inputs/InputText.svelte'
import FieldFeedback from './Components/Inputs/FieldFeedback.svelte'
import InputRange from './Components/Inputs/InputRange.svelte'
import InputNumber from './Components/Inputs/InputNumber.svelte'
import InputCurrency from './Components/Inputs/InputCurrency.svelte'
import Select from './Components/Inputs/Select.svelte'
import Textarea from './Components/Inputs/Textarea.svelte'
import Checkbox from './Components/Inputs/Checkbox.svelte'
import AvatarImageTile from './Components/Inputs/AvatarImageTile.svelte'
import InputImages from './Components/Inputs/InputImages.svelte'
import InputAvatar from './Components/Inputs/InputAvatar.svelte'
import InputImage from './Components/Inputs/InputImage.svelte'
import InputDate from './Components/Inputs/InputDate.svelte'
import TagInput from './Components/Inputs/TagInput.svelte'

export {
	NavigationLink,
	NavigationGroup,
	DrawerSection,
	Text,
	Heading,
	Button,
	ButtonContent,
	Icon,
	NumberKeypad,
	Details,
	Dialog,
	Popover,
	InputText,
	FieldFeedback,
	InputNumber,
	InputRange,
	InputCurrency,
	InputDate,
	InputImage,
	InputAvatar,
	InputImages,
	AvatarImageTile,
	TagInput,
	Select,
	Textarea,
	Checkbox,
	LoadingSpinner,
	StatusMessage,
	LoadingScreen,
	LoadingContent,
	Table,
	LinkedListRow,
	Navigation,
	Stepper,
	Pagination,
	PaginationItem,
	TopNavigation,
	Drawer,
	ScreenReaderText
}

export const INPUT_TYPES = Object.freeze({
	EMAIL: 'email',
	NUMBER: 'number',
	SEARCH: 'search',
	TEL: 'tel',
	TEXT: 'text',
	URL: 'url'
})

/** @typedef {import('./Components/NumberKeypad.svelte').NumberKeypadKey} NumberKeypadKey */
