# Remaining effect-boundary design

This follows the qualified conversion checkpoint. The user authorized completing
implementation and tests without intermediate review pauses.

Bank request identity/time allocation, completion timestamps and diagnostic trace
writes currently occur in some transition/entry helpers. Move allocation to owned
leaf actors and queue trace effects. Keep authorization, logging, cancellation,
import settlement and lock release in the existing charts. State-scoped prepared
facts can use native state input; receipts needed for cleanup stay in context.

Backup submission requires a resource workflow: admit an opaque submission,
prepare a native request, then export or release it according to cancellation,
identity replacement or shutdown. An integration-boundary constructor keeps the
raw password in a private capability rather than an actor snapshot. The preparation
leaf consumes that capability and allocates the SDK request and operation ID.
The parent must retain a late acquired request and release it before completion;
stopping a preparation promise is not a cleanup receipt. Preserve closing priority,
the existing export custody/reload boundary and all localization/presentation.

Tests should prove pure preview does not allocate IDs, trace or SDK resources;
initial and repeated submissions do not reuse disposed capabilities; and late
preparation through cancellation/replacement/shutdown releases the actual request.
Retain the existing bank logging/import, native Jazz backup and privacy tests.
