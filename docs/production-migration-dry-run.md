# Production Migration Dry-Run Manifest

Generated from the current production workbook export.

## Source
- Workbook: `YLP Attendance Database (1).xlsx`
- Sheets used: `Students`, `Sessions`, `Attendance`, `Settings`
- Legacy-only sheets excluded: `Class 1`, `Attendance key`

## Source counts
- Students: 35
- Sessions: 6
- Attendance: 2
- Settings: 4

## Validation
- Duplicate student IDs: 0
- Duplicate session IDs: 0
- Duplicate attendance IDs: 0
- Duplicate (session_id, student_id): 0
- Missing session references: 0
- Scan Out without Scan In: 0
- Negative/malformed duration: 0
- QR tokens present: 6/6
- Active sessions: 4
- Closed sessions: 2
- Timezone: +07:00
- enrollment_required: true
- open_minutes: 30
- close_minutes: 120

## Known historical condition
- Attendance contains one intentionally manual/test reference: `S001 / Ben Zo`.
- Historical `scan_receipts` values are empty; no synthetic request IDs or receipts are generated.

## Import mapping
- Students -> `students`
- Sessions -> `sessions`
- Legacy QR token -> Edge Function hashing + protected ciphertext
- Attendance -> `attendance`
- Settings -> `settings`

## Safety
This manifest contains no QR token values, credentials, secrets, or production row payloads.
The workbook remains the source artifact for the eventual controlled import.
No production data is modified by this dry-run.
