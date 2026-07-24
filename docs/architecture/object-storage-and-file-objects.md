# Object Storage and File Objects

## Purpose

Hermes stores binary content in a private S3-compatible object store and keeps
authorization, lifecycle state, and domain associations in PostgreSQL. MinIO is
the first adapter; business services depend on the `ObjectStorage` port rather
than MinIO-specific APIs.

Object storage is disabled by default. Disabled storage is not contacted during
bootstrap, OpenAPI generation, or ordinary non-file requests. Upload operations
return HTTP 503 with `OBJECT_STORAGE_DISABLED`. When enabled storage cannot be
reached, readiness and file operations return 503 with no credentials or signed
URLs in logs.

## Trust boundary

- Buckets are private. Remote buckets and bucket-scoped application credentials
  are provisioned before Hermes starts; the application receives no root key.
- `workspaceId` comes from the authenticated server context. File requests do
  not accept a client-supplied workspace identifier.
- Account and unbound platform/workspace temporary objects are visible only to
  their creator through the generic Files API.
- A ticket attachment becomes persistent only inside the message transaction.
  Platform temporary files are rebound to the ticket's verified workspace at
  that point.
- Ticket reads first apply existing participant or platform-staff permission
  checks, then batch-sign five-minute download URLs. A bound ticket file cannot
  be downloaded through the generic file endpoint.
- Bucket names, object keys, access keys, and signed query strings are never
  included in public FileObject responses.

## Persistence model

`file_objects` records immutable object identity and lifecycle metadata:

```text
pending -> ready -> deleted
    |        |
    +------> failed --(GC retry)--> deleted
```

Each row has one of three scopes:

| Scope | Workspace ID | Direct owner |
| --- | --- | --- |
| `account` | null | creating global account |
| `platform` | null | creating platform account while temporary |
| `workspace` | required | trusted workspace plus creating account while temporary |

Object keys contain random identifiers and no email, workspace slug, filename,
or other business meaning. Objects are never overwritten. Replacing an avatar,
artifact, or document creates a new FileObject.

Domain ownership uses dedicated foreign keys and association tables. Accounts
reference avatar FileObjects directly. Ticket messages use
`conversation_message_files` with composite `(workspace_id, id)` foreign keys
to both message and FileObject. A generic polymorphic attachment table is not
used.

## Upload and download flows

Small images (avatar and current ticket image UI) pass through the API with a
2 MiB limit. The API validates PNG, JPEG, GIF, or WebP signatures before writing
to S3 and validates the stored object again before marking it ready.

General files use two phases:

1. `POST /api/admin/files/objects` validates scope, type, name, and declared
   size, writes a pending FileObject, and returns a 15-minute PUT URL plus the
   required `Content-Type` header.
2. `POST /api/admin/files/objects/:fileId/complete` performs HEAD and streamed
   GET verification, confirms size and MIME, calculates SHA-256, validates image
   signatures, and idempotently marks the FileObject ready.

The first release accepts files up to 100 MiB and supports common images, PDF,
plain text, CSV, JSON, and Office documents. HTML, SVG, executable formats, and
unknown archives are rejected. Multipart uploads larger than 100 MiB, malware
scanning, and parsing sandboxes are later capabilities.

Authenticated downloads are either redirected by the Files API or signed in a
verified domain query. Download signatures last five minutes; upload signatures
last fifteen minutes. The SDK implementation follows the AWS SDK for JavaScript
v3 [S3 client](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrate-s3.html)
and [request presigner](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-s3-request-presigner/)
interfaces so another S3-compatible provider can replace MinIO.

## Operations

Pending and failed temporary objects expire after 24 hours. `files:gc` is an
idempotent, bounded command and is scheduled by the deployment platform; the API
process does not create an in-process cleanup timer. Physical delete failures
retain the row with a retry marker.

`files:migrate-local` migrates legacy `uploads/avatars` account and ticket
references. It is repeatable, reports missing sources, creates ordinary
FileObject/domain associations, and keeps the old opaque read route during the
compatibility window. All new writes use object storage.

The optional Compose MinIO and initializer live under the explicit `storage`
profile. The initializer creates a private local bucket, applies browser CORS,
and attaches a bucket-only policy to a separate application user. It is local
development infrastructure only and is never started by Nx or normal Compose
startup.
