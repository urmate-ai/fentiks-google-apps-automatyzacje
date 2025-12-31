# Google Drive Structure

## Overview

This document describes the Google Drive folder structure used by the Gmail Drafts Automation application.

## Folder Structure

```
Root Folder (RAG_REFRESHER_ROOT_FOLDER_ID)
├── Wiedza z Gmaila/
│   ├── processedEmails.jsonl
│   ├── 2019/
│   │   ├── 2019-01/
│   │   │   ├── 2019-01-01.jsonl
│   │   │   ├── 2019-01-02.jsonl
│   │   │   └── ...
│   │   ├── 2019-02/
│   │   └── ...
│   ├── 2020/
│   ├── 2021/
│   ├── 2022/
│   ├── 2023/
│   ├── 2024/
│   └── 2025/
└── terminarz_szkolen.json
```

## File Descriptions

### `Wiedza z Gmaila/`
Main folder for Gmail knowledge base.

#### `processedEmails.jsonl`
Tracks which emails have been processed to avoid duplicates.

**Format**: JSONL (one JSON object per line)

**Schema**:
```json
{
  "gmail_id": "string",
  "received_internaldate_ms": number,
  "received_at": "ISO 8601 date string"
}
```

**Location**: `Wiedza z Gmaila/processedEmails.jsonl`

#### Year Folders (`2019/`, `2020/`, etc.)
Organized by year for better navigation and performance.

#### Month Folders (`2024-01/`, `2024-02/`, etc.)
Organized by month within each year.

#### Daily Email Files (`2024-01-15.jsonl`)
Contains all emails received on a specific day.

**Format**: JSONL (one email per line)

**Schema**: See `ParsedMessage` interface in `src/gmail-syncer/parser.ts`

**Location**: `Wiedza z Gmaila/{YEAR}/{YEAR-MONTH}/{YEAR-MONTH-DAY}.jsonl`

**Example**: `Wiedza z Gmaila/2024/2024-01/2024-01-15.jsonl`

### `terminarz_szkolen.json`
Contains the schedule of training courses scraped from fentiks.pl.

**Format**: JSON array

**Schema**:
```json
[
  {
    "miejsce": "string",
    "data": "DD-MM-YYYY",
    "kurs": "string",
    "cena": "string",
    "dostepne_miejsca": "string"
  }
]
```

**Location**: `terminarz_szkolen.json` (root folder)

**Update Frequency**: Hourly (configurable via `WATCH_FENTIKS_SYNC_INTERVAL_MIN`)

## Configuration

### Environment Variables

- `RAG_REFRESHER_ROOT_FOLDER_ID`: The root Google Drive folder ID where all data is stored

### Code Constants

See `src/shared/drive/structure.ts` for folder and file name constants:

```typescript
export const DRIVE_STRUCTURE = {
  GMAIL_KNOWLEDGE: 'Wiedza z Gmaila',
  PROCESSED_EMAILS_FILE: 'processedEmails.jsonl',
  FENTIKS_SCHEDULE_FILE: 'terminarz_szkolen.json',
} as const;
```

## Best Practices

### 1. **Hierarchical Organization**
- Year → Month → Day structure for emails
- Keeps folder sizes manageable
- Improves search and navigation performance

### 2. **JSONL Format for Emails**
- One email per line
- Easy to append new emails
- Efficient for streaming/processing
- No need to parse entire file to add new entries

### 3. **JSON Format for Schedule**
- Single JSON array
- Easy to read entire schedule
- Sorted by date (newest first)
- Deduplication on sync

### 4. **Centralized Structure Definition**
- All paths defined in `src/shared/drive/structure.ts`
- Easy to modify structure in one place
- Type-safe helpers for path construction

### 5. **Validation**
- Folder ID validation before operations
- Clear error messages
- Fail-fast approach

## Migration Notes

### From Old Structure

If you're migrating from the old structure where:
- Emails were stored in `{YEAR}/{MONTH}/{DAY}.jsonl` directly in root
- Fentiks schedule was in `fentiks/{YEAR}/{MONTH}/{DAY}.jsonl`

**Migration Steps**:

1. Create `Wiedza z Gmaila/` folder in root
2. Move all year folders (2019, 2020, etc.) into `Wiedza z Gmaila/`
3. Move `processedEmails.jsonl` into `Wiedza z Gmaila/`
4. Consolidate all Fentiks JSONL files into a single `terminarz_szkolen.json` in root
5. Update `RAG_REFRESHER_ROOT_FOLDER_ID` if needed

**Script** (manual steps in Google Drive):
1. Open Google Drive
2. Navigate to your root folder
3. Create folder: "Wiedza z Gmaila"
4. Move year folders (2019-2025) into "Wiedza z Gmaila"
5. Move `processedEmails.jsonl` into "Wiedza z Gmaila"
6. Delete old `fentiks/` folder structure
7. The app will create `terminarz_szkolen.json` on next sync

## Troubleshooting

### "Folder not found" errors
- Verify `RAG_REFRESHER_ROOT_FOLDER_ID` is set correctly
- Ensure the service account has access to the folder
- Check folder permissions

### Duplicate emails
- Check `processedEmails.jsonl` is in correct location
- Verify file is not corrupted
- Check logs for parsing errors

### Fentiks schedule not updating
- Check internet connectivity
- Verify fentiks.pl website structure hasn't changed
- Check logs for scraping errors
- Verify `terminarz_szkolen.json` file permissions

## Performance Considerations

### Email Sync
- **Rate Limiting**: 1.2 seconds between Gmail API calls
- **Batch Size**: Max 500 messages per sync
- **Frequency**: Every 30 minutes (configurable)

### Fentiks Sync
- **Deduplication**: Only new entries are added
- **Sorting**: Entries sorted by date (newest first)
- **Frequency**: Every 60 minutes (configurable)

### Drive Operations
- **Caching**: Folder IDs cached during path traversal
- **Minimal Reads**: Only read files when necessary
- **Append-Only**: Emails appended to daily files (no full file rewrites)

