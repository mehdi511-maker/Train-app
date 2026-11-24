
# Train-app License API

Appwrite Function for single-device license activation and validation.

## Database

Database ID:
train_license_db

Existing table:
licenses

Required columns:
- code_hash: varchar(64), required, unique
- status: varchar(20), required
- device_hash: varchar(64), optional
- activated_at: datetime, optional
- expires_at: datetime, optional

Create another table:

Table ID:
license_bindings

Columns:
- device_hash: varchar(64), required
- activated_at: datetime, required

The binding row ID is the license row ID.
This prevents two devices from claiming the same
license through competing first-activation requests.

## Function settings

Runtime: Node.js 22
Entrypoint: src/main.js
Root directory: appwrite-license-api
Build command: npm install

## Environment variables

Set these as server-side secrets:

APPWRITE_API_KEY
CODE_PEPPER

Appwrite provides:

APPWRITE_FUNCTION_API_ENDPOINT
APPWRITE_FUNCTION_PROJECT_ID

The API key must have only the required
TablesDB permissions for reading licenses
and reading/creating license_bindings rows.

Never put these secrets in the Android app
or commit them to GitHub.

## Activate request

{
  "action": "activate",
  "code": "YOUR-LICENSE-CODE",
  "device_id": "ANDROID-DEVICE-ID"
}

## Validate request

{
  "action": "validate",
  "code": "YOUR-LICENSE-CODE",
  "device_id": "ANDROID-DEVICE-ID"
}

## Important

This API does not yet include:
- Admin license creation
- Admin revocation
- Admin device reset
- Android application integration

License codes must be stored as HMAC-SHA256
hashes using the same CODE_PEPPER secret.

Do not insert plaintext license codes into
the code_hash column.

A device identifier can be spoofed on a
compromised device. This is not an absolute
hardware lock.

