import * as provider from './provider.js'
import * as controls from './controls.js'
import { releaseWorkspaceJournal } from './journal-control.js'
import { failPreferencesStorage } from './fail-account-storage-once.js'
import { operation9 as fixture0 } from './operations/account-order.operations.js'
import { operation139 as fixture1 } from './operations/account-order.operations.js'
import { operation255 as fixture2 } from './operations/authentication.operations.js'
import { operation294 as fixture3 } from './operations/authentication.operations.js'
import { operation618 as fixture4 } from './operations/authentication.operations.js'
import { operation680 as fixture5 } from './operations/authentication.operations.js'
import { operation704 as fixture6 } from './operations/authentication.operations.js'
import { operation744 as fixture7 } from './operations/authentication.operations.js'
import { operation759 as fixture8 } from './operations/authentication.operations.js'
import { operation790 as fixture9 } from './operations/authentication.operations.js'
import { operation823 as fixture10 } from './operations/authentication.operations.js'
import { operation834 as fixture11 } from './operations/authentication.operations.js'
import { operation928 as fixture12 } from './operations/authentication.operations.js'
import { operation18 as fixture13 } from './operations/bank-sync.operations.js'
import { operation249 as fixture14 } from './operations/bank-sync.operations.js'
import { operation324 as fixture15 } from './operations/bank-sync.operations.js'
import { operation345 as fixture16 } from './operations/bank-sync.operations.js'
import { operation370 as fixture17 } from './operations/bank-sync.operations.js'
import { operation438 as fixture18 } from './operations/bank-sync.operations.js'
import { operation960 as fixture19 } from './operations/bank-sync.operations.js'
import { operation998 as fixture20 } from './operations/bank-sync.operations.js'
import { operation1066 as fixture21 } from './operations/bank-sync.operations.js'
import { operation1267 as fixture22 } from './operations/bank-sync.operations.js'
import { operation1428 as fixture23 } from './operations/bank-sync.operations.js'
import { operation1509 as fixture24 } from './operations/bank-sync.operations.js'
import { operation1780 as fixture25 } from './operations/bank-sync.operations.js'
import { operation1843 as fixture26 } from './operations/bank-sync.operations.js'
import { operation112 as fixture27 } from './operations/creation-modals.operations.js'
import { operation152 as fixture28 } from './operations/creation-modals.operations.js'
import { operation123 as fixture29 } from './operations/duplicate-names.operations.js'
import { operation228 as fixture30 } from './operations/duplicate-names.operations.js'
import { operation277 as fixture31 } from './operations/duplicate-names.operations.js'
import { operation8 as fixture32 } from './operations/expense-overview.operations.js'
import { operation4 as fixture33 } from './operations/fake-data.operations.js'
import { operation75 as fixture34 } from './operations/multiple-workspaces.operations.js'
import { operation205 as fixture35 } from './operations/multiple-workspaces.operations.js'
import { operation271 as fixture36 } from './operations/multiple-workspaces.operations.js'
import { operation316 as fixture37 } from './operations/multiple-workspaces.operations.js'
import { operation391 as fixture38 } from './operations/multiple-workspaces.operations.js'
import { operation404 as fixture39 } from './operations/multiple-workspaces.operations.js'
import { operation447 as fixture40 } from './operations/multiple-workspaces.operations.js'
import { operation475 as fixture41 } from './operations/multiple-workspaces.operations.js'
import { operation490 as fixture42 } from './operations/multiple-workspaces.operations.js'
import { operation541 as fixture43 } from './operations/multiple-workspaces.operations.js'
import { operation572 as fixture44 } from './operations/multiple-workspaces.operations.js'
import { operation596 as fixture45 } from './operations/multiple-workspaces.operations.js'
import { operation615 as fixture46 } from './operations/multiple-workspaces.operations.js'
import { operation631 as fixture47 } from './operations/multiple-workspaces.operations.js'
import { operation651 as fixture48 } from './operations/multiple-workspaces.operations.js'
import { operation678 as fixture49 } from './operations/multiple-workspaces.operations.js'
import { operation699 as fixture50 } from './operations/multiple-workspaces.operations.js'
import { operation739 as fixture51 } from './operations/multiple-workspaces.operations.js'
import { operation764 as fixture52 } from './operations/multiple-workspaces.operations.js'
import { operation775 as fixture53 } from './operations/multiple-workspaces.operations.js'
import { operation788 as fixture54 } from './operations/multiple-workspaces.operations.js'
import { operation843 as fixture55 } from './operations/multiple-workspaces.operations.js'
import { operation877 as fixture56 } from './operations/multiple-workspaces.operations.js'
import { operation921 as fixture57 } from './operations/multiple-workspaces.operations.js'
import { operation57 as fixture58 } from './operations/offline-access.operations.js'
import { operation76 as fixture59 } from './operations/offline-access.operations.js'
import { operation150 as fixture60 } from './operations/offline-access.operations.js'
import { operation178 as fixture61 } from './operations/offline-access.operations.js'
import { operation217 as fixture62 } from './operations/offline-access.operations.js'
import { operation12 as fixture63 } from './operations/pagination.operations.js'
import { operation306 as fixture64 } from './operations/pagination.operations.js'
import { operation338 as fixture65 } from './operations/pagination.operations.js'
import { operation380 as fixture66 } from './operations/pagination.operations.js'
import { operation465 as fixture67 } from './operations/pagination.operations.js'
import { operation474 as fixture68 } from './operations/pagination.operations.js'
import { operation480 as fixture69 } from './operations/pagination.operations.js'
import { operation497 as fixture70 } from './operations/pagination.operations.js'
import { operation98 as fixture71 } from './operations/permissions.operations.js'
import { operation126 as fixture72 } from './operations/permissions.operations.js'
import { operation149 as fixture73 } from './operations/permissions.operations.js'
import { operation172 as fixture74 } from './operations/permissions.operations.js'
import { operation177 as fixture75 } from './operations/permissions.operations.js'
import { operation263 as fixture76 } from './operations/permissions.operations.js'
import { operation298 as fixture77 } from './operations/permissions.operations.js'
import { operation325 as fixture78 } from './operations/permissions.operations.js'
import { operation330 as fixture79 } from './operations/permissions.operations.js'
import { operation348 as fixture80 } from './operations/permissions.operations.js'
import { operation460 as fixture81 } from './operations/permissions.operations.js'
import { operation461 as fixture82 } from './operations/permissions.operations.js'
import { operation528 as fixture83 } from './operations/permissions.operations.js'
import { operation564 as fixture84 } from './operations/permissions.operations.js'
import { operation581 as fixture85 } from './operations/permissions.operations.js'
import { operation682 as fixture86 } from './operations/permissions.operations.js'
import { operation45 as fixture87 } from './operations/readiness.operations.js'
import { operation14 as fixture88 } from './operations/sidebar-balances.operations.js'
import { operation90 as fixture89 } from './operations/sidebar-balances.operations.js'
import { operation107 as fixture90 } from './operations/sidebar-balances.operations.js'
import { operation5 as fixture91 } from './operations/transaction-attachments.operations.js'
import { operation32 as fixture92 } from './operations/transaction-attachments.operations.js'
import { operation104 as fixture93 } from './operations/transaction-attachments.operations.js'
import { operation118 as fixture94 } from './operations/transaction-attachments.operations.js'
import { operation353 as fixture95 } from './operations/transaction-edit.operations.js'
import { operation374 as fixture96 } from './operations/transaction-edit.operations.js'
import { operation458 as fixture97 } from './operations/transaction-edit.operations.js'
import { operation9 as fixture98 } from './operations/transaction-image-editor.operations.js'
import { operation88 as fixture99 } from './operations/transaction-image-editor.operations.js'
import { operation215 as fixture100 } from './operations/transaction-image-editor.operations.js'
import { operation323 as fixture101 } from './operations/transaction-image-editor.operations.js'
import { operation16 as fixture102 } from './operations/transaction-polish.operations.js'
import { operation63 as fixture103 } from './operations/transaction-polish.operations.js'
import { operation5 as fixture104 } from './operations/transaction-transfers.operations.js'
import { operation18 as fixture105 } from './operations/transaction-transfers.operations.js'
import { operation31 as fixture106 } from './operations/transaction-transfers.operations.js'
import { operation154 as fixture107 } from './operations/transaction-transfers.operations.js'
import { operation14 as fixture108 } from './operations/transaction-workspace.operations.js'
import { operation91 as fixture109 } from './operations/transaction-workspace.operations.js'
import { operation287 as fixture110 } from './operations/transaction-workspace.operations.js'
import { operation506 as fixture111 } from './operations/transaction-workspace.operations.js'
import { operation569 as fixture112 } from './operations/transaction-workspace.operations.js'
import { operation21 as fixture113 } from './operations/transfer-create.operations.js'
import { operation66 as fixture114 } from './operations/transfer-create.operations.js'
import { operation219 as fixture115 } from './operations/transfer-create.operations.js'
import { operation117 as fixture116 } from './operations/ui-integration.operations.js'
import { operation97 as fixture117 } from './operations/workflow-completion.operations.js'
import { operation105 as fixture118 } from './operations/workflow-completion.operations.js'
import { operation160 as fixture119 } from './operations/workflow-completion.operations.js'
import { operation183 as fixture120 } from './operations/workflow-completion.operations.js'
import { operation19 as fixture121 } from './operations/helpers-transactions.js'
import { operation172 as fixture122 } from './operations/helpers-transactions.js'
import { operation38 as fixture123 } from './operations/helpers-workspace.js'
import { operation48 as fixture124 } from './operations/helpers-workspace.js'
import { operation68 as fixture125 } from './operations/features-accounts.operations.js'
import { operation124 as fixture126 } from './operations/features-accounts.operations.js'
import { operation174 as fixture127 } from './operations/features-accounts.operations.js'
import { operation189 as fixture128 } from './operations/features-accounts.operations.js'
import { operation238 as fixture129 } from './operations/features-accounts.operations.js'
import { operation303 as fixture130 } from './operations/features-accounts.operations.js'
import { operation304 as fixture131 } from './operations/features-accounts.operations.js'
import { operation363 as fixture132 } from './operations/features-accounts.operations.js'
import { operation378 as fixture133 } from './operations/features-accounts.operations.js'
import { operation47 as fixture134 } from './operations/features-categories.operations.js'
import { operation93 as fixture135 } from './operations/features-categories.operations.js'
import { operation164 as fixture136 } from './operations/features-categories.operations.js'
import { operation186 as fixture137 } from './operations/features-categories.operations.js'
import { operation226 as fixture138 } from './operations/features-categories.operations.js'
import { operation227 as fixture139 } from './operations/features-categories.operations.js'
import { operation275 as fixture140 } from './operations/features-categories.operations.js'
import { operation322 as fixture141 } from './operations/features-categories.operations.js'
import { operation347 as fixture142 } from './operations/features-categories.operations.js'
import { operation348 as fixture143 } from './operations/features-categories.operations.js'
import { operation10 as fixture144 } from './operations/features-navigation.operations.js'
import { operation61 as fixture145 } from './operations/features-navigation.operations.js'
import { operation11 as fixture146 } from './operations/features-profiles.operations.js'
import { operation68 as fixture147 } from './operations/features-profiles.operations.js'
import { operation79 as fixture148 } from './operations/features-profiles.operations.js'
import { operation114 as fixture149 } from './operations/features-profiles.operations.js'
import { operation127 as fixture150 } from './operations/features-profiles.operations.js'
import { operation128 as fixture151 } from './operations/features-profiles.operations.js'
import { operation155 as fixture152 } from './operations/features-profiles.operations.js'
import { operation197 as fixture153 } from './operations/features-profiles.operations.js'
import { operation223 as fixture154 } from './operations/features-profiles.operations.js'
import { operation257 as fixture155 } from './operations/features-profiles.operations.js'
import { operation267 as fixture156 } from './operations/features-profiles.operations.js'
import { operation279 as fixture157 } from './operations/features-profiles.operations.js'
import { operation301 as fixture158 } from './operations/features-profiles.operations.js'
import { operation306 as fixture159 } from './operations/features-profiles.operations.js'
import { operation317 as fixture160 } from './operations/features-profiles.operations.js'
import { operation326 as fixture161 } from './operations/features-profiles.operations.js'
import { operation333 as fixture162 } from './operations/features-profiles.operations.js'
import { operation340 as fixture163 } from './operations/features-profiles.operations.js'
import { operation17 as fixture164 } from './operations/features-tags.operations.js'
import { operation75 as fixture165 } from './operations/features-tags.operations.js'
import { operation110 as fixture166 } from './operations/features-tags.operations.js'
import { operation189 as fixture167 } from './operations/features-tags.operations.js'
import { operation220 as fixture168 } from './operations/features-tags.operations.js'
import { operation221 as fixture169 } from './operations/features-tags.operations.js'
import { operation266 as fixture170 } from './operations/features-tags.operations.js'
import { operation310 as fixture171 } from './operations/features-tags.operations.js'
import { operation332 as fixture172 } from './operations/features-tags.operations.js'
import { operation425 as fixture173 } from './operations/features-tags.operations.js'
import { operation478 as fixture174 } from './operations/features-tags.operations.js'
import { operation503 as fixture175 } from './operations/features-tags.operations.js'
import { operation539 as fixture176 } from './operations/features-tags.operations.js'
import { operation547 as fixture177 } from './operations/features-tags.operations.js'
import { operation564 as fixture178 } from './operations/features-tags.operations.js'
import { operation588 as fixture179 } from './operations/features-tags.operations.js'
import { operation669 as fixture180 } from './operations/features-tags.operations.js'
import { operation14 as fixture181 } from './operations/features-transaction-details.operations.js'
import { operation132 as fixture182 } from './operations/features-transaction-details.operations.js'
import { operation157 as fixture183 } from './operations/features-transaction-details.operations.js'
import { operation257 as fixture184 } from './operations/features-transaction-details.operations.js'
import { operation258 as fixture185 } from './operations/features-transaction-details.operations.js'
import { operation270 as fixture186 } from './operations/features-transaction-details.operations.js'
import { operation271 as fixture187 } from './operations/features-transaction-details.operations.js'
import { operation345 as fixture188 } from './operations/features-transaction-details.operations.js'
import { operation38 as fixture189 } from './operations/features-transaction-entry.operations.js'
import { operation225 as fixture190 } from './operations/features-transaction-entry.operations.js'
import { operation278 as fixture191 } from './operations/features-transaction-entry.operations.js'
import { operation370 as fixture192 } from './operations/features-transaction-entry.operations.js'
import { operation393 as fixture193 } from './operations/features-transaction-entry.operations.js'
import { operation40 as fixture194 } from './operations/features-transaction-list.operations.js'
import { operation174 as fixture195 } from './operations/features-transaction-list.operations.js'
import { operation205 as fixture196 } from './operations/features-transaction-list.operations.js'
import { operation318 as fixture197 } from './operations/features-transaction-list.operations.js'
import { operation61 as fixture198 } from './operations/features-workspace-alpha59-restore.operations.js'
import { operation92 as fixture199 } from './operations/features-workspace-settings.operations.js'
import { operation93 as fixture200 } from './operations/features-workspace-settings.operations.js'
import { operation148 as fixture201 } from './operations/features-workspace-settings.operations.js'
import { operation160 as fixture202 } from './operations/features-workspace-settings.operations.js'
import { operation187 as fixture203 } from './operations/features-workspace-settings.operations.js'
import { operation226 as fixture204 } from './operations/features-workspace-settings.operations.js'
import { operation240 as fixture205 } from './operations/features-workspace-settings.operations.js'
import { operation352 as fixture206 } from './operations/features-workspace-settings.operations.js'
import { operation384 as fixture207 } from './operations/features-workspace-settings.operations.js'
import { operation415 as fixture208 } from './operations/features-workspace-settings.operations.js'
import { operation435 as fixture209 } from './operations/features-workspace-settings.operations.js'
import { operation478 as fixture210 } from './operations/features-workspace-settings.operations.js'
import { operation545 as fixture211 } from './operations/features-workspace-settings.operations.js'
import { operation573 as fixture212 } from './operations/features-workspace-settings.operations.js'
export const operations = {
	releaseWorkspaceJournal,
	failPreferencesStorage,
	...controls,
	...provider,
	'account-order.e2e:9': fixture0,
	'account-order.e2e:139': fixture1,
	'authentication.e2e:255': fixture2,
	'authentication.e2e:294': fixture3,
	'authentication.e2e:618': fixture4,
	'authentication.e2e:680': fixture5,
	'authentication.e2e:704': fixture6,
	'authentication.e2e:744': fixture7,
	'authentication.e2e:759': fixture8,
	'authentication.e2e:790': fixture9,
	'authentication.e2e:823': fixture10,
	'authentication.e2e:834': fixture11,
	'authentication.e2e:928': fixture12,
	'bank-sync.e2e:18': fixture13,
	'bank-sync.e2e:249': fixture14,
	'bank-sync.e2e:324': fixture15,
	'bank-sync.e2e:345': fixture16,
	'bank-sync.e2e:370': fixture17,
	'bank-sync.e2e:438': fixture18,
	'bank-sync.e2e:960': fixture19,
	'bank-sync.e2e:998': fixture20,
	'bank-sync.e2e:1066': fixture21,
	'bank-sync.e2e:1267': fixture22,
	'bank-sync.e2e:1428': fixture23,
	'bank-sync.e2e:1509': fixture24,
	'bank-sync.e2e:1780': fixture25,
	'bank-sync.e2e:1843': fixture26,
	'creation-modals.e2e:112': fixture27,
	'creation-modals.e2e:152': fixture28,
	'duplicate-names.e2e:123': fixture29,
	'duplicate-names.e2e:228': fixture30,
	'duplicate-names.e2e:277': fixture31,
	'expense-overview.e2e:8': fixture32,
	'fake-data.e2e:4': fixture33,
	'multiple-workspaces.e2e:75': fixture34,
	'multiple-workspaces.e2e:205': fixture35,
	'multiple-workspaces.e2e:271': fixture36,
	'multiple-workspaces.e2e:316': fixture37,
	'multiple-workspaces.e2e:391': fixture38,
	'multiple-workspaces.e2e:404': fixture39,
	'multiple-workspaces.e2e:447': fixture40,
	'multiple-workspaces.e2e:475': fixture41,
	'multiple-workspaces.e2e:490': fixture42,
	'multiple-workspaces.e2e:541': fixture43,
	'multiple-workspaces.e2e:572': fixture44,
	'multiple-workspaces.e2e:596': fixture45,
	'multiple-workspaces.e2e:615': fixture46,
	'multiple-workspaces.e2e:631': fixture47,
	'multiple-workspaces.e2e:651': fixture48,
	'multiple-workspaces.e2e:678': fixture49,
	'multiple-workspaces.e2e:699': fixture50,
	'multiple-workspaces.e2e:739': fixture51,
	'multiple-workspaces.e2e:764': fixture52,
	'multiple-workspaces.e2e:775': fixture53,
	'multiple-workspaces.e2e:788': fixture54,
	'multiple-workspaces.e2e:843': fixture55,
	'multiple-workspaces.e2e:877': fixture56,
	'multiple-workspaces.e2e:921': fixture57,
	'offline-access.e2e:57': fixture58,
	'offline-access.e2e:76': fixture59,
	'offline-access.e2e:150': fixture60,
	'offline-access.e2e:178': fixture61,
	'offline-access.e2e:217': fixture62,
	'pagination.e2e:12': fixture63,
	'pagination.e2e:306': fixture64,
	'pagination.e2e:338': fixture65,
	'pagination.e2e:380': fixture66,
	'pagination.e2e:465': fixture67,
	'pagination.e2e:474': fixture68,
	'pagination.e2e:480': fixture69,
	'pagination.e2e:497': fixture70,
	'permissions.e2e:98': fixture71,
	'permissions.e2e:126': fixture72,
	'permissions.e2e:149': fixture73,
	'permissions.e2e:172': fixture74,
	'permissions.e2e:177': fixture75,
	'permissions.e2e:263': fixture76,
	'permissions.e2e:298': fixture77,
	'permissions.e2e:325': fixture78,
	'permissions.e2e:330': fixture79,
	'permissions.e2e:348': fixture80,
	'permissions.e2e:460': fixture81,
	'permissions.e2e:461': fixture82,
	'permissions.e2e:528': fixture83,
	'permissions.e2e:564': fixture84,
	'permissions.e2e:581': fixture85,
	'permissions.e2e:682': fixture86,
	'readiness.e2e:45': fixture87,
	'sidebar-balances.e2e:14': fixture88,
	'sidebar-balances.e2e:90': fixture89,
	'sidebar-balances.e2e:107': fixture90,
	'transaction-attachments.e2e:5': fixture91,
	'transaction-attachments.e2e:32': fixture92,
	'transaction-attachments.e2e:104': fixture93,
	'transaction-attachments.e2e:118': fixture94,
	'transaction-edit.e2e:353': fixture95,
	'transaction-edit.e2e:374': fixture96,
	'transaction-edit.e2e:458': fixture97,
	'transaction-image-editor.e2e:9': fixture98,
	'transaction-image-editor.e2e:88': fixture99,
	'transaction-image-editor.e2e:215': fixture100,
	'transaction-image-editor.e2e:323': fixture101,
	'transaction-polish.e2e:16': fixture102,
	'transaction-polish.e2e:63': fixture103,
	'transaction-transfers.e2e:5': fixture104,
	'transaction-transfers.e2e:18': fixture105,
	'transaction-transfers.e2e:31': fixture106,
	'transaction-transfers.e2e:154': fixture107,
	'transaction-workspace.e2e:14': fixture108,
	'transaction-workspace.e2e:91': fixture109,
	'transaction-workspace.e2e:287': fixture110,
	'transaction-workspace.e2e:506': fixture111,
	'transaction-workspace.e2e:569': fixture112,
	'transfer-create.e2e:21': fixture113,
	'transfer-create.e2e:66': fixture114,
	'transfer-create.e2e:219': fixture115,
	'ui-integration.e2e:117': fixture116,
	'workflow-completion.e2e:97': fixture117,
	'workflow-completion.e2e:105': fixture118,
	'workflow-completion.e2e:160': fixture119,
	'workflow-completion.e2e:183': fixture120,
	'helpers/transactions:19': fixture121,
	'helpers/transactions:172': fixture122,
	'helpers/workspace:38': fixture123,
	'helpers/workspace:48': fixture124,
	'features/accounts.e2e:68': fixture125,
	'features/accounts.e2e:124': fixture126,
	'features/accounts.e2e:174': fixture127,
	'features/accounts.e2e:189': fixture128,
	'features/accounts.e2e:238': fixture129,
	'features/accounts.e2e:303': fixture130,
	'features/accounts.e2e:304': fixture131,
	'features/accounts.e2e:363': fixture132,
	'features/accounts.e2e:378': fixture133,
	'features/categories.e2e:47': fixture134,
	'features/categories.e2e:93': fixture135,
	'features/categories.e2e:164': fixture136,
	'features/categories.e2e:186': fixture137,
	'features/categories.e2e:226': fixture138,
	'features/categories.e2e:227': fixture139,
	'features/categories.e2e:275': fixture140,
	'features/categories.e2e:322': fixture141,
	'features/categories.e2e:347': fixture142,
	'features/categories.e2e:348': fixture143,
	'features/navigation.e2e:10': fixture144,
	'features/navigation.e2e:61': fixture145,
	'features/profiles.e2e:11': fixture146,
	'features/profiles.e2e:68': fixture147,
	'features/profiles.e2e:79': fixture148,
	'features/profiles.e2e:114': fixture149,
	'features/profiles.e2e:127': fixture150,
	'features/profiles.e2e:128': fixture151,
	'features/profiles.e2e:155': fixture152,
	'features/profiles.e2e:197': fixture153,
	'features/profiles.e2e:223': fixture154,
	'features/profiles.e2e:257': fixture155,
	'features/profiles.e2e:267': fixture156,
	'features/profiles.e2e:279': fixture157,
	'features/profiles.e2e:301': fixture158,
	'features/profiles.e2e:306': fixture159,
	'features/profiles.e2e:317': fixture160,
	'features/profiles.e2e:326': fixture161,
	'features/profiles.e2e:333': fixture162,
	'features/profiles.e2e:340': fixture163,
	'features/tags.e2e:17': fixture164,
	'features/tags.e2e:75': fixture165,
	'features/tags.e2e:110': fixture166,
	'features/tags.e2e:189': fixture167,
	'features/tags.e2e:220': fixture168,
	'features/tags.e2e:221': fixture169,
	'features/tags.e2e:266': fixture170,
	'features/tags.e2e:310': fixture171,
	'features/tags.e2e:332': fixture172,
	'features/tags.e2e:425': fixture173,
	'features/tags.e2e:478': fixture174,
	'features/tags.e2e:503': fixture175,
	'features/tags.e2e:539': fixture176,
	'features/tags.e2e:547': fixture177,
	'features/tags.e2e:564': fixture178,
	'features/tags.e2e:588': fixture179,
	'features/tags.e2e:669': fixture180,
	'features/transaction-details.e2e:14': fixture181,
	'features/transaction-details.e2e:132': fixture182,
	'features/transaction-details.e2e:157': fixture183,
	'features/transaction-details.e2e:257': fixture184,
	'features/transaction-details.e2e:258': fixture185,
	'features/transaction-details.e2e:270': fixture186,
	'features/transaction-details.e2e:271': fixture187,
	'features/transaction-details.e2e:345': fixture188,
	'features/transaction-entry.e2e:38': fixture189,
	'features/transaction-entry.e2e:225': fixture190,
	'features/transaction-entry.e2e:278': fixture191,
	'features/transaction-entry.e2e:370': fixture192,
	'features/transaction-entry.e2e:393': fixture193,
	'features/transaction-list.e2e:40': fixture194,
	'features/transaction-list.e2e:174': fixture195,
	'features/transaction-list.e2e:205': fixture196,
	'features/transaction-list.e2e:318': fixture197,
	'features/workspace-alpha59-restore.e2e:61': fixture198,
	'features/workspace-settings.e2e:92': fixture199,
	'features/workspace-settings.e2e:93': fixture200,
	'features/workspace-settings.e2e:148': fixture201,
	'features/workspace-settings.e2e:160': fixture202,
	'features/workspace-settings.e2e:187': fixture203,
	'features/workspace-settings.e2e:226': fixture204,
	'features/workspace-settings.e2e:240': fixture205,
	'features/workspace-settings.e2e:352': fixture206,
	'features/workspace-settings.e2e:384': fixture207,
	'features/workspace-settings.e2e:415': fixture208,
	'features/workspace-settings.e2e:435': fixture209,
	'features/workspace-settings.e2e:478': fixture210,
	'features/workspace-settings.e2e:545': fixture211,
	'features/workspace-settings.e2e:573': fixture212
}
