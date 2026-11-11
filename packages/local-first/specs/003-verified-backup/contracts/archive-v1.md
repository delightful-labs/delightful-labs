# Proposed DLF archive v1 contract

This is an implementation proposal for review, not a deployed format. Extension `.dlfbackup`, media type `application/octet-stream`. UTF-8 JSON, no BOM or compression. Integer byte limits below use MiB = 1,048,576 bytes.

## Envelope

Only these exact variants are accepted. Unknown fields, duplicate keys, noncanonical base64, and unsupported versions/algorithms are rejected. Parse with a bounded JSON tokenizer that rejects duplicate keys; plain `JSON.parse` alone cannot detect duplicates. Prototype keys are ordinary data, never object mutation instructions.

Plain envelope fields: `magic: "DLF-BACKUP"`, `version: 1`, `protection: "none"`, `payload: <standard padded base64 of exact UTF-8 payload bytes>`, `sha256: <64 lowercase hexadecimal digest characters>`.

Encrypted envelope fields: `magic: "DLF-BACKUP"`, `version: 1`, `protection: "password"`, `kdf: "PBKDF2-HMAC-SHA-256"`, `iterations: 600000`, `salt: <base64 of 16 random bytes>`, `cipher: "AES-256-GCM"`, `iv: <base64 of 12 random bytes>`, `tagBits: 128`, `payload: <base64 of ciphertext followed by authentication tag>`.

AES-GCM additional authenticated data is UTF-8 encoding of this exact ordered JSON array, with no spaces:

```text
["DLF-BACKUP",1,"password","PBKDF2-HMAC-SHA-256",600000,"<salt>","AES-256-GCM","<iv>",128]
```

Header object key order is irrelevant. The literal salt/IV strings used in the authenticated tuple must be canonical standard padded base64. Reject unsupported parameters before expensive key derivation; never execute a file-supplied arbitrary work factor. Generate salt and IV independently using `crypto.getRandomValues` for each new encryption, including retries. Reusing a completed encrypted file for download does not re-encrypt it.

Password: UTF-8 bytes of the exact supplied text, no trimming or normalization. Reject empty passwords and malformed Unicode surrogate sequences; cap UTF-8 password length at 1,024 bytes. Derive an unextractable AES-256 key via PBKDF2 SHA-256. Wrong password and authenticated corruption produce one `authenticationFailed` result. No password recovery or login-based decryption exists.

Plain SHA-256 detects accidental corruption, not deliberate tampering or author authenticity. Password encryption authenticates bytes under that password, not the application publisher. Generic structure/integrity success never substitutes for domain validation.

## Payload

Object fields:

- `archiveId`: fresh UUID generated before encoding.
- `profile`: exact `{ id, version }` consumer profile identifier and positive integer version.
- `source`: `{ applicationId, workspaceId }`, descriptive original IDs; these confer no authority.
- `capturedAt`: canonical UTC timestamp.
- `coverage`: `{ mode: "complete-supported-graph", recordTypes, history: "current-data", deletedRecords: "excluded", consistency }`. The original `"quiescent-single-user"` declaration remains supported. The native Jazz export uses `"jazz-exclusive-transaction"` only after a zero-application-mutation exclusive transaction receives a positive authority verdict. This 2026-11-05 metadata extension follows the native experiment and fresh implementation; older readers reject the unfamiliar declaration. It describes the trusted exporter's consistency mechanism, not a server signature over the archive. Do not label partial data complete.
- `records`: ordered array of `{ type, id, fields }`, with unique `(type,id)` identity. Type and field names are profile-owned. Records use explicit allowlists, never SDK row spreading.
- `attachments`: ordered array of `{ id, mediaType, fileName, sizeBytes, sha256, data }`; `data` is standard padded base64. Attachment IDs are unique. File names are metadata and never filesystem paths.
- `references`: inert membership, audit, and integration provenance records using the same `{ type, id, fields }` shape as domain records. Identities are unique across both arrays; `coverage.recordTypes` includes their types. These do not enter live access or credential tables on restore.

Each `fields` entry is a typed value: `{kind:"null"}`, `{kind:"text",value:string}`, `{kind:"boolean",value:boolean}`, `{kind:"integer",value:canonicalDecimal}`, `{kind:"date",value:"YYYY-MM-DD"}`, `{kind:"timestamp",value:canonicalUTC}`, `{kind:"reference",type,id}`, or `{kind:"attachment",id}`. Numeric metadata (versions and byte counts) must also use canonical safe integer tokens, with no fraction, exponent or negative zero; reject tokens outside the safe integer range before conversion. No generic floating point, arbitrary object, inline binary, `undefined`, special JSON BigInt transform, or executable content. Domain profiles decompose lists/relationships into explicit records; profile data must use these same bounded values in inert reference records.

Canonical decimal integer is `0` or optional `-` followed by a nonzero digit and remaining decimal digits; reject `-0`, exponents, leading zeros, and fractions. Limit to 128 digits. Finance additionally enforces its exact supported integer range on decode and before writing. Dates must be actual calendar dates; timestamps use exact millisecond UTC form `YYYY-MM-DDTHH:mm:ss.sssZ`. Profiles must reject source values needing unsupported timestamp precision instead of rounding them.

Sort records by exact case-sensitive type then ID, fields by name, and attachments by ID for stable comparisons. Compare UTF-16 code-unit sequences without locale sorting or Unicode normalization; emit object keys in that order even for integer-like field names. Hash exact payload bytes for envelope checks; no general JSON canonicalization claim is needed. Each attachment digest covers decoded original bytes. Domain validation checks all typed references and file associations. Archived status remains explicit consumer data, never filtered out implicitly.

## Bounds and validation order

Proposed v1 limits: outer file 64 MiB; decoded payload 32 MiB; aggregate raw attachment bytes 16 MiB; single attachment 8 MiB; total records including inert reference records 50,000; attachment count 5,000; nesting depth 32; individual text value 1 MiB UTF-8; type/field names 128 bytes; IDs 256 bytes; 256 fields per record; 500,000 JSON values per payload. All arrays and strings are also bounded by file/payload limits. Inspect base64 encoded lengths before allocation and require decoded sizes to match. Reject unknown required record types under the selected profile.

Check input file size → bounded envelope tokenization/schema → supported parameters and encoded lengths → base64 decode → authenticated decrypt or plaintext hash → bounded UTF-8/payload parsing → generic graph and byte integrity → consumer profile/version and domain validation. There are zero destination writes through this entire sequence. JSON parsing, base64 conversion, and encryption can require multiple simultaneous copies; these bounds still require actual browser memory qualification.

A consumer-supplied lower bound is allowed; it cannot raise v1 limits silently. If real data exceeds these limits, redesign/version the format or implement a reviewed bounded streaming format before adoption. Never omit data or split into untracked files and report a complete archive.

## Independent reading

The independent inspector documents this format and uses standard crypto/file primitives; it imports no Jazz, login, or consumer sessions. It can verify envelope, attachment hashes, typed references, and generic bounds. Without a recognized profile validator its result is `integrityValidProfileUnsupported`, never `restorable`. A fresh app session is only needed to restore to a destination, not to decrypt and inspect a file.

## Primary references

[Web Crypto AES-GCM](https://www.w3.org/TR/webcrypto-1/#aes-gcm), [PBKDF2](https://www.w3.org/TR/webcrypto-1/#pbkdf2), [digest](https://www.w3.org/TR/webcrypto-1/#SubtleCrypto-method-digest), and [File API](https://www.w3.org/TR/FileAPI/). The proposed 600,000 SHA-256 iterations follow [OWASP PBKDF2 guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#pbkdf2), not a Web Crypto default. Native browser interoperability motivates PBKDF2; OWASP generally prefers memory-hard algorithms. Performance and password interaction remain implementation verification requirements.
